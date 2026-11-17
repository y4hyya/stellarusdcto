import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { run, type Scanners } from '../../scripts/stats/collect';
import { MAINNET } from '../../src/lib/registry/index';
import { parseStats } from '../../src/lib/stats/format';

// `only` names a chain that does not exist, so no chain is scanned and the run
// touches no network: what is left is everything the script does around the
// scans, which is what these tests are about.
const offline = { only: ['none'], budgetMs: 1_000 };
const dir = () => mkdtempSync(join(tmpdir(), 'usage-stats-run-'));

describe('a run of the counting script', () => {
    test('a first run on an empty directory writes every file, with nothing counted', async () => {
        const data = dir();
        const stats = await run({ data, ...offline });

        for (const file of [
            'transfers.jsonl',
            'mints.jsonl',
            'checkpoints.json',
            'stats.json',
            'README.md',
        ]) {
            expect(existsSync(join(data, file)), file).toBe(true);
        }
        expect(stats.totals.transfers).toBe(0);
        expect(stats.since).toBe('2026-11-16');

        // What was written is what the page will accept.
        const written = JSON.parse(readFileSync(join(data, 'stats.json'), 'utf8'));
        expect(parseStats(written)).not.toBeNull();
        expect(written.totals).toEqual(stats.totals);
    });

    test('every chain in the registry, and Stellar, has a coverage row', async () => {
        const stats = await run({ data: dir(), ...offline });
        expect(stats.coverage.map((c) => c.chain)).toEqual([
            ...MAINNET.chains.map((c) => c.id),
            'stellar',
        ]);
        // Nothing was scanned, and the file says so instead of claiming "ok".
        expect(stats.coverage.every((c) => c.status === 'behind' && c.through === null)).toBe(true);
    });

    test('what earlier runs counted is kept and totalled', async () => {
        const data = dir();
        const burn = {
            id: 'base:0xabc:1',
            chain: 'base',
            tx: '0xabc',
            time: '2026-11-20T10:00:00Z',
            from: '0x00000000000000000000000000000000000000aa',
            amount: '2500000',
            destDomain: 27,
            dest: 'stellar',
            nonce: '0x' + 'a'.repeat(64),
        };
        writeFileSync(join(data, 'transfers.jsonl'), JSON.stringify(burn) + '\n');
        writeFileSync(
            join(data, 'checkpoints.json'),
            JSON.stringify({
                evm: { base: '123' },
                solana: null,
                stellar: null,
                coverage: {
                    base: { chain: 'base', status: 'ok', through: '2026-11-20T11:00:00Z' },
                },
            }),
        );

        const stats = await run({ data, ...offline });

        expect(stats.totals.transfers).toBe(1);
        expect(stats.totals.volume).toBe('2500000');
        expect(stats.recent[0].url).toBe('https://basescan.org/tx/0xabc');
        // The chain that was not part of this run keeps its last known state.
        expect(stats.coverage.find((c) => c.chain === 'base')).toEqual({
            chain: 'base',
            status: 'ok',
            through: '2026-11-20T11:00:00Z',
        });
        expect(readFileSync(join(data, 'transfers.jsonl'), 'utf8')).toBe(
            JSON.stringify(burn) + '\n',
        );
        expect(JSON.parse(readFileSync(join(data, 'checkpoints.json'), 'utf8')).evm.base).toBe(
            '123',
        );
        expect(readFileSync(join(data, 'README.md'), 'utf8')).toContain('| Transfers | 1 |');
    });

    test('running twice changes nothing but the generation time', async () => {
        const data = dir();
        const first = await run({ data, ...offline });
        const second = await run({ data, ...offline });
        expect({ ...second, generatedAt: '' }).toEqual({ ...first, generatedAt: '' });
    });
});

// ─── with the scanners replaced ──────────────────────────────────────
//
// What a chain's scan returns is scripted here, so these tests are about
// what the run does with it: what it saves, what it leaves alone, and what
// it reports.

