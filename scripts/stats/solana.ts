// Finds tagged burns on Solana using a public RPC.
//
// The tag is a memo instruction next to the burn. RPC nodes list every
// transaction that touched a program together with its memo, so the scan
// pages through the CCTP program's history (a few thousand transactions a
// day) and only fetches the ones whose memo is the tag.

import { getBase58Encoder } from '@solana/kit';
import { memoHasTag } from '../../src/lib/attribution/tag';
import type { SolanaChainEntry } from '../../src/lib/registry/types';
import {
    DEPOSIT_FOR_BURN_DISCRIMINATOR,
    DEPOSIT_FOR_BURN_WITH_HOOK_DISCRIMINATOR,
    getDepositForBurnInstructionDataDecoder,
    getDepositForBurnWithHookInstructionDataDecoder,
} from '../../src/lib/solana/generated/token-messenger-minter';
import type { ChainCoverage, TransferRecord } from '../../src/lib/stats/types';
import { describeError, jsonRpc, mapLimit } from './rpc';

// ─── reading a burn out of a transaction ─────────────────────────────

type RawInstruction = { programIdIndex: number; accounts: number[]; data: string };

/** A transaction as `getTransaction` returns it with encoding "json". */
export type SolanaTx = {
    blockTime?: number | null;
    meta?: {
        err?: unknown;
        loadedAddresses?: { writable?: string[]; readonly?: string[] } | null;
        innerInstructions?: { index: number; instructions: RawInstruction[] }[] | null;
    } | null;
    transaction: { message: { accountKeys: string[]; instructions: RawInstruction[] } };
};

export type SolanaBurn = { index: number; owner: string; amount: bigint; destDomain: number };

