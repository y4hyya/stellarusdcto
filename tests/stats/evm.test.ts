import { describe, expect, test } from 'vitest';
import {
    DEPOSIT_FOR_BURN_TOPIC,
    burnRecord,
    decodeBurnLog,
    fetchInputs,
    fetchLogs,
    firstBlockAtOrAfter,
    runRanges,
    scanEvmChain,
} from '../../scripts/stats/evm';
import { EVM_TAG_SUFFIX } from '../../src/lib/attribution/tag';
import { MAINNET } from '../../src/lib/registry/index';
import type { EvmChainEntry } from '../../src/lib/registry/types';

// Two real DepositForBurn logs from Ethereum mainnet (blocks 26429688 and
// 26429697). The expected values below were read straight off the raw words,
// not produced by the decoder under test.
const PLAIN_LOG = {
    topics: [
        '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5',
        '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        '0x0000000000000000000000001b1264e08b4bbcabeacb3cca2bf0475fc2276e2e',
        '0x00000000000000000000000000000000000000000000000000000000000007d0',
    ],
    data: '0x00000000000000000000000000000000000000000000000000000007080f6ff40000000000000000000000001b1264e08b4bbcabeacb3cca2bf0475fc2276e2e000000000000000000000000000000000000000000000000000000000000000600000000000000000000000028b5a0e9c621a5badaa536219b3a228c8168cf5d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000000',
} as const;

const HOOK_LOG = {
    topics: [
        '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5',
        '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        '0x000000000000000000000000c1062b7c5dc8e4b1df9f200fe360cdc0ed6e7741',
        '0x0000000000000000000000000000000000000000000000000000000000000001',
    ],
    data: '0x0000000000000000000000000000000000000000000000000000000000b33e1e000000000000000000000000c1062b7c5dc8e4b1df9f200fe360cdc0ed6e7741000000000000000000000000000000000000000000000000000000000000000600000000000000000000000028b5a0e9c621a5badaa536219b3a228c8168cf5d000000000000000000000000c1062b7c5dc8e4b1df9f200fe360cdc0ed6e7741000000000000000000000000000000000000000000000000000000000000050e00000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000008a0300000000000000000000000027b737daeba85b46a9faf17718e1db578a02147c0000000000000000000000000000000000000000000000000000000000000000000000000009bd5100000000000000000000000000002a000000000000000c24000000006afb61050000000000000000000000009899f62ecf16b70bffc88677023026c47e48c2181900000000000000000000000000000000000000000000',
} as const;

describe('reading a burn log', () => {
    test('the event topic is the one Circle contracts really emit', () => {
        expect(DEPOSIT_FOR_BURN_TOPIC).toBe(
            '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5',
        );
    });

    test('a plain burn: depositor, amount and destination domain', () => {
        const burn = decodeBurnLog(PLAIN_LOG);
        expect(burn.depositor.toLowerCase()).toBe('0x1b1264e08b4bbcabeacb3cca2bf0475fc2276e2e');
        expect(burn.amount).toBe(30_200_000_500n);
        expect(burn.destDomain).toBe(6);
    });

    test('a burn with hook data decodes the same fields', () => {
        const burn = decodeBurnLog(HOOK_LOG);
        expect(burn.depositor.toLowerCase()).toBe('0xc1062b7c5dc8e4b1df9f200fe360cdc0ed6e7741');
        expect(burn.amount).toBe(11_746_846n);
        expect(burn.destDomain).toBe(6);
    });

    test('a log of some other event is refused', () => {
        const other = {
            ...PLAIN_LOG,
            topics: ['0x' + '11'.repeat(32), ...PLAIN_LOG.topics.slice(1)],
        };
        expect(() => decodeBurnLog(other as never)).toThrow();
    });
});

