// Finds tagged burns on one EVM chain using nothing but a public RPC.
//
// There is no way to ask a node for "transactions carrying our suffix", so
// the scan reads every CCTP burn on the chain (the DepositForBurn log on
// Circle's TokenMessengerV2, a few thousand a day on the busiest chains) and
// looks at the input of the transaction each one came from. The suffix is
// searched for anywhere in that input, which also covers burns a wallet
// batched inside its own call.

import {
    createPublicClient,
    decodeEventLog,
    fallback,
    http,
    numberToHex,
    parseAbiItem,
    toEventSelector,
    type Hex,
} from 'viem';
import { inputHasTag } from '../../src/lib/attribution/tag';
import type { EvmChainEntry } from '../../src/lib/registry/types';
import type { ChainCoverage, TransferRecord } from '../../src/lib/stats/types';

const depositForBurnEvent = parseAbiItem(
    'event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)',
);

export const DEPOSIT_FOR_BURN_TOPIC = toEventSelector(depositForBurnEvent);

export type Burn = { depositor: `0x${string}`; amount: bigint; destDomain: number };

export function decodeBurnLog(log: { topics: readonly Hex[]; data: Hex }): Burn {
    const { args } = decodeEventLog({
        abi: [depositForBurnEvent],
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
    });
    return {
        depositor: args.depositor,
        amount: args.amount,
        destDomain: args.destinationDomain,
    };
}

