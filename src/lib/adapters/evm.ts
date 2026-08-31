import { isAddress } from 'viem';
import { TransferError } from '../errors/codes';
import type { EvmChainEntry } from '../registry';
import { isNonceUsedOnEvm } from '../evm/cctp';
import { leftPad32FromHex } from '../stellar/cctp';
import type { DestinationSide, MintTarget } from './types';

const ZERO_32 = () => new Uint8Array(32);

// An EVM chain as the destination of a transfer. The recipient address is
// left padded into mintRecipient; destinationCaller stays zero so the mint
// is permissionless and any wallet can complete the transfer later.

export class EvmAdapter implements DestinationSide {
    readonly family = 'evm' as const;

    constructor(readonly entry: EvmChainEntry) {}

    validateRecipient(recipient: string): boolean {
        return isAddress(recipient);
    }

    async mintTarget(recipient: string): Promise<MintTarget> {
        if (!this.validateRecipient(recipient)) {
            throw new TransferError('RECIPIENT_INVALID', { raw: recipient });
        }
        return {
            mintRecipient: leftPad32FromHex(recipient as `0x${string}`),
            destinationCaller: ZERO_32(),
            hookData: null,
        };
    }

    async checkDestination(recipient: string): Promise<TransferError[]> {
        if (!this.validateRecipient(recipient)) {
            return [new TransferError('RECIPIENT_INVALID', { raw: recipient })];
        }
        // Destination gas warnings land with the preflight milestone.
        return [];
    }

    async isNonceUsed(nonceHex: `0x${string}`): Promise<boolean | null> {
        try {
            return await isNonceUsedOnEvm(this.entry, nonceHex);
        } catch {
            return null;
        }
    }
}
