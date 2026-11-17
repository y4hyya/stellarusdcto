import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
    collectSignatures,
    decodeSolanaBurns,
    scanSolana,
    type SignatureInfo,
} from '../../scripts/stats/solana';
import { MAINNET } from '../../src/lib/registry/index';
import type { SolanaChainEntry } from '../../src/lib/registry/types';

const PROGRAM = 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe';
const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

// Two real mainnet burns. Expected values were read from the raw instruction
// bytes when the fixtures were captured, not produced by this decoder.
describe('reading a burn out of a Solana transaction', () => {
    test('deposit_for_burn_with_hook in a legacy transaction', () => {
        expect(decodeSolanaBurns(fixture('solana-burn-hook.json'), PROGRAM)).toEqual([
            {
                index: 0,
                owner: '2S5iaGNfK6EAUVGymFX3QjxVgAxtJ4UhSntYmHB2zd83',
                amount: 114_554_200n,
                destDomain: 19,
            },
        ]);
    });

    test('plain deposit_for_burn among other instructions in a v0 transaction', () => {
        const burns = decodeSolanaBurns(fixture('solana-burn-plain.json'), PROGRAM);
        expect(burns).toHaveLength(1);
        expect(burns[0]).toMatchObject({
            owner: 'JDDa5PHbVp6oAR94cX3VetfFY7jVrNWK8yTpRino6ABB',
            amount: 30_736_734n,
            destDomain: 0,
        });
    });

    test('a transaction that touches another program holds no burn', () => {
        const tx = fixture('solana-burn-hook.json');
        expect(decodeSolanaBurns(tx, '11111111111111111111111111111111')).toEqual([]);
    });

    test('an instruction of the program that is not a burn is ignored', () => {
        const tx = fixture('solana-burn-hook.json');
        // Corrupt the discriminator: same program, some other instruction.
        tx.transaction.message.instructions[0].data =
            '1111' + tx.transaction.message.instructions[0].data.slice(4);
        expect(decodeSolanaBurns(tx, PROGRAM)).toEqual([]);
    });
});

const sig = (n: number, blockTime: number, memo: string | null = null): SignatureInfo => ({
    signature: `sig${n}`,
    blockTime,
    err: null,
    memo,
});

