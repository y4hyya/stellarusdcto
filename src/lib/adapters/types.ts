import type { TransferError } from '../errors/codes';

// The 32 byte slots of a CCTP burn plus optional hook data. Composing these
// is the single most dangerous job in the app, so exactly one place per
// family owns it (the adapters), and unit tests pin the exact bytes.
export type MintTarget = {
    /** 32 bytes. For Stellar destinations this is always the CctpForwarder. */
    mintRecipient: Uint8Array;
    /**
     * 32 bytes. Zero for EVM and Solana destinations so anyone can complete
     * the mint later; the CctpForwarder for Stellar destinations because the
     * forwarder is the only permitted deliverer there.
     */
    destinationCaller: Uint8Array;
    /** Recipient routing payload for Stellar destinations, otherwise null. */
    hookData: Uint8Array | null;
};

/** What every chain must answer about itself as the destination of a transfer. */
export interface DestinationSide {
    /** Cheap shape check for recipient input, no network. */
    validateRecipient(recipient: string): boolean;
    /** Compose the burn slots for this destination. Throws RECIPIENT_INVALID. */
    mintTarget(recipient: string): Promise<MintTarget>;
    /** Preflight problems that must be fixed before a burn is allowed. */
    checkDestination(recipient: string, amount6: bigint): Promise<TransferError[]>;
    /**
     * Has this CCTP nonce already been consumed on this chain? null when the
     * chain cannot be asked right now (no viewer account, RPC down); callers
     * treat null as unknown, never as no.
     */
    isNonceUsed(nonceHex: `0x${string}`): Promise<boolean | null>;
}