const HASH = (n: number) => `0x${String(n).padStart(64, '0')}`;
const burnOn = (chain: string, n: number) => ({
    id: `${chain}:${HASH(n)}:0`,
    chain,
    tx: HASH(n),
    time: '2026-11-17T10:00:00.000Z',
    from: '0x00000000000000000000000000000000000000aa',
    amount: '1000000',
    destDomain: 27,
    dest: 'stellar',
    nonce: null,
});

const quiet: Scanners = {
    scanEvmChain: async ({ entry, fromBlock }) => ({
        records: [],
        through: fromBlock ?? 10n,
        seen: 0,
        coverage: { chain: entry.id, status: 'ok', through: '2026-11-17T12:00:00.000Z' },
    }),
    scanSolana: async ({ entry, state }) => ({
        records: [],
        state,
        seen: 0,
        coverage: { chain: entry.id, status: 'ok', through: '2026-11-17T12:00:00.000Z' },
    }),
    scanStellar: async ({ fromLedger }) => ({
        transfers: [],
        mints: [],
        through: fromLedger ?? 5,
        seen: 0,
        gap: null,
        coverage: { chain: 'stellar', status: 'ok', through: '2026-11-17T12:00:00.000Z' },
    }),
    // No lookups at Circle in tests: burns keep whatever nonce they have.
    resolveNonces: async (records) => records,
};
const live = { only: null, budgetMs: 1_000 };
const readJson = (data: string, name: string) => JSON.parse(readFileSync(join(data, name), 'utf8'));

describe('a run where chains succeed, fail and throw', () => {
    test('one chain in error does not cost the others their results', async () => {
        const data = dir();
        writeFileSync(
            join(data, 'checkpoints.json'),
            JSON.stringify({ evm: { arbitrum: '50' }, solana: null, stellar: null, coverage: {} }),
        );
        const stats = await run(
            { data, ...live },
            {
                ...quiet,
                scanEvmChain: async (args) => {
                    if (args.entry.id === 'base') {
                        return {
                            records: [burnOn('base', 1)],
                            through: 100n,
                            seen: 9,
                            coverage: {
                                chain: 'base',
                                status: 'ok',
                                through: '2026-11-17T12:00:00.000Z',
                            },
                        };
                    }
                    if (args.entry.id === 'arbitrum') {
                        return {
                            records: [],
                            through: args.fromBlock,
                            seen: 0,
                            coverage: {
                                chain: 'arbitrum',
                                status: 'error',
                                through: null,
                                note: 'HTTP 503',
                            },
                        };
                    }
                    return quiet.scanEvmChain(args);
                },
            },
        );

        expect(stats.totals.transfers).toBe(1);
        const checkpoints = readJson(data, 'checkpoints.json');
        expect(checkpoints.evm.base).toBe('100');
        // The failing chain stays exactly where it was.
        expect(checkpoints.evm.arbitrum).toBe('50');
        expect(stats.coverage.find((c) => c.chain === 'arbitrum')).toMatchObject({
            status: 'error',
        });
        expect(stats.coverage.find((c) => c.chain === 'base')).toMatchObject({ status: 'ok' });
        expect(readFileSync(join(data, 'transfers.jsonl'), 'utf8')).toContain(HASH(1));
    });

    test('a scanner that throws is recorded as an error for that chain only', async () => {
        const data = dir();
        const stats = await run(
            { data, ...live },
            {
                ...quiet,
                scanEvmChain: async (args) => {
                    if (args.entry.id === 'op') throw new Error('something unexpected');
                    if (args.entry.id === 'base') {
                        return {
                            ...(await quiet.scanEvmChain(args)),
                            records: [burnOn('base', 2)],
                        };
                    }
                    return quiet.scanEvmChain(args);
                },
                scanStellar: async () => {
                    throw new Error('stellar scan broke');
                },
            },
        );
        expect(stats.totals.transfers).toBe(1);
        expect(stats.coverage.find((c) => c.chain === 'op')).toEqual({
            chain: 'op',
            status: 'error',
            through: null,
            note: 'something unexpected',
        });
        expect(stats.coverage.find((c) => c.chain === 'stellar')).toMatchObject({
            status: 'error',
        });
        expect(stats.coverage.filter((c) => c.status === 'ok')).toHaveLength(
            stats.coverage.length - 2,
        );
    });

    test('the same burn reported by two runs is counted once', async () => {
        const data = dir();
        const scanners: Scanners = {
            ...quiet,
            scanEvmChain: async (args) =>
                args.entry.id === 'base'
                    ? { ...(await quiet.scanEvmChain(args)), records: [burnOn('base', 3)] }
                    : quiet.scanEvmChain(args),
        };
        await run({ data, ...live }, scanners);
        const second = await run({ data, ...live }, scanners);
        expect(second.totals.transfers).toBe(1);
    });
});

