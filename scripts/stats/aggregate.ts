// Turns the two ledgers into the numbers the stats page shows. Pure: the same
// ledgers always give the same totals, which is what lets anyone recompute
// them from the published files.

import { TAG } from '../../src/lib/attribution/tag';
import {
    STATS_SCHEMA,
    type ChainCoverage,
    type MintRecord,
    type Stats,
    type TransferRecord,
} from '../../src/lib/stats/types';

type Family = 'evm' | 'solana' | 'stellar';

const RECENT = 20;
// The daily series feeds one chart; more than this many days is noise there.
const MAX_DAYS = 400;
const DAY_MS = 86_400_000;

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export function buildStats(args: {
    transfers: TransferRecord[];
    mints: MintRecord[];
    coverage: ChainCoverage[];
    familyOf: (chain: string) => Family;
    explorerUrl: (chain: string, tx: string) => string;
    now: Date;
    since: string;
}): Stats {
    const transfers = [...args.transfers].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const destOf = (t: TransferRecord) => t.dest ?? `domain ${t.destDomain}`;

    // Wallets: EVM addresses are one account on every EVM chain and are case
    // insensitive; Solana and Stellar addresses are neither.
    const walletOf = (t: TransferRecord) => {
        const family = args.familyOf(t.chain);
        return { family, key: `${family}:${family === 'evm' ? t.from.toLowerCase() : t.from}` };
    };

    let volume = 0n;
    const wallets = new Map<string, Family>();
    const perDay = new Map<string, { transfers: number; volume: bigint; newWallets: number }>();
    const perRoute = new Map<
        string,
        { source: string; dest: string; transfers: number; volume: bigint }
    >();

    for (const t of transfers) {
        const amount = BigInt(t.amount);
        volume += amount;

        const date = day(t.time);
        const bucket = perDay.get(date) ?? { transfers: 0, volume: 0n, newWallets: 0 };
        bucket.transfers += 1;
        bucket.volume += amount;
        const wallet = walletOf(t);
        if (!wallets.has(wallet.key)) {
            wallets.set(wallet.key, wallet.family);
            bucket.newWallets += 1;
        }
        perDay.set(date, bucket);

        const dest = destOf(t);
        const routeKey = `${t.chain}>${dest}`;
        const route = perRoute.get(routeKey) ?? {
            source: t.chain,
            dest,
            transfers: 0,
            volume: 0n,
        };
        route.transfers += 1;
        route.volume += amount;
        perRoute.set(routeKey, route);
    }

    const walletsByFamily = { evm: 0, solana: 0, stellar: 0 };
    for (const family of wallets.values()) walletsByFamily[family] += 1;

    // One row per UTC day from the first transfer to today, so the chart has a
    // continuous axis and quiet days show as quiet rather than as missing.
    const daily: Stats['daily'] = [];
    if (transfers.length > 0) {
        const last = Date.parse(`${args.now.toISOString().slice(0, 10)}T00:00:00Z`);
        const first = Math.max(
            Date.parse(`${day(transfers[0].time)}T00:00:00Z`),
            last - (MAX_DAYS - 1) * DAY_MS,
        );
        for (let at = first; at <= last; at += DAY_MS) {
            const date = new Date(at).toISOString().slice(0, 10);
            const bucket = perDay.get(date);
            daily.push({
                date,
                transfers: bucket?.transfers ?? 0,
                volume: (bucket?.volume ?? 0n).toString(),
                newWallets: bucket?.newWallets ?? 0,
            });
        }
    }

    const routes = [...perRoute.values()]
        .sort((a, b) =>
            a.volume === b.volume ? b.transfers - a.transfers : a.volume < b.volume ? 1 : -1,
        )
        .map((r) => ({ ...r, volume: r.volume.toString() }));

    // A rescue is a mint made here for a burn that was not. Burns are matched
    // by the nonce Circle assigned. A burn whose nonce is not known yet claims
    // one mint of the same amount from the same source instead, so its own
    // mint is not miscounted in the meantime.
    const burnNonces = new Set<string>();
    const unresolved = new Map<string, number>();
    for (const t of transfers) {
        if (t.nonce) {
            burnNonces.add(t.nonce.toLowerCase());
        } else {
            const key = `${t.chain}:${t.amount}`;
            unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
        }
    }
    let rescues = 0;
    let rescuedVolume = 0n;
    for (const m of args.mints) {
        if (burnNonces.has(m.nonce.toLowerCase())) continue;
        const key = `${m.source}:${m.amount}`;
        const pending = unresolved.get(key) ?? 0;
        if (pending > 0) {
            unresolved.set(key, pending - 1);
            continue;
        }
        rescues += 1;
        rescuedVolume += BigInt(m.amount);
    }

    const recent = transfers
        .slice(-RECENT)
        .reverse()
        .map((t) => ({
            time: t.time,
            source: t.chain,
            dest: destOf(t),
            amount: t.amount,
            tx: t.tx,
            url: args.explorerUrl(t.chain, t.tx),
        }));

    return {
        schema: STATS_SCHEMA,
        generatedAt: args.now.toISOString(),
        since: args.since,
        tag: TAG,
        totals: {
            transfers: transfers.length,
            volume: volume.toString(),
            wallets: wallets.size,
            walletsByFamily,
            rescues,
            rescuedVolume: rescuedVolume.toString(),
        },
        daily,
        routes,
        recent,
        coverage: args.coverage,
    };
}
