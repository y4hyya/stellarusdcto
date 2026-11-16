import {
    appendTransactionMessageInstructions,
    createTransactionMessage,
    getBase64Decoder,
    getTransactionEncoder,
    partiallySignTransactionMessageWithSigners,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    type Base64EncodedWireTransaction,
    type Blockhash,
    type Instruction,
    type TransactionSigner,
} from '@solana/kit';
import { solanaRpc } from './client';
import { SOLANA } from '$lib/config';
import { sleep } from '$lib/utils';
import type { SolanaWallet } from './wallet';

// Poll until the tx confirms; sendTransaction only submits. Without this the
// caller marks the transfer "done" before the mint lands, and a balance refetch
// races the confirmation (stale balance). We have no WS subscription, so poll
// getSignatureStatuses over HTTP.
async function confirmSignature(signature: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
        const { value } = await solanaRpc
            .getSignatureStatuses([
                signature as Parameters<typeof solanaRpc.getSignatureStatuses>[0][number],
            ])
            .send();
        const status = value[0];
        if (status) {
            if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
            if (
                status.confirmationStatus === 'confirmed' ||
                status.confirmationStatus === 'finalized'
            ) {
                return;
            }
        }
        await sleep(1000);
    }
    throw new Error('Timed out confirming Solana transaction.');
}

// Wallet Standard chain id for Phantom's signing feature. Reads go through
// our pinned RPC regardless, but signTransaction wants the chain named, and
// it follows the active environment (solana:devnet or solana:mainnet).
const SOLANA_CHAIN = `solana:${SOLANA.cluster}`;

// Minimal shape of the Wallet Standard solana:signTransaction feature, kept
// local rather than pulling @wallet-standard/features (mirrors evm/wallet.ts).
type SignTransactionOutput = { signedTransaction: Uint8Array };
type SignTransactionFeature = {
    signTransaction: (input: {
        account: SolanaWallet['account'];
        transaction: Uint8Array;
        chain: string;
    }) => Promise<SignTransactionOutput | readonly SignTransactionOutput[]>;
};

/** Solana's hard cap on a serialized transaction, signatures included. */
export const SOLANA_MAX_TX_BYTES = 1232;

/**
 * Build the wire transaction the wallet will be asked to sign. Instructions
 * may embed their own signers (the burn's ephemeral message_sent_event_data
 * keypair signs locally here); the fee payer is a noop signer whose slot the
 * wallet fills.
 *
 * `optionalInstructions` are nice to have (the usage tag memo): they are
 * included only when the result still fits Solana's size limit, and dropped
 * without a trace otherwise, so they can never be the reason a transaction
 * cannot be built.
 */
export async function encodeForSigning(args: {
    instructions: Instruction[];
    optionalInstructions?: Instruction[];
    feePayerSigner: TransactionSigner;
    blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint };
}): Promise<{ wire: Uint8Array; includedOptional: boolean }> {
    const compile = async (instructions: Instruction[]): Promise<Uint8Array> => {
        const message = pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayerSigner(args.feePayerSigner, m),
            (m) => setTransactionMessageLifetimeUsingBlockhash(args.blockhash, m),
            (m) => appendTransactionMessageInstructions(instructions, m),
        );
        const partiallySigned = await partiallySignTransactionMessageWithSigners(message);
        return new Uint8Array(getTransactionEncoder().encode(partiallySigned));
    };

    const optional = args.optionalInstructions ?? [];
    if (optional.length > 0) {
        try {
            const wire = await compile([...args.instructions, ...optional]);
            if (wire.length <= SOLANA_MAX_TX_BYTES) return { wire, includedOptional: true };
        } catch {
            // Too large to even encode: same answer as not fitting.
        }
    }
    return { wire: await compile(args.instructions), includedOptional: false };
}

// Assemble → sign → submit. We serialize the partially-signed tx, hand it to
// Phantom for the fee-payer signature, then submit through our own RPC so the
// network stays pinned no matter Phantom's cluster.
export async function signAndSendSolanaTx(args: {
    wallet: SolanaWallet;
    instructions: Instruction[];
    optionalInstructions?: Instruction[];
    feePayerSigner: TransactionSigner;
}): Promise<string> {
    const { wallet, instructions, optionalInstructions, feePayerSigner } = args;

    const { value: blockhash } = await solanaRpc.getLatestBlockhash().send();

    const { wire: wireUnsigned } = await encodeForSigning({
        instructions,
        optionalInstructions,
        feePayerSigner,
        blockhash,
    });

    // Feature implementations live on the Wallet, not the account.
    const features = wallet.standardWallet.features as unknown as Record<string, unknown>;
    const signFeature = features['solana:signTransaction'] as SignTransactionFeature | undefined;
    if (!signFeature) throw new Error('Wallet does not support solana:signTransaction.');

    const res = await signFeature.signTransaction({
        account: wallet.account,
        transaction: wireUnsigned,
        chain: SOLANA_CHAIN,
    });
    const signed = Array.isArray(res) ? res[0] : (res as SignTransactionOutput);

    const wireBase64 = getBase64Decoder().decode(
        signed.signedTransaction,
    ) as Base64EncodedWireTransaction;
    const signature = await solanaRpc
        .sendTransaction(wireBase64, { encoding: 'base64', preflightCommitment: 'confirmed' })
        .send();

    await confirmSignature(signature);
    return signature;
}
