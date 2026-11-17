// Finds tagged burns on one EVM chain using nothing but a public RPC.
//
// There is no way to ask a node for "transactions carrying our suffix", so
// the scan reads every CCTP burn on the chain (the DepositForBurn log on
// Circle's TokenMessengerV2, a few thousand a day on the busiest chains) and
// looks at the input of the transaction each one came from. The suffix is
// searched for anywhere in that input, which also covers burns a wallet
// batched inside its own call.

import { decodeEventLog, numberToHex, parseAbiItem, toEventSelector, type Hex } from 'viem';
import { inputHasTag } from '../../src/lib/attribution/tag';
import type { EvmChainEntry } from '../../src/lib/registry/types';
import type { ChainCoverage, TransferRecord } from '../../src/lib/stats/types';
import { describeError, mapLimit } from './rpc';

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

// Widths public RPCs are known to cap log queries at, widest first. Stepping
// down through these lands exactly on a node's limit; plain halving would
// undershoot it (a 100 block limit would end up scanned 62 blocks at a time).
const SPAN_STEPS = [10_000n, 5_000n, 2_000n, 1_000n, 500n, 100n, 50n, 10n, 1n];
const stepBelow = (span: bigint) => SPAN_STEPS.find((step) => step < span) ?? 1n;
const stepAbove = (span: bigint, cap: bigint) => {
    const above = [...SPAN_STEPS].reverse().find((step) => step > span) ?? cap;
    return above > cap ? cap : above;
};
// Successes in a row before a narrowed width is tried one step wider again.
const RECOVER_AFTER = 8;

/**
 * Walk from..to in ranges, calling `scan` for each. Public RPCs disagree
 * about how wide a log query may be (anywhere from 50 blocks to tens of
 * thousands) and say so in different words, so the width is found by trying.
 *
 * A request that fails is tried once more as it is: a rate limit or a dropped
 * connection says nothing about the range. Failing twice in a row steps the
 * width down. After a run of successes a narrowed width is tried one step
 * wider again, so a passing outage does not slow the rest of the run; if that
 * trial fails the node's limit is real and it is not tried again. Three
 * failures in a row at a single block mean the RPC is not answering at all.
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
    let ceiling = span; // never tried wider than this again
    let widenedFrom: bigint | null = null; // set while a wider width is on trial
    let successes = 0; // in a row, at the current width
    let failures = 0; // in a row, on the current range
    let cursor = args.from;
    let through = args.from - 1n;

    while (cursor <= args.to) {
        if (args.now() >= args.deadline) return { through, complete: false, span };
        const end = cursor + span - 1n > args.to ? args.to : cursor + span - 1n;
        try {
            await args.scan(cursor, end);
            through = end;
            cursor = end + 1n;
            failures = 0;
            successes += 1;
            widenedFrom = null;
            if (span < ceiling && successes >= RECOVER_AFTER) {
                widenedFrom = span;
                span = stepAbove(span, ceiling);
                successes = 0;
            }
        } catch (err) {
            failures += 1;
            successes = 0;
            if (failures >= 2) {
                if (widenedFrom !== null) {
                    // The wider width on trial failed: this node's limit is real.
                    ceiling = widenedFrom;
                    span = widenedFrom;
                    widenedFrom = null;
                    failures = 0;
                } else if (span > 1n) {
                    span = stepBelow(span);
                    failures = 0;
                } else if (failures >= 3) {
                    return { through, complete: false, span, error: describeError(err) };
                }
            }
            await pause(500);
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

// ─── talking to nodes ────────────────────────────────────────────────
//
// Everything the scanner asks a node goes through `post`, one JSON-RPC body
// to one URL. The scanner decides which endpoint to believe itself rather
// than leaving it to a client: with public nodes "answered" and "answered
// correctly" are different things, and the difference decides what gets
// recorded as read.

export type Post = (url: string, body: unknown) => Promise<unknown>;

async function httpPost(url: string, body: unknown): Promise<unknown> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
}

type Reply = { id?: number; result?: unknown; error?: { message?: string; code?: number } };
const request = (method: string, params: unknown[], id = 0) => ({
    jsonrpc: '2.0',
    id,
    method,
    params,
});

/** The result of one reply, or a throw carrying the node's own error text. */
function resultOf(reply: unknown): unknown {
    const r = reply as Reply | null;
    if (!r || typeof r !== 'object') throw new Error('empty reply');
    if (r.error) throw new Error(r.error.message ?? `rpc error ${r.error.code}`);
    return r.result;
}