describe('a counted burn', () => {
    test('is identified by chain, transaction and log position', () => {
        const record = burnRecord({
            chain: 'ethereum',
            tx: '0x7e145b24ae90684a2750845608c295e1bd196e16fa17069e6964297c072fa0d4',
            logIndex: 273,
            time: '2026-11-16T20:00:11.000Z',
            burn: decodeBurnLog(PLAIN_LOG),
            dest: 'base',
        });
        expect(record).toEqual({
            id: 'ethereum:0x7e145b24ae90684a2750845608c295e1bd196e16fa17069e6964297c072fa0d4:273',
            chain: 'ethereum',
            tx: '0x7e145b24ae90684a2750845608c295e1bd196e16fa17069e6964297c072fa0d4',
            time: '2026-11-16T20:00:11.000Z',
            from: '0x1B1264e08B4BbCabeacb3Cca2bf0475fC2276e2E',
            amount: '30200000500',
            destDomain: 6,
            dest: 'base',
            nonce: null,
        });
    });
});

// A scripted scan: records every range it is asked for and fails on demand.
function scripted(shouldFail: (from: bigint, to: bigint) => string | null) {
    const done: [bigint, bigint][] = [];
    const attempts: [bigint, bigint][] = [];
    return {
        done,
        attempts,
        scan: async (from: bigint, to: bigint) => {
            attempts.push([from, to]);
            const failure = shouldFail(from, to);
            if (failure) throw new Error(failure);
            done.push([from, to]);
        },
    };
}

const base = {
    initialSpan: 1000n,
    deadline: 1_000,
    now: () => 0,
    pause: async () => {},
};

/** Every block from..to scanned exactly once, in order. */
function expectContiguous(done: [bigint, bigint][], from: bigint, to: bigint) {
    let next = from;
    for (const [a, b] of done) {
        expect(a).toBe(next);
        expect(b >= a).toBe(true);
        next = b + 1n;
    }
    expect(next).toBe(to + 1n);
}

