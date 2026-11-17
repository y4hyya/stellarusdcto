import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { run } from '../../scripts/stats/collect';
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
