import { describe, expect, test } from 'vitest';
import { chainHelpers, parseArgs, summaryMarkdown } from '../../scripts/stats/report';
import { MAINNET } from '../../src/lib/registry/index';
import type { Stats } from '../../src/lib/stats/types';

const h = chainHelpers(MAINNET);

describe('what the script knows about each chain, from the registry', () => {
    test('families', () => {
        expect(h.familyOf('base')).toBe('evm');
        expect(h.familyOf('solana')).toBe('solana');
        expect(h.familyOf('stellar')).toBe('stellar');
    });

    test('explorer links follow the same form the app uses', () => {
        expect(h.explorerUrl('base', '0xabc')).toBe('https://basescan.org/tx/0xabc');
        expect(h.explorerUrl('solana', 'sig')).toBe('https://explorer.solana.com/tx/sig');
        expect(h.explorerUrl('stellar', 'hash')).toBe(
            'https://stellar.expert/explorer/public/tx/hash',
        );
    });

    test('a chain that has left the registry has no link rather than a wrong one', () => {
        expect(h.explorerUrl('gone', '0xabc')).toBe('');
        expect(h.familyOf('gone')).toBe('evm');
    });

    test('domains map both ways, with Stellar as its own side', () => {
        expect(h.destOf(27)).toBe('stellar');
        expect(h.destOf(6)).toBe('base');
        expect(h.destOf(5)).toBe('solana');
        expect(h.destOf(999)).toBeNull();
        expect(h.domainOf('stellar')).toBe(27);
        expect(h.domainOf('base')).toBe(6);
        expect(() => h.domainOf('gone')).toThrow();
    });

    test('labels cover every chain plus Stellar', () => {
        expect(h.labels.stellar).toBe('Stellar');
        expect(h.labels.base).toBe('Base');
        expect(Object.keys(h.labels)).toHaveLength(MAINNET.chains.length + 1);
    });
});

describe('command line', () => {
    test('the data directory is required', () => {
        expect(() => parseArgs([])).toThrow(/--data/);
    });

    test('defaults', () => {
        expect(parseArgs(['--data', 'out'])).toEqual({
            data: 'out',
            only: null,
            budgetMs: 240_000,
        });
    });

    test('a chain list and a time budget', () => {
        expect(
            parseArgs(['--only', 'base,solana', '--data', 'out', '--budget-ms', '5000']),
        ).toEqual({
            data: 'out',
            only: ['base', 'solana'],
            budgetMs: 5_000,
        });
    });

    test('a budget that is not a positive number is refused', () => {
        expect(() => parseArgs(['--data', 'out', '--budget-ms', 'soon'])).toThrow(/budget/);
        expect(() => parseArgs(['--data', 'out', '--budget-ms', '0'])).toThrow(/budget/);
    });
});

describe('the summary published next to the data', () => {
    const stats: Stats = {
        schema: 1,
        generatedAt: '2026-11-22T12:00:00.000Z',
        since: '2026-11-16',
        tag: 'stablehops',
        totals: {
            transfers: 3,
            volume: '4000000',
            wallets: 2,
            walletsByFamily: { evm: 1, solana: 0, stellar: 1 },
            rescues: 1,
            rescuedVolume: '7500000',
        },
        daily: [],
        routes: [{ source: 'base', dest: 'stellar', transfers: 3, volume: '4000000' }],
        recent: [],
        coverage: [
            { chain: 'base', status: 'ok', through: '2026-11-22T11:00:00.000Z' },
            { chain: 'xdc', status: 'error', through: null, note: 'timeout' },
            {
                chain: 'sei',
                status: 'error',
                through: null,
                note: 'bad | reply\n[click](https://evil.example) <b>x</b>',
            },
        ],
        gaps: [{ chain: 'stellar', from: '2026-11-16T00:00:00Z', to: '2026-11-20T08:00:00Z' }],
    };
    const md = summaryMarkdown(stats, h.labels);

    test('states the totals', () => {
        expect(md).toContain('| Transfers | 3 |');
        expect(md).toContain('| Volume (USDC) | 4 |');
        expect(md).toContain('| Unique wallets | 2 |');
        expect(md).toContain('| Rescues | 1 (7.50 USDC) |');
    });

    test('says when it was generated and since when it counts', () => {
        expect(md).toContain('2026-11-22T12:00:00.000Z');
        expect(md).toContain('2026-11-16');
    });

    test('lists routes and coverage by chain name, problems included', () => {
        expect(md).toContain('| Base | Stellar | 3 | 4 |');
        expect(md).toContain('| Base | ok | 2026-11-22T11:00:00.000Z |');
        expect(md).toContain('| XDC | error | never | timeout |');
    });

    test('an RPC error is printed as text: it cannot add columns, lines or links', () => {
        const row = md.split('\n').find((line) => line.startsWith('| Sei |'));
        expect(row).toBe(
            '| Sei | error | never | bad / reply (click)(https://evil.example) (b)x(/b) |',
        );
    });

    test('holes in what could be read are listed in plain words', () => {
        expect(md).toContain('## Gaps');
        expect(md).toContain(
            '- Stellar: nothing could be read from 2026-11-16T00:00:00Z to 2026-11-20T08:00:00Z.',
        );
    });

    test('without holes the section says so', () => {
        expect(summaryMarkdown({ ...stats, gaps: [] }, h.labels)).toContain('None recorded.');
    });
});
