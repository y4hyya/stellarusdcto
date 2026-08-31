import { TransferError } from '../errors/codes';
import type { ChainEntry } from '../registry';
import { EvmAdapter } from './evm';
import { SolanaAdapter } from './solana';
import { StellarAdapter } from './stellar';

export * from './types';
export { EvmAdapter, SolanaAdapter, StellarAdapter };

const stellarAdapter = new StellarAdapter();
const cache = new Map<string, EvmAdapter | SolanaAdapter>();

export function getStellarAdapter(): StellarAdapter {
    return stellarAdapter;
}

export function getChainAdapter(entry: ChainEntry): EvmAdapter | SolanaAdapter {
    const cached = cache.get(entry.id);
    if (cached) return cached;
    let adapter: EvmAdapter | SolanaAdapter;
    if (entry.family === 'evm') adapter = new EvmAdapter(entry);
    else if (entry.family === 'solana') adapter = new SolanaAdapter(entry);
    else {
        throw new TransferError('CONFIG_MISSING', {
            raw: `no adapter for family: ${(entry as { family?: string }).family}`,
        });
    }
    cache.set(entry.id, adapter);
    return adapter;
}
