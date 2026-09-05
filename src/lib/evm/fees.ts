import type { PublicClient } from 'viem';
import type { EvmChainId } from '$lib/config';
import { getPublicClient } from './client';

// Wallets price a transaction at the spot gas price with little or no
// headroom. On a chain with a mempool an underbid transaction simply waits
// for the base fee to come back down, but Arbitrum style sequencers execute
// on submission and refuse it outright the moment the base fee ticks above
// the bid: a mint on Arbitrum Sepolia bid 0.2097 gwei against a base fee of
// 0.2116 (a 0.9% move within one block) and died with "max fee per gas less
// than block base fee". EIP 1559 charges base fee plus tip whatever the cap,
// so headroom costs nothing; the wallet only shows a larger worst case.
export const BASE_FEE_HEADROOM = 2n;

export type FeeOverrides = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };

type FeeSource = Pick<PublicClient, 'getBlock' | 'estimateMaxPriorityFeePerGas'>;

// Chains without a base fee keep the wallet's own pricing, and so does any
// failure in here: this can never make a transaction fail that would have
// gone through on the wallet's bid.
export async function feeOverridesFrom(client: FeeSource): Promise<FeeOverrides> {
    try {
        const block = await client.getBlock({ blockTag: 'latest' });
        const baseFee = block.baseFeePerGas;
        if (baseFee === null || baseFee === undefined) return {};
        const tip = await client.estimateMaxPriorityFeePerGas().catch(() => 0n);
        return { maxFeePerGas: baseFee * BASE_FEE_HEADROOM + tip, maxPriorityFeePerGas: tip };
    } catch {
        return {};
    }
}

export function feeOverrides(chainId: EvmChainId): Promise<FeeOverrides> {
    return feeOverridesFrom(getPublicClient(chainId));
}
