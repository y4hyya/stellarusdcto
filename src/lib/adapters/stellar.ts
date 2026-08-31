import { StrKey } from '@stellar/stellar-sdk';
import { hexToBytes, type Hex } from 'viem';
import { TransferError } from '../errors/codes';
import { stellarConfig } from '../registry';
import { checkStellarDestination } from '../stellar/horizon';
import { encodeStellarForwarderHookData } from '../stellar/recipient';
import { isNonceUsedOnStellar } from '../stellar/cctp';
import type { DestinationSide, MintTarget } from './types';

// Stellar as the destination of a transfer. This is where the fund safety
// invariant lives: a burn toward Stellar names the CctpForwarder in BOTH
// 32 byte slots and carries the real recipient only in hook data. Circle:
// anything else permanently strands the funds.

export class StellarAdapter implements DestinationSide {
    readonly family = 'stellar' as const;

    validateRecipient(recipient: string): boolean {
        // Plain G accounts only for now. Muxed (M) and contract (C) recipients
        // follow once the muxed forwarding experiment settles how the
        // forwarder pays them out.
        return StrKey.isValidEd25519PublicKey(recipient);
    }

    async mintTarget(recipient: string): Promise<MintTarget> {
        if (!this.validateRecipient(recipient)) {
            throw new TransferError('RECIPIENT_INVALID', { raw: recipient });
        }
        const forwarder = new Uint8Array(
            StrKey.decodeContract(stellarConfig().contracts.cctpForwarder),
        );
        const hookData = new Uint8Array(hexToBytes(encodeStellarForwarderHookData(recipient)));
        return {
            mintRecipient: forwarder,
            destinationCaller: forwarder,
            hookData,
        };
    }

    async checkDestination(recipient: string, amount6: bigint): Promise<TransferError[]> {
        if (!this.validateRecipient(recipient)) {
            return [new TransferError('RECIPIENT_INVALID', { raw: recipient })];
        }
        return checkStellarDestination(recipient, amount6);
    }

    /**
     * Soroban reads simulate against an existing account, so this needs a
     * viewer (any funded account, normally the connected wallet). Without one
     * the answer is unknown, never no.
     */
    async isNonceUsed(nonceHex: `0x${string}`, viewer?: string): Promise<boolean | null> {
        if (!viewer) return null;
        try {
            return await isNonceUsedOnStellar(new Uint8Array(hexToBytes(nonceHex as Hex)), viewer);
        } catch {
            return null;
        }
    }
}