describe('holes and unfinished scans survive from run to run', () => {
    const hole = { to: '2026-11-19T08:00:00.000Z' };

    test('a hole reported by the Stellar scan is published and kept on record', async () => {
        const data = dir();
        const first = await run(
            { data, ...live },
            {
                ...quiet,
                scanStellar: async (args) => ({ ...(await quiet.scanStellar(args)), gap: hole }),
            },
        );
        // Nothing was read on Stellar before, so the hole starts at the counting date.
        expect(first.gaps).toEqual([
            { chain: 'stellar', from: '2026-11-16T00:00:00.000Z', to: hole.to },
        ]);

        // A later, healthy run still lists it: the data is gone for good.
        const second = await run({ data, ...live }, quiet);
        expect(second.gaps).toEqual(first.gaps);
        expect(readFileSync(join(data, 'README.md'), 'utf8')).toContain(
            'nothing could be read from',
        );
    });

    test('a hole after earlier reading starts where the reading stopped, and is not listed twice', async () => {
        const data = dir();
        await run({ data, ...live }, quiet);
        const withHole: Scanners = {
            ...quiet,
            scanStellar: async (args) => ({ ...(await quiet.scanStellar(args)), gap: hole }),
        };
        const first = await run({ data, ...live }, withHole);
        expect(first.gaps).toEqual([
            { chain: 'stellar', from: '2026-11-17T12:00:00.000Z', to: hole.to },
        ]);
        const again = await run({ data, ...live }, withHole);
        expect(again.gaps).toHaveLength(1);
    });

    test('where an unfinished Solana scan stopped is handed back to the next run', async () => {
        const data = dir();
        const unfinished = { signature: 'sigA', resume: { before: 'sigB', newest: 'sigC' } };
        await run(
            { data, ...live },
            {
                ...quiet,
                scanSolana: async ({ entry }) => ({
                    records: [],
                    state: unfinished,
                    seen: 0,
                    coverage: { chain: entry.id, status: 'behind', through: null },
                }),
            },
        );
        expect(readJson(data, 'checkpoints.json').solana).toEqual(unfinished);

        let received: unknown;
        await run(
            { data, ...live },
            {
                ...quiet,
                scanSolana: async (args) => {
                    received = args.state;
                    return quiet.scanSolana(args);
                },
            },
        );
        expect(received).toEqual(unfinished);
    });

    test('a checkpoint file from before these fields existed still loads', async () => {
        const data = dir();
        writeFileSync(
            join(data, 'checkpoints.json'),
            JSON.stringify({ evm: {}, solana: 'sigOld', stellar: 7, coverage: {} }),
        );
        let solanaState: unknown;
        let stellarFrom: unknown;
        const stats = await run(
            { data, ...live },
            {
                ...quiet,
                scanSolana: async (args) => {
                    solanaState = args.state;
                    return quiet.scanSolana(args);
                },
                scanStellar: async (args) => {
                    stellarFrom = args.fromLedger;
                    return quiet.scanStellar(args);
                },
            },
        );
        expect(solanaState).toEqual({ signature: 'sigOld' });
        expect(stellarFrom).toBe(7);
        expect(stats.gaps).toEqual([]);
    });
});
