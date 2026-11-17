import { STATS_SCHEMA, type Stats } from './types';

// ─── reading stats.json ──────────────────────────────────────────────
//
// The page fetches this file from another origin at view time, so it is
// treated as untrusted input: anything that is not exactly the shape the page
// knows how to draw is refused as a whole, and the page shows its
// "unavailable" state instead of a half drawn one.

// An amount is a whole number of 6 decimal units. Thirty digits is far beyond
// all the USDC that exists and still safe to do arithmetic on; anything
// longer is not an amount.
const DIGITS = /^\d{1,30}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// The script writes at most 400 days and 20 recent transfers. The other
// limits only keep a hostile file from asking the page to draw without end.
const MAX = { daily: 400, routes: 2000, recent: 50, coverage: 200, gaps: 200 };

const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isAmount = (v: unknown): v is string => typeof v === 'string' && DIGITS.test(v);
const isText = (v: unknown): v is string => typeof v === 'string';
const allOf = (
    v: unknown,
    limit: number,
    check: (row: Record<string, unknown>) => boolean,
): boolean =>
    Array.isArray(v) && v.length <= limit && v.every((row) => isObject(row) && check(row));

export function parseStats(raw: unknown): Stats | null {
    if (!isObject(raw)) return null;
    if (raw.schema !== STATS_SCHEMA) return null;
    if (!isText(raw.generatedAt) || !isText(raw.since) || !isText(raw.tag)) return null;

    const totals = raw.totals;
    if (!isObject(totals)) return null;
    const byFamily = totals.walletsByFamily;
    if (
        !isCount(totals.transfers) ||
        !isAmount(totals.volume) ||
        !isCount(totals.wallets) ||
        !isObject(byFamily) ||
        !isCount(byFamily.evm) ||
        !isCount(byFamily.solana) ||
        !isCount(byFamily.stellar) ||
        !isCount(totals.rescues) ||
        !isAmount(totals.rescuedVolume)
    ) {
        return null;
    }

    const dailyOk = allOf(
        raw.daily,
        MAX.daily,
        (d) =>
            isText(d.date) &&
            DAY.test(d.date) &&
            isCount(d.transfers) &&
            isAmount(d.volume) &&
            isCount(d.newWallets),
    );
    const routesOk = allOf(
        raw.routes,
        MAX.routes,
        (r) => isText(r.source) && isText(r.dest) && isCount(r.transfers) && isAmount(r.volume),
    );
    const recentOk = allOf(
        raw.recent,
        MAX.recent,
        (r) =>
            isText(r.time) &&
            isText(r.source) &&
            isText(r.dest) &&
            isAmount(r.amount) &&
            isText(r.tx) &&
            // Rendered as a link, so only an https address is acceptable;
            // empty means there is no link to show.
            isText(r.url) &&
            (r.url === '' || r.url.startsWith('https://')),
    );
    const coverageOk = allOf(
        raw.coverage,
        MAX.coverage,
        (c) =>
            isText(c.chain) &&
            (c.status === 'ok' || c.status === 'behind' || c.status === 'error') &&
            (c.through === null || isText(c.through)) &&
            (c.note === undefined || isText(c.note)),
    );
    const gapsOk = allOf(
        raw.gaps,
        MAX.gaps,
        (g) => isText(g.chain) && (g.from === null || isText(g.from)) && isText(g.to),
    );
    if (!dailyOk || !routesOk || !recentOk || !coverageOk || !gapsOk) return null;
    // Transfers with no day to plot them on cannot be drawn.
    if (totals.transfers > 0 && (raw.daily as unknown[]).length === 0) return null;

    return raw as unknown as Stats;
}

// ─── showing amounts ─────────────────────────────────────────────────

function withSeparators(whole: bigint): string {
    return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const UNIT = 1_000_000n; // 6 decimal units per USDC
const COMPACT: [suffix: string, wholeUsdc: bigint][] = [
    ['K', 1_000n],
    ['M', 1_000_000n],
    ['B', 1_000_000_000n],
];

/**
 * A 6 decimal USDC amount for display: two decimals, rounded half up, with
 * thousands separators; whole amounts drop the decimals. `compact` shortens
 * headline numbers to K, M and B.
 */
export function formatUsdc6(amount: string, opts: { compact?: boolean } = {}): string {
    if (!DIGITS.test(amount)) return '0';
    const units = BigInt(amount);

    if (opts.compact) {
        // The largest unit the amount actually reaches, so 999.99 stays as it
        // is. If rounding then tips it to 1,000.00 of that unit, step up one:
        // 999,999.999 reads 1.00M, not 1,000.00K.
        let index = -1;
        for (let i = 0; i < COMPACT.length; i++) {
            if (units >= UNIT * COMPACT[i][1]) index = i;
        }
        while (index >= 0) {
            const [suffix, size] = COMPACT[index];
            const divisor = UNIT * size;
            const hundredths = (units * 100n + divisor / 2n) / divisor;
            if (hundredths >= 100_000n && index < COMPACT.length - 1) {
                index += 1;
                continue;
            }
            const frac = (hundredths % 100n).toString().padStart(2, '0');
            return `${withSeparators(hundredths / 100n)}.${frac}${suffix}`;
        }
    }

    const cents = (units + 5_000n) / 10_000n;
    const whole = cents / 100n;
    const frac = cents % 100n;
    if (frac === 0n) return withSeparators(whole);
    return `${withSeparators(whole)}.${frac.toString().padStart(2, '0')}`;
}

/** A chain's display name; unknown destinations read as their CCTP domain. */
export function chainLabel(id: string, labels: Record<string, string>): string {
    if (labels[id]) return labels[id];
    const domain = /^domain (\d+)$/.exec(id);
    return domain ? `Domain ${domain[1]}` : id;
}