describe('paging through a program history, newest first', () => {
    const base = { checkpoint: null, sinceSec: 0, deadline: 1_000, now: () => 0, pageSize: 3 };

    test('pages are followed until the checkpoint is seen, and nothing from it on is kept', async () => {
        const asked: (string | null)[] = [];
        const pages = [
            [sig(9, 900), sig(8, 800), sig(7, 700)],
            [sig(6, 600), sig(5, 500), sig(4, 400)],
            [sig(3, 300), sig(2, 200), sig(1, 100)],
        ];
        const result = await collectSignatures({
            ...base,
            checkpoint: 'sig3',
            fetchPage: async (before) => {
                asked.push(before);
                return pages.shift() ?? [];
            },
        });
        expect(asked).toEqual([null, 'sig7', 'sig4']);
        expect(result.outcome).toBe('reached');
        expect(result.entries.map((e) => e.signature)).toEqual([
            'sig9',
            'sig8',
            'sig7',
            'sig6',
            'sig5',
            'sig4',
        ]);
    });

    test('nothing new: the first signature is the checkpoint', async () => {
        const result = await collectSignatures({
            ...base,
            checkpoint: 'sig9',
            fetchPage: async () => [sig(9, 900), sig(8, 800), sig(7, 700)],
        });
        expect(result).toMatchObject({ outcome: 'reached', entries: [] });
    });

    test('a first run stops at the start time and keeps nothing older', async () => {
        const pages = [
            [sig(9, 900), sig(8, 800), sig(7, 700)],
            [sig(6, 600), sig(5, 500), sig(4, 400)],
            [sig(3, 300), sig(2, 200), sig(1, 100)],
        ];
        let calls = 0;
        const result = await collectSignatures({
            ...base,
            sinceSec: 550,
            fetchPage: async () => {
                calls += 1;
                return pages.shift() ?? [];
            },
        });
        expect(calls).toBe(2);
        expect(result.outcome).toBe('reached');
        expect(result.entries.map((e) => e.signature)).toEqual(['sig9', 'sig8', 'sig7', 'sig6']);
    });

    test('a node whose history ends before the checkpoint has not finished the scan', async () => {
        // A short page only proves this node has nothing older. It says
        // nothing about whether the checkpoint was reached.
        const pages = [[sig(9, 900), sig(8, 800), sig(7, 700)], [sig(6, 600)]];
        const result = await collectSignatures({
            ...base,
            checkpoint: 'sig2',
            fetchPage: async () => pages.shift() ?? [],
        });
        expect(result.outcome).toBe('exhausted');
        expect(result.entries).toHaveLength(4);
    });

    test('a node with no history at all has not finished the scan either', async () => {
        const result = await collectSignatures({ ...base, fetchPage: async () => [] });
        expect(result).toMatchObject({ outcome: 'exhausted', entries: [] });
    });

    test('running out of time reports where it stopped', async () => {
        let clock = 0;
        const result = await collectSignatures({
            ...base,
            checkpoint: 'sig1',
            now: () => (clock += 600),
            fetchPage: async () => [sig(9, 900), sig(8, 800), sig(7, 700)],
        });
        expect(result.outcome).toBe('timeout');
        expect(result.entries).toHaveLength(3);
        expect(result.lastSeen).toBe('sig7');
    });

    test('an unfinished scan is picked up from where it stopped', async () => {
        const asked: (string | null)[] = [];
        const result = await collectSignatures({
            ...base,
            checkpoint: 'sig4',
            startBefore: 'sig7',
            fetchPage: async (before) => {
                asked.push(before);
                return [sig(6, 600), sig(5, 500), sig(4, 400)];
            },
        });
        expect(asked).toEqual(['sig7']);
        expect(result.outcome).toBe('reached');
        expect(result.entries.map((e) => e.signature)).toEqual(['sig6', 'sig5']);
    });
});

// ─── the whole scanner against scripted endpoints ────────────────────

const SOLANA = MAINNET.chains.find((c) => c.family === 'solana') as SolanaChainEntry;
const TAGGED = '[10] stablehops';

/** An endpoint holding `history` (newest first); after `failAfter` pages it stops answering. */
function endpoint(history: SignatureInfo[], opts: { failAfter?: number } = {}) {
    let pages = 0;
    const fetched: string[] = [];
    return {
        fetched,
        call: async (method: string, params: unknown): Promise<unknown> => {
            if (method === 'getSignaturesForAddress') {
                pages += 1;
                if (opts.failAfter !== undefined && pages > opts.failAfter) {
                    throw new Error('HTTP 503');
                }
                const { limit, before } = (
                    params as [string, { limit: number; before?: string }]
                )[1];
                const start = before ? history.findIndex((e) => e.signature === before) + 1 : 0;
                // A node that does not know the signature it is asked to page from has nothing.
                if (before && start === 0) return [];
                return history.slice(start, start + limit);
            }
            if (method === 'getTransaction') {
                fetched.push((params as [string])[0]);
                return { ...fixture('solana-burn-hook.json'), blockTime: 1_800_000_000 };
            }
            throw new Error(`unexpected ${method}`);
        },
    };
}

const history = (count: number, taggedAt: number[] = []) =>
    Array.from({ length: count }, (_, i) =>
        sig(count - i, 1_800_000_000 - i, taggedAt.includes(count - i) ? TAGGED : null),
    );

type ScanArgs = Parameters<typeof scanSolana>[0];
const scan = (
    endpoints: Record<string, { call: (method: string, params: unknown) => Promise<unknown> }>,
    state: ScanArgs['state'],
    extra: Partial<ScanArgs> = {},
) =>
    scanSolana({
        entry: SOLANA,
        rpcUrls: Object.keys(endpoints),
        state,
        since: new Date(0),
        deadline: Number.MAX_SAFE_INTEGER,
        destOf: (domain) => (domain === 19 ? 'hyperevm' : null),
        callFor: (url) => endpoints[url].call,
        ...extra,
    });