describe('walking a block range', () => {
    test('a healthy RPC: the whole range is scanned once, in order', async () => {
        const s = scripted(() => null);
        const result = await runRanges({ ...base, from: 100n, to: 3_599n, scan: s.scan });
        expect(result.complete).toBe(true);
        expect(result.through).toBe(3_599n);
        expect(result.error).toBeUndefined();
        expectContiguous(s.done, 100n, 3_599n);
        expect(s.done).toHaveLength(4);
    });

    test('an RPC that refuses wide ranges: the span shrinks until it is accepted', async () => {
        const s = scripted((from, to) => (to - from + 1n > 100n ? 'block range too large' : null));
        const result = await runRanges({ ...base, from: 0n, to: 999n, scan: s.scan });
        expect(result.complete).toBe(true);
        expect(result.through).toBe(999n);
        expectContiguous(s.done, 0n, 999n);
        for (const [a, b] of s.done) expect(b - a + 1n <= 100n).toBe(true);
        // Each refused width is tried twice on the way down (once could be a
        // hiccup), and one step back up is tried once later. Never more.
        expect(s.attempts.filter(([a, b]) => b - a + 1n > 100n).length).toBeLessThanOrEqual(6);
        // Widths step down through the limits public RPCs actually use, so a
        // 100 block limit is met exactly instead of undershot.
        expect(result.span).toBe(100n);
        expect(s.done).toHaveLength(10);
    });

    test('a 50 block limit and a single block limit are found the same way', async () => {
        const fifty = scripted((from, to) =>
            to - from + 1n > 50n ? 'limited to 0 - 50 blocks' : null,
        );
        const a = await runRanges({ ...base, from: 0n, to: 199n, scan: fifty.scan });
        expect(a).toMatchObject({ complete: true, through: 199n, span: 50n });

        const one = scripted((from, to) => (to > from ? 'one block at a time' : null));
        const b = await runRanges({ ...base, from: 0n, to: 4n, scan: one.scan });
        expect(b).toMatchObject({ complete: true, through: 4n, span: 1n });
        expectContiguous(one.done, 0n, 4n);
    });

    test('a hard limit is probed a bounded number of times however long the range', async () => {
        const s = scripted((from, to) => (to - from + 1n > 100n ? 'block range too large' : null));
        const result = await runRanges({ ...base, from: 0n, to: 9_999n, scan: s.scan });
        expect(result.complete).toBe(true);
        expectContiguous(s.done, 0n, 9_999n);
        expect(s.done).toHaveLength(100);
        expect(s.attempts.length - s.done.length).toBeLessThanOrEqual(6);
    });

    test('one failed request is retried at the same width, not answered by narrowing', async () => {
        // A rate limit or a dropped connection says nothing about the range.
        let failed = false;
        const s = scripted((from) => {
            if (from === 2_000n && !failed) {
                failed = true;
                return 'HTTP 429';
            }
            return null;
        });
        const result = await runRanges({ ...base, from: 0n, to: 4_999n, scan: s.scan });
        expect(result).toMatchObject({ complete: true, through: 4_999n, span: 1_000n });
        expect(s.done).toHaveLength(5);
        expectContiguous(s.done, 0n, 4_999n);
    });

    test('a width narrowed by a passing problem recovers once requests succeed again', async () => {
        let failures = 0;
        const s = scripted((from) => {
            // The same request fails twice in a row, once: an outage, not a limit.
            if (from === 1_000n && failures < 2) {
                failures += 1;
                return 'connection reset';
            }
            return null;
        });
        const result = await runRanges({ ...base, from: 0n, to: 19_999n, scan: s.scan });
        expect(result.complete).toBe(true);
        expectContiguous(s.done, 0n, 19_999n);
        const widths = s.done.map(([a, b]) => b - a + 1n);
        expect(widths[0]).toBe(1_000n);
        expect(widths[1]).toBe(500n);
        // Back at the full width by the end.
        expect(widths[widths.length - 1]).toBe(1_000n);
        expect(result.span).toBe(1_000n);
    });

    test('an RPC that dies part way: progress stops at the last range that completed', async () => {
        const s = scripted((from) => (from >= 2_000n ? 'connection reset' : null));
        const result = await runRanges({ ...base, from: 0n, to: 9_999n, scan: s.scan });
        expect(result.complete).toBe(false);
        expect(result.through).toBe(1_999n);
        expect(result.error).toContain('connection reset');
        expectContiguous(s.done, 0n, 1_999n);
    });

    test('nothing scanned at all leaves the checkpoint just before the start', async () => {
        const s = scripted(() => 'rpc down');
        const result = await runRanges({ ...base, from: 500n, to: 900n, scan: s.scan });
        expect(result.complete).toBe(false);
        expect(result.through).toBe(499n);
        expect(s.done).toEqual([]);
    });

    test('running out of time is not an error: it stops and continues next run', async () => {
        let clock = 0;
        const s = scripted(() => null);
        const result = await runRanges({
            ...base,
            from: 0n,
            to: 9_999n,
            now: () => (clock += 400),
            scan: s.scan,
        });
        expect(result.complete).toBe(false);
        expect(result.error).toBeUndefined();
        expect(result.through).toBe(1_999n);
        expectContiguous(s.done, 0n, 1_999n);
    });

    test('an empty range is complete without a single request', async () => {
        const s = scripted(() => null);
        const result = await runRanges({ ...base, from: 50n, to: 49n, scan: s.scan });
        expect(result).toMatchObject({ complete: true, through: 49n });
        expect(s.attempts).toEqual([]);
    });
});

