import { TransferError } from '../errors/codes';
import { MAINNET } from './mainnet';
import { TESTNET } from './testnet';
import type { ChainEntry, NetworkEnv, Registry, StellarConfig } from './types';

export * from './types';
export { TESTNET, MAINNET };

// The active environment is fixed to testnet until mainnet routes are
// verified end to end. Everything reads through this seam so flipping the
// environment later is one change.
const ACTIVE_ENV: NetworkEnv = 'testnet';

const REGISTRIES: Record<NetworkEnv, Registry> = { testnet: TESTNET, mainnet: MAINNET };

export function getRegistry(): Registry {
    return REGISTRIES[ACTIVE_ENV];
}

export function listChains(): ChainEntry[] {
    return getRegistry().chains;
}

export function getChain(id: string): ChainEntry {
    const entry = getRegistry().chains.find((c) => c.id === id);
    if (!entry) {
        throw new TransferError('CONFIG_MISSING', { raw: `unknown chain id: ${id}` });
    }
    return entry;
}

export function stellarConfig(): StellarConfig {
    return getRegistry().stellar;
}

export function irisBase(): string {
    return getRegistry().irisBase;
}

/** Resolve a CCTP domain to its chain entry, or the literal 'stellar'. */
export function chainByDomain(domain: number): ChainEntry | 'stellar' | undefined {
    const registry = getRegistry();
    if (domain === registry.stellar.domain) return 'stellar';
    return registry.chains.find((c) => c.domain === domain);
}