describe('scanning Solana end to end', () => {
    test('reads back to the checkpoint, decodes the tagged burn, and moves the checkpoint', async () => {
        const a = endpoint(history(2_500, [1_500]));
        const result = await scan({ a }, { signature: 'sig700' });
        expect(result.coverage.status).toBe('ok');
        expect(result.state).toEqual({ signature: 'sig2500' });
        expect(result.seen).toBe(1_800);
        expect(a.fetched).toEqual(['sig1500']);
        expect(result.records).toEqual([
            {
                id: 'solana:sig1500:0',
                chain: 'solana',
                tx: 'sig1500',
                time: new Date(1_800_000_000 * 1000).toISOString(),
                from: '2S5iaGNfK6EAUVGymFX3QjxVgAxtJ4UhSntYmHB2zd83',
                amount: '114554200',
                destDomain: 19,
                dest: 'hyperevm',
                nonce: null,
            },
        ]);
    });

    test('the endpoint fails over to one with less history: nothing is marked as read', async () => {
        // 2,500 transactions since the checkpoint, one tagged at position
        // 1,500. The first endpoint answers one page and then fails. The
        // second only holds the newest 1,200, so it can never reach the
        // checkpoint. Reporting "ok" here would lose the tagged burn for good.
        const full = history(2_500, [1_500]);
        const a = endpoint(full, { failAfter: 1 });
        const b = endpoint(full.slice(0, 1_200));
        const result = await scan({ a, b }, { signature: 'sig0' });
        expect(result.coverage.status).toBe('error');
        expect(result.state).toEqual({ signature: 'sig0' });
    });

    test('an endpoint with too little history is passed over for one that has it', async () => {
        const full = history(2_500, [1_500]);
        const shallow = endpoint(full.slice(0, 1_200));
        const deep = endpoint(full);
        const result = await scan({ shallow, deep }, { signature: 'sig700' });
        expect(result.coverage.status).toBe('ok');
        expect(result.state).toEqual({ signature: 'sig2500' });
        expect(result.records.map((r) => r.tx)).toEqual(['sig1500']);
    });

    test('a scan cut short by time keeps its place, and the next run finishes it', async () => {
        // The tagged burn sits in the part the first run does not get to.
        const a = endpoint(history(2_500, [400]));
        let clock = 0;
        const first = await scan(
            { a },
            { signature: 'sig300' },
            { deadline: 1_000, now: () => (clock += 400) },
        );
        expect(first.coverage.status).toBe('behind');
        // Two pages were read (2,000 transactions); the checkpoint has not moved.
        expect(first.state).toEqual({
            signature: 'sig300',
            resume: { before: 'sig501', newest: 'sig2500' },
        });
        expect(first.records).toEqual([]);

        const second = await scan({ a }, first.state);
        expect(second.coverage.status).toBe('ok');
        expect(second.state).toEqual({ signature: 'sig2500' });
        expect(second.records.map((r) => r.tx)).toEqual(['sig400']);
    });

    test('nothing new since the last run', async () => {
        const a = endpoint(history(2_500));
        const result = await scan({ a }, { signature: 'sig2500' });
        expect(result).toMatchObject({
            coverage: { status: 'ok' },
            state: { signature: 'sig2500' },
            seen: 0,
            records: [],
        });
    });

    test('every endpoint down: an error, and the checkpoint stays', async () => {
        const dead = { call: async () => Promise.reject(new Error('HTTP 503')) };
        const result = await scan({ dead }, { signature: 'sig5' });
        expect(result.coverage).toMatchObject({ chain: 'solana', status: 'error' });
        expect(result.state).toEqual({ signature: 'sig5' });
    });
});