describe('finding where to start on a first run', () => {
    // A chain with a block every two seconds, genesis at time 1,000,000.
    const head = 1_000_000n;
    const chain = () => {
        const probed: bigint[] = [];
        return {
            probed,
            timestampOf: async (block: bigint) => {
                probed.push(block);
                return 1_000_000 + Number(block) * 2;
            },
        };
    };

    test('the first block at or after the target time', async () => {
        const c = chain();
        const target = 1_000_000 + 900_000 * 2 + 1; // between blocks 900000 and 900001
        expect(await firstBlockAtOrAfter({ head, target, timestampOf: c.timestampOf })).toBe(
            900_001n,
        );
        expect(c.probed.length).toBeLessThan(60);
    });

    test('a target that is exactly a block time starts at that block', async () => {
        const c = chain();
        const target = 1_000_000 + 999_990 * 2;
        expect(await firstBlockAtOrAfter({ head, target, timestampOf: c.timestampOf })).toBe(
            999_990n,
        );
    });

    test('it never reaches further back than it has to', async () => {
        const c = chain();
        const target = 1_000_000 + 999_000 * 2;
        await firstBlockAtOrAfter({ head, target, timestampOf: c.timestampOf });
        // Old blocks are exactly what pruned public nodes cannot serve.
        expect(c.probed.every((b) => b >= 990_000n)).toBe(true);
    });

    test('a target after the head leaves nothing to scan', async () => {
        const c = chain();
        const target = 1_000_000 + 1_000_000 * 2 + 50;
        expect(await firstBlockAtOrAfter({ head, target, timestampOf: c.timestampOf })).toBe(
            head + 1n,
        );
    });

    test('a target before the chain existed starts at the first block', async () => {
        const c = chain();
        expect(await firstBlockAtOrAfter({ head, target: 5, timestampOf: c.timestampOf })).toBe(0n);
    });
});

// A scripted set of RPC endpoints. Each knows some transactions and may or
// may not accept batched requests, like the public ones do.
type Request = { id: number; method: string; params: [string] };
function endpoints(spec: Record<string, { knows: string[]; batches?: boolean; down?: boolean }>) {
    const calls: { url: string; size: number | 'single' }[] = [];
    const answer = (url: string, request: Request) => ({
        jsonrpc: '2.0',
        id: request.id,
        result: spec[url].knows.includes(request.params[0])
            ? { hash: request.params[0], input: `0xinput-of-${request.params[0]}` }
            : null,
    });
    return {
        calls,
        post: async (url: string, body: unknown) => {
            const endpoint = spec[url];
            if (endpoint.down) {
                calls.push({ url, size: Array.isArray(body) ? body.length : 'single' });
                throw new Error('HTTP 503');
            }
            if (Array.isArray(body)) {
                calls.push({ url, size: body.length });
                if (endpoint.batches === false) throw new Error('HTTP 413');
                return (body as Request[]).map((request) => answer(url, request));
            }
            calls.push({ url, size: 'single' });
            return answer(url, body as Request);
        },
    };
}

const hashes = (n: number) => Array.from({ length: n }, (_, i) => `0xhash${i}` as `0x${string}`);

