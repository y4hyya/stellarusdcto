import { describe, expect, test } from 'vitest';
import { fetchSendCallsCapability } from './capabilities';
import type { EvmWallet } from './wallet';

// A connected wallet whose only job here is answering wallet_getCapabilities.
function walletReporting(capabilities: unknown): EvmWallet {
    return {
        address: '0xfdea5ebbe7970a00792562e1c5299215cf6a3813',
        chainId: 1301,
        walletClient: { getCapabilities: async () => capabilities },
        provider: {},
    } as unknown as EvmWallet;
}

describe('fetchSendCallsCapability batches only calls that already run atomically', () => {
    test('an account that is already a smart account gets the batch', async () => {
        const wallet = walletReporting({ atomic: { status: 'supported' } });
        expect(await fetchSendCallsCapability(wallet, 'unichain')).toEqual({
            supported: true,
            atomic: true,
        });
    });

    test('an account the wallet would first upgrade to a smart account does not', async () => {
        // MetaMask reports "ready" for an EOA it can upgrade through EIP 7702.
        // Batching there meant an upgrade transaction it could not estimate on
        // Unichain Sepolia: it guessed 21,000,000 gas and the node refused it
        // with "gas limit too high" (the per transaction cap is 16,777,216).
        const wallet = walletReporting({ atomic: { status: 'ready' } });
        expect(await fetchSendCallsCapability(wallet, 'unichain')).toEqual({
            supported: false,
            atomic: false,
        });
    });
});
