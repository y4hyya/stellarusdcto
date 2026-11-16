// The shapes shared by the counting script (scripts/stats) and the page that
// shows its output (/stats). Amounts are USDC in 6 decimal units, carried as
// decimal strings so nothing is lost to floating point on either side.

export const STATS_SCHEMA = 1;

/** One counted burn: a transfer started in the app. */
export type TransferRecord = {
    /** Unique per burn: `<chain>:<tx>:<index>`. Rescanning a range is a no-op. */
    id: string;
    /** Registry id of the source chain, or `stellar`. */
    chain: string;
    tx: string;
    /** ISO 8601, UTC. */
    time: string;
    /** The address that signed the burn. */
    from: string;
    amount: string;
    destDomain: number;
    /** Registry id of the destination, `stellar`, or null if unknown here. */
    dest: string | null;
    /** The CCTP nonce Circle assigned, once known. */
    nonce: string | null;
};

/** One tagged mint on Stellar: a transfer finished in the app. */
export type MintRecord = {
    id: string;
    chain: 'stellar';
    tx: string;
    time: string;
    sourceDomain: number;
    source: string | null;
    amount: string;
    nonce: string;
};

export type ChainCoverage = {
    chain: string;
    /** ok: scanned to the head. behind: still catching up. error: last run failed. */
    status: 'ok' | 'behind' | 'error';
    /** Time of the last block or ledger scanned, if any. */
    through: string | null;
    note?: string;
};

export type Stats = {
    schema: 1;
    generatedAt: string;
    /** Counting starts here; nothing earlier carries the tag. */
    since: string;
    tag: string;
    totals: {
        transfers: number;
        volume: string;
        wallets: number;
        walletsByFamily: { evm: number; solana: number; stellar: number };
        /** Transfers finished here whose burn was not made here. */
        rescues: number;
        rescuedVolume: string;
    };
    daily: { date: string; transfers: number; volume: string; newWallets: number }[];
    routes: { source: string; dest: string; transfers: number; volume: string }[];
    recent: {
        time: string;
        source: string;
        dest: string;
        amount: string;
        tx: string;
        url: string;
    }[];
    coverage: ChainCoverage[];
};