describe('fetching the input of each burn transaction', () => {
    test('an endpoint that accepts batches is asked in batches of 25', async () => {
        const all = hashes(60);
        const rpc = endpoints({ a: { knows: all } });
        const inputs = await fetchInputs({ urls: ['a'], hashes: all, post: rpc.post });
        expect(inputs.size).toBe(60);
        expect(inputs.get('0xhash7')).toBe('0xinput-of-0xhash7');
        expect(rpc.calls).toEqual([
            { url: 'a', size: 25 },
            { url: 'a', size: 25 },
            { url: 'a', size: 10 },
        ]);
    });

    test('a transaction one endpoint cannot return is asked of the next, and only that one', async () => {
        // Seen on mainnet: a node served a burn log but answered null for its transaction.
        const all = hashes(3);
        const rpc = endpoints({ a: { knows: ['0xhash0', '0xhash2'] }, b: { knows: all } });
        const inputs = await fetchInputs({ urls: ['a', 'b'], hashes: all, post: rpc.post });
        expect([...inputs.keys()].sort()).toEqual(all);
        expect(inputs.get('0xhash1')).toBe('0xinput-of-0xhash1');
        expect(rpc.calls).toEqual([
            { url: 'a', size: 3 },
            { url: 'b', size: 1 },
        ]);
    });

    test('an endpoint that refuses batches is asked one transaction at a time', async () => {
        const all = hashes(4);
        const rpc = endpoints({ refuser: { knows: all, batches: false } });
        const inputs = await fetchInputs({ urls: ['refuser'], hashes: all, post: rpc.post });
        expect(inputs.size).toBe(4);
        expect(rpc.calls.filter((c) => c.size === 'single')).toHaveLength(4);
        // Having learned that, it does not try a batch there again.
        rpc.calls.length = 0;
        await fetchInputs({ urls: ['refuser'], hashes: all, post: rpc.post });
        expect(rpc.calls.every((c) => c.size === 'single')).toBe(true);
    });

    test('a reply that names a different transaction is not used for the one asked about', async () => {
        // A proxy that answers a batch out of order must not pin one burn's
        // input on another.
        const all = hashes(2);
        const shuffled = {
            post: async (_url: string, body: unknown) =>
                (body as Request[]).map((request, i, list) => {
                    const other = list[(i + 1) % list.length];
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        result: { hash: other.params[0], input: `0xinput-of-${other.params[0]}` },
                    };
                }),
        };
        const good = endpoints({ b: { knows: all } });
        const post = (url: string, body: unknown) =>
            url === 'shuffler' ? shuffled.post(url, body) : good.post(url, body);
        const inputs = await fetchInputs({ urls: ['shuffler', 'b'], hashes: all, post });
        expect(inputs.get('0xhash0')).toBe('0xinput-of-0xhash0');
        expect(inputs.get('0xhash1')).toBe('0xinput-of-0xhash1');
    });

    test('an endpoint that is down costs two requests, not one per transaction', async () => {
        const all = hashes(40);
        const rpc = endpoints({ dead: { knows: all, down: true }, b: { knows: all } });
        const inputs = await fetchInputs({ urls: ['dead', 'b'], hashes: all, post: rpc.post });
        expect(inputs.size).toBe(40);
        expect(rpc.calls.filter((c) => c.url === 'dead')).toHaveLength(2);
    });

    test('an endpoint that is down is skipped for the next one', async () => {
        const all = hashes(2);
        const rpc = endpoints({ a: { knows: all, down: true }, b: { knows: all } });
        const inputs = await fetchInputs({ urls: ['a', 'b'], hashes: all, post: rpc.post });
        expect(inputs.size).toBe(2);
    });

    test('a transaction no endpoint returns fails the range rather than being skipped', async () => {
        // Skipping it could silently drop a tagged burn from the count.
        const rpc = endpoints({ a: { knows: [] }, b: { knows: [] } });
        await expect(
            fetchInputs({ urls: ['a', 'b'], hashes: ['0xhash0'], post: rpc.post }),
        ).rejects.toThrow(/0xhash0/);
    });

    test('no transactions means no requests', async () => {
        const rpc = endpoints({ a: { knows: [] } });
        expect((await fetchInputs({ urls: ['a'], hashes: [], post: rpc.post })).size).toBe(0);
        expect(rpc.calls).toEqual([]);
    });
});

// ─── a scripted chain ────────────────────────────────────────────────
//
// Enough of an EVM node to run the real scanner against, offline: a block
// every two seconds, burn logs in chosen blocks, and the transactions they
// came from. Each endpoint can lag behind, refuse log queries, refuse batches
// or fail from a given block on, like the public ones do.

const BASE_ENTRY = MAINNET.chains.find((c) => c.id === 'base') as EvmChainEntry;
const GENESIS = 1_700_000_000;
const BLOCK_SECONDS = 2;
const txHash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;

type Burn = { block: number; tx: number; tagged: boolean };
type Endpoint = {
    /** Blocks this endpoint is behind the real head. */
    behind?: number;
    refuseLogs?: boolean;
    refuseBatches?: boolean;
    /** Log queries touching this block or later fail. */
    failLogsFrom?: number;
};

