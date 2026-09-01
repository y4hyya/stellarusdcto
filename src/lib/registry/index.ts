import { TransferError } from '../errors/codes';
import { MAINNET } from './mainnet';
import { TESTNET } from './testnet';
import type { ChainEntry, NetworkEnv, Registry, StellarConfig } from './types';

export * from './types';
export { TESTNET, MAINNET };

// The environment is chosen once per page load: everything downstream
// (clients, compat config, fee caches) is built from module state, so
// switching REQUIRES a full reload. setEnv persists the choice and the
// header does the reload. Outside a browser (tests, scripts) it is testnet.
const ENV_STORAGE_KEY = 'stellarusdcto.env';

function initialEnv(): NetworkEnv {
    try {
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem(ENV_STORAGE_KEY);
            if (stored === 'mainnet' || stored === 'testnet') return stored;
        }
    } catch {
        // Private mode or storage denied: default applies.
    }
    return 'testnet';
}

const ACTIVE_ENV: NetworkEnv = initialEnv();

const REGISTRIES: Record<NetworkEnv, Registry> = { testnet: TESTNET, mainnet: MAINNET };

export function getEnv(): NetworkEnv {
    return ACTIVE_ENV;
}

/** Persist the choice. The caller must reload the page for it to apply. */
export function setEnv(env: NetworkEnv): void {
    try {
        localStorage.setItem(ENV_STORAGE_KEY, env);
    } catch {
        // Without storage the choice cannot stick; the reload falls back.
    }
}

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
