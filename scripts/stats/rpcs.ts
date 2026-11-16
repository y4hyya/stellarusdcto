// Which public RPC endpoints the counting script reads each EVM chain through.
//
// The registry's default endpoint is what the app itself uses, and for most
// chains it is fine here too. A few are not suited to scanning a day of logs:
// they refuse log queries outright or only answer 100 blocks at a time. For
// those a public endpoint that was checked to answer wide ranges is tried
// first. Every endpoint here is keyless; anyone can rerun the script as is.
//
// Checked 2026-11-16: base (default refuses), avalanche and polygon (default
// answers about 100 blocks), monad (default answers about 100; rpc2 answers
// 5,000). World Chain and X Layer have no wider public endpoint that was
// found, so they are scanned 100 blocks at a time.

const PREFERRED: Record<string, string[]> = {
    base: ['https://base-rpc.publicnode.com'],
    avalanche: ['https://avalanche-c-chain-rpc.publicnode.com'],
    polygon: ['https://polygon-bor-rpc.publicnode.com'],
    monad: ['https://rpc2.monad.xyz', 'https://rpc3.monad.xyz'],
};

// Tried only when everything before them fails.
const SPARE: Record<string, string[]> = {
    ethereum: ['https://ethereum-rpc.publicnode.com'],
    xdc: ['https://rpc.ankr.com/xdc'],
};

export function scanRpcUrls(chain: string, defaults: readonly string[]): string[] {
    const ordered = [...(PREFERRED[chain] ?? []), ...defaults, ...(SPARE[chain] ?? [])];
    return [...new Set(ordered)];
}