function chain(head: number, burns: Burn[], endpoints: Record<string, Endpoint>) {
    const logQueries: { url: string; from: number; to: number }[] = [];
    const answer = (url: string, request: { id: number; method: string; params: unknown[] }) => {
        const endpoint = endpoints[url];
        const here = head - (endpoint.behind ?? 0);
        const ok = (result: unknown) => ({ jsonrpc: '2.0', id: request.id, result });
        const fail = (message: string) => ({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32000, message },
        });
        switch (request.method) {
            case 'eth_blockNumber':
                return ok(`0x${here.toString(16)}`);
            case 'eth_getBlockByNumber': {
                const number = parseInt(request.params[0] as string, 16);
                if (number > here) return ok(null);
                return ok({
                    number: request.params[0],
                    timestamp: `0x${(GENESIS + number * BLOCK_SECONDS).toString(16)}`,
                });
            }
            case 'eth_getLogs': {
                const filter = request.params[0] as { fromBlock: string; toBlock: string };
                const from = parseInt(filter.fromBlock, 16);
                const to = parseInt(filter.toBlock, 16);
                logQueries.push({ url, from, to });
                if (endpoint.refuseLogs) return fail('eth_getLogs is not available');
                if (endpoint.failLogsFrom !== undefined && to >= endpoint.failLogsFrom) {
                    return fail('connection reset');
                }
                // A node that is behind simply has nothing for blocks it has not seen.
                return ok(
                    burns
                        .filter((b) => b.block >= from && b.block <= to && b.block <= here)
                        .map((b) => ({
                            ...PLAIN_LOG,
                            blockNumber: `0x${b.block.toString(16)}`,
                            transactionHash: txHash(b.tx),
                            logIndex: '0x7',
                        })),
                );
            }
            case 'eth_getTransactionByHash': {
                const hash = request.params[0] as string;
                const burn = burns.find((b) => txHash(b.tx) === hash);
                if (!burn || burn.block > here) return ok(null);
                const input =
                    '0x8e0250ee' + '00'.repeat(64) + (burn.tagged ? EVM_TAG_SUFFIX.slice(2) : '');
                return ok({ hash, input });
            }
            default:
                return fail(`unexpected ${request.method}`);
        }
    };
    return {
        logQueries,
        post: async (url: string, body: unknown) => {
            if (Array.isArray(body)) {
                if (endpoints[url].refuseBatches) throw new Error('HTTP 413');
                return body.map((request) => answer(url, request));
            }
            return answer(url, body as never);
        },
    };
}

const destOf = (domain: number) => (domain === 6 ? 'base' : domain === 27 ? 'stellar' : null);
const scanArgs = {
    entry: BASE_ENTRY,
    since: new Date((GENESIS + 1_000 * BLOCK_SECONDS) * 1000),
    deadline: Number.MAX_SAFE_INTEGER,
    destOf,
    pause: async () => {},
};

describe('asking for logs', () => {
    const query = { address: BASE_ENTRY.tokenMessenger, from: 101n, to: 936n };

    test('an endpoint that has the whole range answers', async () => {
        const c = chain(1_000, [{ block: 500, tx: 1, tagged: true }], { a: {} });
        const logs = await fetchLogs({ urls: ['a'], ...query, post: c.post });
        expect(logs.map((l) => l.transactionHash)).toEqual([txHash(1)]);
    });

    test('an endpoint that is behind the range is not believed, even when it answers', async () => {
        // The first endpoint refuses log queries. The second is at block 900
        // and answers "no logs" for 101 to 936, though it has never seen 901
        // to 936. That must not count as an answer.
        const c = chain(1_000, [{ block: 920, tx: 1, tagged: true }], {
            a: { refuseLogs: true },
            b: { behind: 100 },
        });
        await expect(fetchLogs({ urls: ['a', 'b'], ...query, post: c.post })).rejects.toThrow();
    });

    test('a lagging endpoint is passed over for one that is up to date', async () => {
        const c = chain(1_000, [{ block: 920, tx: 1, tagged: true }], {
            lagging: { behind: 100 },
            current: {},
        });
        const logs = await fetchLogs({ urls: ['lagging', 'current'], ...query, post: c.post });
        expect(logs).toHaveLength(1);
    });

    test('an endpoint that refuses batches is asked in two requests and still checked', async () => {
        const c = chain(1_000, [{ block: 500, tx: 1, tagged: true }], {
            nobatch: { refuseBatches: true },
        });
        expect(await fetchLogs({ urls: ['nobatch'], ...query, post: c.post })).toHaveLength(1);
        const behind = chain(1_000, [], { nobatch2: { refuseBatches: true, behind: 100 } });
        await expect(
            fetchLogs({ urls: ['nobatch2'], ...query, post: behind.post }),
        ).rejects.toThrow();
    });
});