/** One call, asked of each endpoint in turn until one answers. */
async function ask(
    urls: readonly string[],
    post: Post,
    method: string,
    params: unknown[],
): Promise<unknown> {
    let last: unknown = new Error('no RPC endpoint configured');
    for (const url of urls) {
        try {
            return resultOf(await post(url, request(method, params)));
        } catch (err) {
            last = err;
        }
    }
    throw last;
}

// Endpoints found to answer single requests but not batches, for this run.
const refusesBatches = new Set<string>();

// ─── logs ────────────────────────────────────────────────────────────

export type RpcLog = {
    topics: Hex[];
    data: Hex;
    blockNumber: Hex;
    transactionHash: Hex;
    logIndex: Hex;
};

/**
 * The burn logs in from..to, from the first endpoint that provably has the
 * whole range.
 *
 * A node that is behind the head answers a log query for blocks it has not
 * seen with an empty list, not an error. Taken at face value that marks those
 * blocks as read with nothing in them. So each endpoint is asked for its own
 * block number in the same request, and its logs are only used if it has
 * reached `to`. If no endpoint qualifies the range fails and is tried again.
 */
export async function fetchLogs(args: {
    urls: readonly string[];
    address: string;
    from: bigint;
    to: bigint;
    post?: Post;
}): Promise<RpcLog[]> {
    const post = args.post ?? httpPost;
    const calls = [
        request('eth_blockNumber', [], 0),
        request(
            'eth_getLogs',
            [
                {
                    address: args.address,
                    topics: [DEPOSIT_FOR_BURN_TOPIC],
                    fromBlock: numberToHex(args.from),
                    toBlock: numberToHex(args.to),
                },
            ],
            1,
        ),
    ];

    let last: unknown = new Error('no RPC endpoint configured');
    for (const url of args.urls) {
        try {
            let replies: unknown[] | null = null;
            if (!refusesBatches.has(url)) {
                try {
                    const batch = await post(url, calls);
                    if (!Array.isArray(batch)) throw new Error('not a batch reply');
                    replies = batch;
                } catch {
                    replies = null;
                }
            }
            if (replies === null) {
                // One at a time. The block number is asked first, so a node
                // that passes the check had the range before it was queried.
                const head = await post(url, calls[0]);
                const logs = await post(url, calls[1]);
                refusesBatches.add(url);
                replies = [head, logs];
            }
            const byId = new Map(replies.map((r) => [(r as Reply).id, r]));
            const here = BigInt(resultOf(byId.get(0)) as string);
            if (here < args.to) {
                throw new Error(`${new URL(url).host} is at block ${here}, behind ${args.to}`);
            }
            const logs = resultOf(byId.get(1));
            if (!Array.isArray(logs)) throw new Error('the log query did not return a list');
            return logs as RpcLog[];
        } catch (err) {
            last = err;
        }
    }
    throw last;
}

// ─── transaction inputs ──────────────────────────────────────────────

const lookup = (hash: string, id: number) => ({
    jsonrpc: '2.0',
    id,
    method: 'eth_getTransactionByHash',
    params: [hash],
});

// The input from one reply, if the reply is about the transaction asked for.
// Nodes echo the hash; a reply naming another transaction (a proxy answering a
// batch out of order) is not used.
const inputOf = (reply: unknown, hash: string): string | null => {
    const result = (reply as { result?: { input?: unknown; hash?: unknown } } | null)?.result;
    if (!result || typeof result.input !== 'string') return null;
    if (typeof result.hash === 'string' && result.hash.toLowerCase() !== hash.toLowerCase()) {
        return null;
    }
    return result.input;
};

const BATCH = 25;
const SINGLE_CONCURRENCY = 8;

/**
 * The input of each transaction, by hash. This is the bulk of a scan (one
 * lookup per burn on the chain), so it is batched wherever the endpoint
 * allows, which is ten times faster than asking one at a time.
 *
 * Endpoints are asked in order, each only for what the ones before it could
 * not return: public nodes do sometimes serve a log and then answer null for
 * its transaction. A transaction nobody returns fails the range. Skipping it
 * could silently drop a tagged burn from the count.
 */