const startsWith = (bytes: Uint8Array, prefix: ArrayLike<number>) => {
    if (bytes.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
    return true;
};

function decodeBurnData(data: string): { amount: bigint; destDomain: number } | null {
    try {
        const bytes = new Uint8Array(getBase58Encoder().encode(data));
        if (startsWith(bytes, DEPOSIT_FOR_BURN_DISCRIMINATOR)) {
            const d = getDepositForBurnInstructionDataDecoder().decode(bytes);
            return { amount: d.amount, destDomain: d.destinationDomain };
        }
        if (startsWith(bytes, DEPOSIT_FOR_BURN_WITH_HOOK_DISCRIMINATOR)) {
            const d = getDepositForBurnWithHookInstructionDataDecoder().decode(bytes);
            return { amount: d.amount, destDomain: d.destinationDomain };
        }
    } catch {
        // Not something this program's burn decoders understand.
    }
    return null;
}

/**
 * Every CCTP burn in a transaction, whether it is a top level instruction or
 * one another program made on the user's behalf. The owner is the first
 * account of the burn instruction: the wallet the USDC left.
 */
export function decodeSolanaBurns(tx: SolanaTx, program: string): SolanaBurn[] {
    // Instructions index into the static keys followed by any addresses the
    // transaction loaded from lookup tables.
    const keys = [
        ...tx.transaction.message.accountKeys,
        ...(tx.meta?.loadedAddresses?.writable ?? []),
        ...(tx.meta?.loadedAddresses?.readonly ?? []),
    ];
    const burns: SolanaBurn[] = [];
    const visit = (ix: RawInstruction, index: number) => {
        if (keys[ix.programIdIndex] !== program) return;
        const burn = decodeBurnData(ix.data);
        const owner = keys[ix.accounts[0]];
        if (burn && owner) burns.push({ index, owner, ...burn });
    };
    tx.transaction.message.instructions.forEach((ix, i) => visit(ix, i));
    for (const group of tx.meta?.innerInstructions ?? []) {
        // Inner instructions get positions that cannot collide with top level ones.
        group.instructions.forEach((ix, j) => visit(ix, (group.index + 1) * 1000 + j));
    }
    return burns;
}

// ─── paging through the program's history ────────────────────────────

/** One row of `getSignaturesForAddress`. */
export type SignatureInfo = {
    signature: string;
    blockTime: number | null;
    err: unknown;
    memo: string | null;
};

/**
 * Collect a program's transactions from the newest back to where the last run
 * stopped. `fetchPage(before)` returns one page, newest first, ending at the
 * checkpoint if there is one. A first run has no checkpoint and stops at
 * `sinceSec` instead.
 *
 * `complete` is false when time ran out before reaching that point. The
 * caller must then leave its checkpoint alone: the history between where
 * this stopped and the old checkpoint has not been read.
 */
export async function collectSignatures(args: {
    fetchPage: (before: string | null) => Promise<SignatureInfo[]>;
    sinceSec: number;
    deadline: number;
    now: () => number;
    pageSize: number;
}): Promise<{ entries: SignatureInfo[]; complete: boolean }> {
    const entries: SignatureInfo[] = [];
    let before: string | null = null;
    for (;;) {
        if (args.now() >= args.deadline) return { entries, complete: false };
        const page = await args.fetchPage(before);
        for (const entry of page) {
            if (entry.blockTime !== null && entry.blockTime < args.sinceSec) {
                return { entries, complete: true };
            }
            entries.push(entry);
        }
        if (page.length < args.pageSize) return { entries, complete: true };
        before = page[page.length - 1].signature;
    }
}

const PAGE_SIZE = 1_000;

export async function scanSolana(args: {
    entry: SolanaChainEntry;
    rpcUrls: readonly string[];
    /** Newest signature the last run saw, or null on the first run. */
    untilSignature: string | null;
    since: Date;
    deadline: number;
    destOf: (domain: number) => string | null;
    /** Which memos count; the usage tag unless a check passes another. */
    matches?: (memo: string | null) => boolean;
}): Promise<{
    records: TransferRecord[];
    newest: string | null;
    /** Transactions of the program examined, tagged or not. */
    seen: number;
    coverage: ChainCoverage;
}> {
    const { entry } = args;
    const call = jsonRpc(args.rpcUrls);
    const matches = args.matches ?? memoHasTag;
    try {
        const { entries, complete } = await collectSignatures({
            fetchPage: async (before) =>
                (await call('getSignaturesForAddress', [
                    entry.tokenMessengerMinter,
                    {
                        limit: PAGE_SIZE,
                        ...(before ? { before } : {}),
                        ...(args.untilSignature ? { until: args.untilSignature } : {}),
                    },
                ])) as SignatureInfo[],
            sinceSec: Math.floor(args.since.getTime() / 1000),
            deadline: args.deadline,
            now: Date.now,
            pageSize: PAGE_SIZE,
        });

        const tagged = entries.filter((e) => !e.err && matches(e.memo));
        const found = await mapLimit(tagged, 4, async (info) => {
            const tx = (await call('getTransaction', [
                info.signature,
                { encoding: 'json', maxSupportedTransactionVersion: 0 },
            ])) as SolanaTx | null;
            if (!tx) throw new Error(`transaction ${info.signature} was not returned`);
            const seconds = tx.blockTime ?? info.blockTime ?? 0;
            return decodeSolanaBurns(tx, entry.tokenMessengerMinter).map(
                (burn): TransferRecord => ({
                    id: `${entry.id}:${info.signature}:${burn.index}`,
                    chain: entry.id,
                    tx: info.signature,
                    time: new Date(seconds * 1000).toISOString(),
                    from: burn.owner,
                    amount: burn.amount.toString(),
                    destDomain: burn.destDomain,
                    dest: args.destOf(burn.destDomain),
                    nonce: null,
                }),
            );
        });

        return {
            records: found.flat(),
            // Only a run that read all the way back may move the checkpoint.
            newest: complete ? (entries[0]?.signature ?? args.untilSignature) : args.untilSignature,
            seen: entries.length,
            coverage: {
                chain: entry.id,
                status: complete ? 'ok' : 'behind',
                through: complete ? new Date().toISOString() : null,
            },
        };
    } catch (err) {
        return {
            records: [],
            newest: args.untilSignature,
            seen: 0,
            coverage: { chain: entry.id, status: 'error', through: null, note: describeError(err) },
        };
    }
}