describe('scanning a chain end to end', () => {
    const burns: Burn[] = [
        { block: 900, tx: 1, tagged: true }, // before counting starts
        { block: 1_200, tx: 2, tagged: true },
        { block: 1_300, tx: 3, tagged: false },
        { block: 4_400, tx: 4, tagged: true },
        { block: 4_990, tx: 5, tagged: true }, // too close to the head to count yet
    ];

    test('a first run starts at the counting date and keeps only tagged burns', async () => {
        const c = chain(5_000, burns, { a: {} });
        const result = await scanEvmChain({
            ...scanArgs,
            rpcUrls: ['a'],
            fromBlock: null,
            post: c.post,
        });
        expect(result.coverage.status).toBe('ok');
        expect(result.records.map((r) => r.tx)).toEqual([txHash(2), txHash(4)]);
        expect(result.seen).toBe(3);
        expect(result.records[0]).toEqual({
            id: `base:${txHash(2)}:7`,
            chain: 'base',
            tx: txHash(2),
            time: new Date((GENESIS + 1_200 * BLOCK_SECONDS) * 1000).toISOString(),
            from: '0x1B1264e08B4BbCabeacb3Cca2bf0475fC2276e2E',
            amount: '30200000500',
            destDomain: 6,
            dest: 'base',
            nonce: null,
        });
        // Nothing before the counting date was asked for.
        expect(Math.min(...c.logQueries.map((q) => q.from))).toBe(1_000);
    });

    test('it stays a quarter of an hour behind the head, not a fixed few blocks', async () => {
        const c = chain(5_000, burns, { a: {} });
        const result = await scanEvmChain({
            ...scanArgs,
            rpcUrls: ['a'],
            fromBlock: null,
            post: c.post,
        });
        // 900 seconds at two seconds a block is 450 blocks.
        expect(result.through).toBe(4_550n);
        expect(result.coverage.through).toBe(
            new Date((GENESIS + 4_550 * BLOCK_SECONDS) * 1000).toISOString(),
        );
    });

    test('a later run reads only what is new', async () => {
        const c = chain(5_000, burns, { a: {} });
        const result = await scanEvmChain({
            ...scanArgs,
            rpcUrls: ['a'],
            fromBlock: 4_550n,
            post: c.post,
        });
        expect(result.records).toEqual([]);
        expect(result.through).toBe(4_550n);
        expect(c.logQueries).toEqual([]);
    });

    test('only endpoints that are behind can answer: nothing is marked as read', async () => {
        const c = chain(5_000, burns, { a: { refuseLogs: true }, b: { behind: 1_000 } });
        const result = await scanEvmChain({
            ...scanArgs,
            rpcUrls: ['a', 'b'],
            fromBlock: 4_100n,
            post: c.post,
        });
        expect(result.coverage.status).toBe('error');
        expect(result.through).toBe(4_100n);
        expect(result.records).toEqual([]);
    });

    test('an RPC that fails part way keeps what was read and stops the checkpoint there', async () => {
        const c = chain(5_000, burns, { a: { failLogsFrom: 3_000 } });
        const result = await scanEvmChain({
            ...scanArgs,
            rpcUrls: ['a'],
            fromBlock: null,
            post: c.post,
        });
        expect(result.coverage.status).toBe('error');
        expect(result.records.map((r) => r.tx)).toEqual([txHash(2)]);
        expect(result.through !== null && result.through >= 1_300n && result.through < 3_000n).toBe(
            true,
        );
    });

    test('an RPC that does not answer at all reports an error and moves nothing', async () => {
        const result = await scanEvmChain({
            ...scanArgs,
            rpcUrls: ['dead'],
            fromBlock: 4_100n,
            post: async () => {
                throw new Error('HTTP 503');
            },
        });
        expect(result.coverage).toMatchObject({ chain: 'base', status: 'error' });
        expect(result.through).toBe(4_100n);
    });
});
