import {
    address,
    createNoopSigner,
    fetchEncodedAccount,
    getAddressDecoder,
    type Address,
    type TransactionSigner,
} from '@solana/kit';
import {
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { hexToBytes, type Hex } from 'viem';
import { fetchTokenMessenger } from './generated/token-messenger-minter';
import {
    buildReceiveMessageInstruction,
    planSolanaMint,
    type SolanaCctpConfig,
    type SolanaMintPlan,
} from './mintPlan';
import { signAndSendSolanaTx } from './signer';
import { solanaRpc } from './client';
import { SOLANA } from '$lib/config';
import { TransferError } from '$lib/errors/codes';
import type { SolanaWallet } from './wallet';

// An SPL token account is mint(32) owner(32) amount(8) and more, so anything
// shorter cannot be one whatever program owns it.
const TOKEN_ACCOUNT_BYTES = 165;

// Complete a transfer whose destination is Solana by receiving the attested
// CCTP message with the connected wallet. The accounts and the instruction
// come from the message itself (see mintPlan); what is left here is the chain
// state the plan cannot know: who Circle's fee recipient is right now, and
// whether the token account the burn named already exists.
export async function receiveMessageOnSolana(args: {
    wallet: SolanaWallet;
    /**
     * Candidate owner for the destination token account, used only when that
     * account does not exist yet. It never decides where the USDC lands: the
     * burn did that, and the plan reads it back out of the signed message.
     */
    recipientOwner: string;
    message: Hex;
    attestation: Hex;
}): Promise<{ signature: string }> {
    const message = new Uint8Array(hexToBytes(args.message));
    const attestation = new Uint8Array(hexToBytes(args.attestation));

    const config: SolanaCctpConfig = {
        domain: SOLANA.domain,
        messageTransmitter: SOLANA.programs.messageTransmitterV2,
        tokenMessengerMinter: SOLANA.programs.tokenMessengerMinterV2,
        usdcMint: SOLANA.usdc.mint,
    };
    const mint = address(SOLANA.usdc.mint);
    const plan = await planSolanaMint(message, config);

    // The connected wallet pays and is the caller. It is not the recipient
    // unless the burn said so: a transfer with a zero destinationCaller can be
    // completed by anyone, which is what makes recovery from a burn hash work.
    const payer = createNoopSigner(address(args.wallet.address));

    // fee_recipient ATA: read TokenMessenger.feeRecipient from chain, derive ATA.
    const tokenMessenger = await fetchTokenMessenger(solanaRpc, plan.tokenMessenger);
    const [feeRecipientAta] = await findAssociatedTokenPda({
        owner: tokenMessenger.data.feeRecipient,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint,
    });

    await ensureDestinationTokenAccount({
        wallet: args.wallet,
        payer,
        recipientOwner: args.recipientOwner,
        plan,
        mint,
    });

    const receive = await buildReceiveMessageInstruction({
        plan,
        rawMessage: message,
        attestation,
        payer,
        feeRecipientTokenAccount: feeRecipientAta,
        config,
    });

    const signature = await signAndSendSolanaTx({
        wallet: args.wallet,
        instructions: [receive],
        feePayerSigner: payer,
    });
    return { signature };
}

// CCTP mints into a token account that must already exist. The burn named it,
// so the only question here is whether it is there, and if not whether this
// wallet is allowed to create it. Creating it has to be its own transaction:
// bundling it with receiveMessage overflows Solana's 1232 byte limit (Kit
// throws "encoding overruns Uint8Array"), so the common case stays one
// signature by only sending it when the account is missing.
async function ensureDestinationTokenAccount(args: {
    wallet: SolanaWallet;
    payer: TransactionSigner;
    recipientOwner: string;
    plan: SolanaMintPlan;
    mint: Address;
}): Promise<void> {
    const target = args.plan.recipientTokenAccount;
    const existing = await fetchEncodedAccount(solanaRpc, target);

    if (existing.exists) {
        const isTokenAccount =
            existing.programAddress === TOKEN_PROGRAM_ADDRESS &&
            existing.data.length >= TOKEN_ACCOUNT_BYTES;
        const holds = isTokenAccount
            ? getAddressDecoder().decode(existing.data.slice(0, 32))
            : null;
        if (holds !== args.mint) {
            throw new TransferError('MINT_RECIPIENT_UNUSABLE', {
                raw: `${target} is not a USDC token account (owner program ${existing.programAddress})`,
            });
        }
        return;
    }

    // Only an associated token account can be created on someone's behalf, and
    // only if we know the owner it belongs to. Any other missing account has
    // to be created by whoever controls it.
    let owner: Address;
    try {
        owner = address(args.recipientOwner);
    } catch {
        throw new TransferError('DESTINATION_ACCOUNT_MISSING', { raw: target });
    }
    const [ownerAta] = await findAssociatedTokenPda({
        owner,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint: args.mint,
    });
    if (ownerAta !== target) {
        throw new TransferError('DESTINATION_ACCOUNT_MISSING', {
            raw: `${target} does not exist, and it is not the USDC account of ${owner}`,
        });
    }

    const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: args.payer,
        owner,
        mint: args.mint,
    });
    await signAndSendSolanaTx({
        wallet: args.wallet,
        instructions: [createAta],
        feePayerSigner: args.payer,
    });
}
