import { address } from '@solana/kit';
import { hexToBytes, type Hex } from 'viem';
import { TransferError } from '../errors/codes';
import type { SolanaChainEntry } from '../registry';
import { solanaAtaToBytes32 } from '../stellar/recipient';
import { isNonceUsedOnSolana } from '../solana/nonce';
import type { DestinationSide, MintTarget } from './types';

const ZERO_32 = () => new Uint8Array(32);

// Solana as the destination of a transfer. The classic mistake is naming the
// wallet: CCTP mints to a TOKEN ACCOUNT, so mintRecipient must be the
// recipient's USDC associated token account, derived here from the owner.
// destinationCaller stays zero so anyone can complete the mint later.

export class SolanaAdapter implements DestinationSide {
    readonly family = 'solana' as const;

    constructor(readonly entry: SolanaChainEntry) {}

    validateRecipient(recipient: string): boolean {
        try {
            address(recipient);
            return true;
        } catch {
            return false;
        }
    }

    async mintTarget(recipient: string): Promise<MintTarget> {
        if (!this.validateRecipient(recipient)) {
            throw new TransferError('RECIPIENT_INVALID', { raw: recipient });
        }
        return {
            mintRecipient: await solanaAtaToBytes32(recipient),
            destinationCaller: ZERO_32(),
            hookData: null,
        };
    }

    async checkDestination(recipient: string): Promise<TransferError[]> {
        if (!this.validateRecipient(recipient)) {
            return [new TransferError('RECIPIENT_INVALID', { raw: recipient })];
        }
        // The token account itself is created idempotently at mint time.
        return [];
    }

    async isNonceUsed(nonceHex: `0x${string}`): Promise<boolean | null> {
        try {
            return await isNonceUsedOnSolana(new Uint8Array(hexToBytes(nonceHex as Hex)));
        } catch {
            return null;
        }
    }
}
