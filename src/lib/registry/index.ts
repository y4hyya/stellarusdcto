import { TransferError } from '../errors/codes';
import { MAINNET } from './mainnet';
import { TESTNET } from './testnet';
import type { ChainEntry, NetworkEnv, Registry, StellarConfig } from './types';

export * from './types';
export { TESTNET, MAINNET };

// The environment is chosen once per page load: everything downstream
// (clients, compat config, fee caches) is built from module state. In
// production the DOMAIN decides: the main site serves only mainnet, the
// testnet site only testnet, and no stored value can flip either. Local
// development keeps a stored toggle (setEnv + reload), defaulting testnet.
const ENV_STORAGE_KEY = 'stellarusdcto.env';

export const SITE_URLS = {
    mainnet: 'https://stellarusdcto.vercel.app',
    testnet: 'https://stellarusdcto-testnet.vercel.app',
} as const;

function isLocalHostname(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}

/** Which environment a hostname serves. Exported for tests. */
export function resolveEnv(hostname: string | undefined, stored: string | null): NetworkEnv {
    if (hostname) {
        const h = hostname.toLowerCase();
        if (!isLocalHostname(h)) {
            return h.startsWith('stellarusdcto-testnet') || h.startsWith('testnet.')
                ? 'testnet'
                : 'mainnet';
        }
    }
    return stored === 'mainnet' || stored === 'testnet' ? stored : 'testnet';
}

function storedEnv(): string | null {
    try {
        if (typeof localStorage !== 'undefined') return localStorage.getItem(ENV_STORAGE_KEY);
    } catch {
        // Private mode or storage denied: default applies.
    }
    return null;
}

const ACTIVE_ENV: NetworkEnv = resolveEnv(
    typeof location !== 'undefined' ? location.hostname : undefined,
    storedEnv(),
);

/** True when the domain fixes the environment (any deployed site). */
export function envPinnedByHost(): boolean {
    return typeof location !== 'undefined' && !isLocalHostname(location.hostname.toLowerCase());
}

const REGISTRIES: Record<NetworkEnv, Registry> = { testnet: TESTNET, mainnet: MAINNET };

export function getEnv(): NetworkEnv {
    return ACTIVE_ENV;
}

/** Persist the dev toggle choice. Only local hosts honor it; reload to apply. */
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
