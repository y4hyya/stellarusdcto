// The parts of the counting script that are about this project rather than
// about any one chain: what the registry says about each chain, the command
// line, and the human readable summary published next to the data.

import type { Registry } from '../../src/lib/registry/types';
import { chainLabel, formatUsdc6 } from '../../src/lib/stats/format';
import type { Stats } from '../../src/lib/stats/types';

/** Counting starts here. Nothing before this date carries the tag. */
export const COUNTING_SINCE = '2026-11-16';

type Family = 'evm' | 'solana' | 'stellar';

export function chainHelpers(registry: Registry): {
    familyOf: (chain: string) => Family;
    explorerUrl: (chain: string, tx: string) => string;
    /** Registry id for a CCTP domain, `stellar` for Stellar's, null if unknown. */
    destOf: (domain: number) => string | null;
    domainOf: (chain: string) => number;
    labels: Record<string, string>;
} {
    const byId = new Map(registry.chains.map((c) => [c.id, c]));
    const labels: Record<string, string> = { stellar: 'Stellar' };
    for (const c of registry.chains) labels[c.id] = c.label;

    return {
        // A chain that has since left the registry can only have been an EVM
        // one: Solana and Stellar are fixed sides.
        familyOf: (chain) => (chain === 'stellar' ? 'stellar' : (byId.get(chain)?.family ?? 'evm')),
        explorerUrl: (chain, tx) => {
            if (chain === 'stellar') return `${registry.stellar.explorer}/tx/${tx}`;
            const entry = byId.get(chain);
            if (!entry) return '';
            if (entry.family === 'solana')
                return `${entry.explorer}/tx/${tx}${entry.explorerSuffix}`;
            return `${entry.explorer}/tx/${tx}`;
        },
        destOf: (domain) => {
            if (domain === registry.stellar.domain) return 'stellar';
            return registry.chains.find((c) => c.domain === domain)?.id ?? null;
        },
        domainOf: (chain) => {
            if (chain === 'stellar') return registry.stellar.domain;
            const entry = byId.get(chain);
            if (!entry) throw new Error(`unknown chain: ${chain}`);
            return entry.domain;
        },
        labels,
    };
}

export function parseArgs(argv: string[]): {
    data: string;
    only: string[] | null;
    budgetMs: number;
} {
    const value = (flag: string) => {
        const at = argv.indexOf(flag);
        return at === -1 ? undefined : argv[at + 1];
    };
    const data = value('--data');
    if (!data)
        throw new Error('usage: collect.ts --data <dir> [--only base,solana] [--budget-ms 240000]');
    const only = value('--only');
    const budget = value('--budget-ms');
    const budgetMs = budget === undefined ? 240_000 : Number(budget);
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
        throw new Error(`--budget-ms must be a positive number of milliseconds, got ${budget}`);
    }
    return { data, only: only ? only.split(',').filter(Boolean) : null, budgetMs };
}

/** The README published with the data, for someone reading the branch directly. */
export function summaryMarkdown(stats: Stats, labels: Record<string, string>): string {
    const name = (id: string) => chainLabel(id, labels);
    const t = stats.totals;
    const lines = [
        '# Usage stats',
        '',
        `Transfers that carry the public \`${stats.tag}\` tag, counted from public chain data.`,
        `Generated ${stats.generatedAt}. Counting starts ${stats.since}; nothing earlier carries the tag.`,
        '',
        '|  |  |',
        '| --- | --- |',
        `| Transfers | ${t.transfers} |`,
        `| Volume (USDC) | ${formatUsdc6(t.volume)} |`,
        `| Unique wallets | ${t.wallets} |`,
        `| Rescues | ${t.rescues} (${formatUsdc6(t.rescuedVolume)} USDC) |`,
        '',
        'A rescue is a transfer finished here that was started somewhere else.',
        'Unique wallets are distinct signing addresses; one person with wallets on two',
        'chain families counts twice.',
        '',
        '## Routes',
        '',
        '| From | To | Transfers | Volume (USDC) |',
        '| --- | --- | --- | --- |',
        ...stats.routes.map(
            (r) =>
                `| ${name(r.source)} | ${name(r.dest)} | ${r.transfers} | ${formatUsdc6(r.volume)} |`,
        ),
        '',
        '## Coverage',
        '',
        'Each chain is read through a public RPC. A chain that is behind or in error is',
        'caught up by a later run; its transfers are missing from the totals until then.',
        '',
        '| Chain | Status | Scanned through | Note |',
        '| --- | --- | --- | --- |',
        ...stats.coverage.map(
            (c) => `| ${name(c.chain)} | ${c.status} | ${c.through ?? 'never'} | ${c.note ?? ''} |`,
        ),
        '',
        '## Files',
        '',
        '- `stats.json`: the totals above, as the stats page reads them.',
        '- `transfers.jsonl`: every counted burn, one per line, with its transaction hash.',
        '- `mints.jsonl`: every tagged mint on Stellar.',
        '- `checkpoints.json`: where each chain was last read up to.',
        '',
        'Everything here is produced by `scripts/stats/collect.ts` on the main branch, which',
        'uses no keys. Running it yourself gives the same numbers.',
        '',
    ];
    return lines.join('\n');
}
