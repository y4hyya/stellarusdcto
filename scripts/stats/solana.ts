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
import { describeError, jsonRpc, mapLimit, type RpcCall } from './rpc';

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
 * How a pass over the history ended.
 *
 *   reached    the checkpoint signature was seen, or (on a first run) an
 *              entry older than the counting start. Everything newer was read.
 *   exhausted  the node ran out of history first. A short page only proves
 *              this node has nothing older; it does not prove the checkpoint
 *              was passed. Nothing may be marked as read on this evidence.
 *   timeout    time ran out. `lastSeen` is where to pick up.
 */
export type PagingOutcome = 'reached' | 'exhausted' | 'timeout';

/**
 * Read a program's transactions from the newest back towards the checkpoint,
 * a page at a time. `fetchPage(before)` returns one page, newest first.
 */
export async function collectSignatures(args: {
    fetchPage: (before: string | null) => Promise<SignatureInfo[]>;
    /** The newest signature the last finished scan saw; null on a first run. */
    checkpoint: string | null;
    sinceSec: number;
    deadline: number;
    now: () => number;
    pageSize: number;
    /** Where an earlier, unfinished pass stopped. */
    startBefore?: string | null;
}): Promise<{ entries: SignatureInfo[]; outcome: PagingOutcome; lastSeen: string | null }> {
    const entries: SignatureInfo[] = [];
    let before = args.startBefore ?? null;
    let lastSeen = before;
    for (;;) {
        if (args.now() >= args.deadline) return { entries, outcome: 'timeout', lastSeen };
        const page = await args.fetchPage(before);
        for (const entry of page) {
            if (args.checkpoint !== null && entry.signature === args.checkpoint) {
                return { entries, outcome: 'reached', lastSeen };
            }
            if (entry.blockTime !== null && entry.blockTime < args.sinceSec) {
                return { entries, outcome: 'reached', lastSeen };
            }
            entries.push(entry);
            lastSeen = entry.signature;
        }
        if (page.length < args.pageSize) return { entries, outcome: 'exhausted', lastSeen };
        before = page[page.length - 1].signature;
    }
}

/**
 * Where the Solana scan stands between runs. `signature` is the newest
 * transaction of the last pass that read all the way back. `resume` is set
 * while a pass is unfinished: where it stopped, and the newest transaction it
 * started from, which becomes the checkpoint once it finishes.
 */
export type SolanaCheckpoint = {
    signature: string | null;
    resume?: { before: string; newest: string };
};

const PAGE_SIZE = 1_000;

export async function scanSolana(args: {
    entry: SolanaChainEntry;
    rpcUrls: readonly string[];
    state: SolanaCheckpoint;
    since: Date;
    deadline: number;
    destOf: (domain: number) => string | null;
    /** Which memos count; the usage tag unless a check passes another. */
    matches?: (memo: string | null) => boolean;
    now?: () => number;
    pageSize?: number;
    /** How to reach one endpoint; replaced in tests. */
    callFor?: (url: string) => RpcCall;
}): Promise<{
    records: TransferRecord[];
    state: SolanaCheckpoint;
    /** Transactions of the program examined, tagged or not. */
    seen: number;
    coverage: ChainCoverage;
}> {
    const { entry, state } = args;
    const matches = args.matches ?? memoHasTag;
    const now = args.now ?? Date.now;
    const pageSize = args.pageSize ?? PAGE_SIZE;
    const callFor = args.callFor ?? ((url: string) => jsonRpc([url]));

    // One endpoint reads the whole pass. Switching endpoints half way through
    // would stitch together two different views of the history, and a node
    // with less history would end the pass early without saying so.
    let problem = 'no RPC endpoint configured';
    for (const url of args.rpcUrls) {
        const call = callFor(url);
        try {
            const { entries, outcome, lastSeen } = await collectSignatures({
                fetchPage: async (before) =>
                    (await call('getSignaturesForAddress', [
                        entry.tokenMessengerMinter,
                        { limit: pageSize, ...(before ? { before } : {}) },
                    ])) as SignatureInfo[],
                checkpoint: state.signature,
                sinceSec: Math.floor(args.since.getTime() / 1000),
                deadline: args.deadline,
                now,
                pageSize,
                startBefore: state.resume?.before ?? null,
            });
            if (outcome === 'exhausted') {
                problem = 'the history this endpoint keeps ends before the last checkpoint';
                continue;
            }

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

            // The newest transaction of this pass: remembered from the run
            // that started it, or the first entry just read.
            const newest = state.resume?.newest ?? entries[0]?.signature ?? null;
            if (outcome === 'reached') {
                return {
                    records: found.flat(),
                    state: { signature: newest ?? state.signature },
                    seen: entries.length,
                    coverage: { chain: entry.id, status: 'ok', through: new Date().toISOString() },
                };
            }
            // Out of time: the checkpoint stays, and the place is kept.
            return {
                records: found.flat(),
                state: {
                    signature: state.signature,
                    ...(lastSeen && newest
                        ? { resume: { before: lastSeen, newest } }
                        : state.resume
                          ? { resume: state.resume }
                          : {}),
                },
                seen: entries.length,
                coverage: { chain: entry.id, status: 'behind', through: null },
            };
        } catch (err) {
            problem = describeError(err);
        }
    }

    return {
        records: [],
        state,
        seen: 0,
        coverage: { chain: entry.id, status: 'error', through: null, note: problem },
    };
}