export async function fetchInputs(args: {
    urls: readonly string[];
    hashes: readonly Hex[];
    post?: Post;
}): Promise<Map<Hex, string>> {
    const post = args.post ?? httpPost;
    const inputs = new Map<Hex, string>();
    let missing = [...new Set(args.hashes)];

    for (const url of args.urls) {
        if (missing.length === 0) break;

        if (!refusesBatches.has(url)) {
            try {
                for (let i = 0; i < missing.length; i += BATCH) {
                    const chunk = missing.slice(i, i + BATCH);
                    const replies = await post(
                        url,
                        chunk.map((hash, id) => lookup(hash, id)),
                    );
                    if (!Array.isArray(replies)) throw new Error('not a batch reply');
                    for (const reply of replies) {
                        const hash = chunk[(reply as { id?: number }).id ?? -1];
                        const input = hash ? inputOf(reply, hash) : null;
                        if (hash && input !== null) inputs.set(hash, input);
                    }
                }
            } catch {
                // Either this endpoint does not take batches or it is not
                // answering at all. One single request tells which, so a dead
                // endpoint costs two requests rather than one per transaction.
                const probe = missing.find((hash) => !inputs.has(hash));
                try {
                    if (probe) {
                        const input = inputOf(await post(url, lookup(probe, 0)), probe);
                        if (input !== null) inputs.set(probe, input);
                    }
                    refusesBatches.add(url);
                } catch {
                    missing = missing.filter((hash) => !inputs.has(hash));
                    continue;
                }
            }
        }

        if (refusesBatches.has(url)) {
            const todo = missing.filter((hash) => !inputs.has(hash));
            await mapLimit(todo, SINGLE_CONCURRENCY, async (hash) => {
                try {
                    const input = inputOf(await post(url, lookup(hash, 0)), hash);
                    if (input !== null) inputs.set(hash, input);
                } catch {
                    // Left for the next endpoint.
                }
            });
        }
        missing = missing.filter((hash) => !inputs.has(hash));
    }

    if (missing.length > 0) {
        throw new Error(`transaction ${missing[0]} was not returned by any endpoint`);
    }
    return inputs;
}

// ─── the scan ────────────────────────────────────────────────────────

// How far behind the head the scan stops, in time. Far enough that every
// endpoint in the list has the blocks and that a reorganised block is never
// counted; a fixed number of blocks would be seconds on a fast chain.
const MARGIN_SECONDS = 900;
export const DEFAULT_SPAN = 2_000n;

export async function scanEvmChain(args: {
    entry: EvmChainEntry;
    rpcUrls: readonly string[];
    /** Last block already scanned, or null on this chain's first run. */
    fromBlock: bigint | null;
    /** Where a first run starts. */
    since: Date;
    deadline: number;
    initialSpan?: bigint;
    /** The suffix to look for; the usage tag unless a check passes another. */
    suffix?: string;
    destOf: (domain: number) => string | null;
    post?: Post;
    pause?: (ms: number) => Promise<void>;
}): Promise<{
    records: TransferRecord[];
    through: bigint | null;
    /** Burns examined, tagged or not. */
    seen: number;
    coverage: ChainCoverage;
}> {
    const { entry } = args;
    const post = args.post ?? httpPost;

    const times = new Map<bigint, number>();
    const timestampOf = async (block: bigint): Promise<number> => {
        const known = times.get(block);
        if (known !== undefined) return known;
        const found = (await ask(args.rpcUrls, post, 'eth_getBlockByNumber', [
            numberToHex(block),
            false,
        ])) as { timestamp?: string } | null;
        if (!found?.timestamp) throw new Error(`block ${block} was not returned`);
        const time = Number(BigInt(found.timestamp));
        times.set(block, time);
        return time;
    };
    const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

    const records: TransferRecord[] = [];
    let seen = 0;
    let through = args.fromBlock;
    try {
        const head = BigInt((await ask(args.rpcUrls, post, 'eth_blockNumber', [])) as string);

        // The margin in blocks, from how fast this chain has been producing them.
        const sample = head < 2_000n ? head : 2_000n;
        const elapsed =
            sample > 0n ? (await timestampOf(head)) - (await timestampOf(head - sample)) : 0;
        const perBlock = elapsed > 0 ? elapsed / Number(sample) : 1;
        const margin = BigInt(Math.max(64, Math.ceil(MARGIN_SECONDS / perBlock)));
        const safeHead = head > margin ? head - margin : 0n;

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
            initialSpan: args.initialSpan ?? DEFAULT_SPAN,
            deadline: args.deadline,
            now: Date.now,
            pause: args.pause,
            scan: async (from, to) => {
                const logs = await fetchLogs({
                    urls: args.rpcUrls,
                    address: entry.tokenMessenger,
                    from,
                    to,
                    post,
                });
                if (logs.length === 0) return;

                const inputs = await fetchInputs({
                    urls: args.rpcUrls,
                    hashes: logs.map((log) => log.transactionHash),
                    post,
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
            seen,
            coverage: { chain: entry.id, status: 'error', through: null, note: describeError(err) },
        };
    }
}