export function burnRecord(args: {
    chain: string;
    tx: string;
    logIndex: number;
    time: string;
    burn: Burn;
    dest: string | null;
}): TransferRecord {
    return {
        // One transaction can hold several burns, so the log position is part
        // of the identity.
        id: `${args.chain}:${args.tx}:${args.logIndex}`,
        chain: args.chain,
        tx: args.tx,
        time: args.time,
        from: args.burn.depositor,
        amount: args.burn.amount.toString(),
        destDomain: args.burn.destDomain,
        dest: args.dest,
        nonce: null,
    };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const describe = (err: unknown) =>
    (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200);

// Widths public RPCs are known to cap log queries at, widest first. Stepping
// down through these lands exactly on a node's limit; plain halving would
// undershoot it (a 100 block limit would end up scanned 62 blocks at a time).
const SPAN_STEPS = [10_000n, 5_000n, 2_000n, 1_000n, 500n, 100n, 50n, 10n, 1n];

/**
 * Walk from..to in ranges, calling `scan` for each. Public RPCs disagree
 * about how wide a log query may be (anywhere from 50 blocks to tens of
 * thousands) and say so in different words, so the width is found by trying:
 * any failure steps it down, and it stays at whatever worked for the rest of
 * the run. Three failures in a row at a single block mean the RPC is not
 * answering at all.
 *
 * `through` is the last block of the last range that completed. It only ever
 * moves forward over blocks that were really scanned, which is what makes it
 * safe to store as the next run's starting point.
 */
export async function runRanges(args: {
    from: bigint;
    to: bigint;
    initialSpan: bigint;
    /** Epoch ms after which no new range is started. */
    deadline: number;
    now: () => number;
    scan: (from: bigint, to: bigint) => Promise<void>;
    pause?: (ms: number) => Promise<void>;
}): Promise<{ through: bigint; complete: boolean; span: bigint; error?: string }> {
    const pause = args.pause ?? sleep;
    let span = args.initialSpan < 1n ? 1n : args.initialSpan;
    let cursor = args.from;
    let through = args.from - 1n;
    let failuresAtOneBlock = 0;

    while (cursor <= args.to) {
        if (args.now() >= args.deadline) return { through, complete: false, span };
        const end = cursor + span - 1n > args.to ? args.to : cursor + span - 1n;
        try {
            await args.scan(cursor, end);
            through = end;
            cursor = end + 1n;
            failuresAtOneBlock = 0;
        } catch (err) {
            if (span > 1n) {
                span = SPAN_STEPS.find((step) => step < span) ?? 1n;
            } else {
                failuresAtOneBlock += 1;
                if (failuresAtOneBlock >= 3) {
                    return { through, complete: false, span, error: describe(err) };
                }
            }
            await pause(250);
        }
    }
    return { through, complete: true, span };
}

/**
 * The first block whose timestamp is at or after `target` (seconds), or
 * head + 1 when there is none yet. Used once per chain, on its first run.
 *
 * It steps back from the head in growing strides and then bisects, so it
 * never asks for a block much older than the answer: old blocks are exactly
 * what pruned public nodes cannot serve.
 */
export async function firstBlockAtOrAfter(args: {
    head: bigint;
    target: number;
    timestampOf: (block: bigint) => Promise<number>;
}): Promise<bigint> {
    const { head, target, timestampOf } = args;
    if ((await timestampOf(head)) < target) return head + 1n;

    let hi = head; // known to be at or after the target
    let lo = -1n; // known to be before the target, once found
    let stride = 1_000n;
    while (lo < 0n) {
        const probe = hi - stride < 0n ? 0n : hi - stride;
        if ((await timestampOf(probe)) < target) {
            lo = probe;
        } else {
            hi = probe;
            if (probe === 0n) return 0n;
            stride *= 4n;
        }
    }
    while (hi - lo > 1n) {
        const mid = (lo + hi) / 2n;
        if ((await timestampOf(mid)) < target) lo = mid;
        else hi = mid;
    }
    return hi;
}

async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

// Stay this far behind the head so a reorganised block is never counted.
const CONFIRMATIONS = 64n;
export const DEFAULT_SPAN = 2_000n;
const TX_CONCURRENCY = 6;

type RpcLog = {
    topics: Hex[];
    data: Hex;
    blockNumber: Hex;
    transactionHash: Hex;
    logIndex: Hex;
};

export async function scanEvmChain(args: {
    entry: EvmChainEntry;
    rpcUrls: string[];
    /** Last block already scanned, or null on this chain's first run. */
    fromBlock: bigint | null;
    /** Where a first run starts. */
    since: Date;
    deadline: number;
    initialSpan?: bigint;
    /** The suffix to look for; the usage tag unless a check passes another. */
    suffix?: string;
    destOf: (domain: number) => string | null;
}): Promise<{
    records: TransferRecord[];
    through: bigint | null;
    span: bigint;
    /** Burns examined, tagged or not. */
    seen: number;
    coverage: ChainCoverage;
}> {
    const { entry } = args;
    const span = args.initialSpan ?? DEFAULT_SPAN;
    const client = createPublicClient({
        chain: entry.chain,
        transport: fallback(
            args.rpcUrls.map((url) => http(url, { timeout: 20_000, retryCount: 2 })),
            { rank: false },
        ),
    });

    const times = new Map<bigint, number>();
    const timestampOf = async (block: bigint): Promise<number> => {
        const known = times.get(block);
        if (known !== undefined) return known;
        const time = Number((await client.getBlock({ blockNumber: block })).timestamp);
        times.set(block, time);
        return time;
    };
    const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

    const records: TransferRecord[] = [];
    let seen = 0;
    let through = args.fromBlock;
    try {
        const head = await client.getBlockNumber();
        const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;
        const start =
            args.fromBlock !== null
                ? args.fromBlock + 1n
                : await firstBlockAtOrAfter({
                      head: safeHead,
                      target: Math.floor(args.since.getTime() / 1000),
                      timestampOf,
                  });

        const result = await runRanges({
            from: start,
            to: safeHead,
            initialSpan: span,
            deadline: args.deadline,
            now: Date.now,
            scan: async (from, to) => {
                const logs = (await client.request({
                    method: 'eth_getLogs',
                    params: [
                        {
                            address: entry.tokenMessenger,
                            topics: [DEPOSIT_FOR_BURN_TOPIC],
                            fromBlock: numberToHex(from),
                            toBlock: numberToHex(to),
                        },
                    ],
                })) as unknown as RpcLog[];
                if (logs.length === 0) return;

                const hashes = [...new Set(logs.map((log) => log.transactionHash))];
                const inputs = new Map<Hex, string>();
                await mapLimit(hashes, TX_CONCURRENCY, async (hash) => {
                    inputs.set(hash, (await client.getTransaction({ hash })).input);
                });

                // Collected per range and added only once the whole range is
                // read, so a range that fails half way adds nothing and is
                // simply read again.
                const found: TransferRecord[] = [];
                for (const log of logs) {
                    if (!inputHasTag(inputs.get(log.transactionHash) ?? '', args.suffix)) continue;
                    const burn = decodeBurnLog(log);
                    found.push(
                        burnRecord({
                            chain: entry.id,
                            tx: log.transactionHash,
                            logIndex: Number(BigInt(log.logIndex)),
                            time: iso(await timestampOf(BigInt(log.blockNumber))),
                            burn,
                            dest: args.destOf(burn.destDomain),
                        }),
                    );
                }
                seen += logs.length;
                records.push(...found);
            },
        });

        // Nothing new to scan leaves the checkpoint where it was.
        if (result.through >= start) through = result.through;
        else if (through === null && start > 0n) through = start - 1n;

        const throughTime = through !== null ? iso(await timestampOf(through)) : null;
        return {
            records,
            through,
            span: result.span,
            seen,
            coverage: {
                chain: entry.id,
                status: result.error ? 'error' : result.complete ? 'ok' : 'behind',
                through: throughTime,
                ...(result.error ? { note: result.error } : {}),
            },
        };
    } catch (err) {
        return {
            records,
            through,
            span,
            seen,
            coverage: { chain: entry.id, status: 'error', through: null, note: describe(err) },
        };
    }
}
