import { describe, expect, test, vi } from 'vitest';
import { BASE_FEE_HEADROOM, feeOverridesFrom } from './fees';

function source(baseFeePerGas: bigint | null, tip: () => Promise<bigint>) {
    return {
        getBlock: vi.fn(async () => ({ baseFeePerGas })),
        estimateMaxPriorityFeePerGas: vi.fn(tip),
    } as unknown as Parameters<typeof feeOverridesFrom>[0];
}

describe('feeOverridesFrom bids above the base fee', () => {
    test('caps at the base fee times the headroom plus the tip', async () => {
        const fees = await feeOverridesFrom(source(100n, async () => 3n));
        expect(fees).toEqual({
            maxFeePerGas: 100n * BASE_FEE_HEADROOM + 3n,
            maxPriorityFeePerGas: 3n,
        });
    });

    test('the arbitrum sepolia rejection would have cleared', async () => {
        // The wallet bid 209742000 wei against a base fee of 211594000 and the
        // sequencer refused the transaction. A bid made from the base fee one
        // block earlier must still clear that move.
        const fees = await feeOverridesFrom(source(208258000n, async () => 0n));
        expect(fees.maxFeePerGas).toBeGreaterThan(211594000n);
    });

    test('a chain without a base fee keeps the wallet pricing', async () => {
        const client = source(null, async () => 1n);
        expect(await feeOverridesFrom(client)).toEqual({});
        expect(client.estimateMaxPriorityFeePerGas).not.toHaveBeenCalled();
    });

    test('a failed tip estimate bids with no tip instead of failing', async () => {
        const fees = await feeOverridesFrom(
            source(100n, async () => {
                throw new Error('eth_maxPriorityFeePerGas unsupported');
            }),
        );
        expect(fees).toEqual({ maxFeePerGas: 100n * BASE_FEE_HEADROOM, maxPriorityFeePerGas: 0n });
    });

    test('an unreachable rpc keeps the wallet pricing', async () => {
        const client = {
            getBlock: vi.fn(async () => {
                throw new TypeError('Failed to fetch');
            }),
            estimateMaxPriorityFeePerGas: vi.fn(async () => 0n),
        } as unknown as Parameters<typeof feeOverridesFrom>[0];
        expect(await feeOverridesFrom(client)).toEqual({});
    });
});
