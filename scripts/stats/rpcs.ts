// Which public RPC endpoints the counting script reads each EVM chain through.
//
// The registry's default endpoint is what the app itself uses, and for most
// chains it is fine here too. A few are not suited to scanning a day of logs:
// they refuse log queries, rate limit a scan, or only answer 100 blocks at a
// time. For those, public endpoints that were checked to answer wide ranges
// are tried first. Every endpoint here is keyless; anyone can rerun the
// script as is. A wrong answer from one of them can only miscount; it cannot
// touch anyone's funds.
//
// Checked 2026-11-17:
//   base      default refuses log queries and rate limits
//   avalanche default answers about 100 blocks
//   polygon   default answers about 100 blocks
//   monad     default answers about 100 blocks; rpc2 answers 5,000
//   op        default refuses batched lookups and rate limits a scan
//   hyperevm  default rate limits after a handful of requests
//   xdc       default takes many seconds per query; ankr is fast but narrow
// World Chain and X Layer have no wider public endpoint that was found, so
// they are scanned 100 blocks at a time.

const PREFERRED: Record<string, string[]> = {
    base: ['https://base-rpc.publicnode.com'],
    avalanche: ['https://avalanche-c-chain-rpc.publicnode.com'],
    polygon: ['https://polygon-bor-rpc.publicnode.com'],
    monad: ['https://rpc2.monad.xyz', 'https://rpc3.monad.xyz'],
    op: ['https://optimism-rpc.publicnode.com'],
    hyperevm: [
        'https://rpc.purroofgroup.com',
        'https://rpc.hyperlend.finance',
        'https://hyperliquid-json-rpc.stakely.io',
    ],
    xdc: ['https://rpc.ankr.com/xdc'],
};

// Tried only when everything before them fails.
const SPARE: Record<string, string[]> = {
    ethereum: ['https://ethereum-rpc.publicnode.com'],
};

// A too wide query falls through to the next endpoint rather than narrowing,
// so a chain whose fast endpoint is narrow starts at that endpoint's width.
const SPAN: Record<string, bigint> = {
    xdc: 500n,
};

export function scanRpcUrls(chain: string, defaults: readonly string[]): string[] {
    const ordered = [...(PREFERRED[chain] ?? []), ...defaults, ...(SPARE[chain] ?? [])];
    return [...new Set(ordered)];
}

/** The width of the first log query on a chain, when the usual one does not suit it. */
export function scanSpan(chain: string): bigint | undefined {
    return SPAN[chain];
}
