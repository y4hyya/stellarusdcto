import {
    address,
    createNoopSigner,
    generateKeyPairSigner,
    getAddressDecoder,
    getProgramDerivedAddress,
    type Instruction,
    type TransactionSigner,
} from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
    getDepositForBurnInstructionAsync,
    getDepositForBurnWithHookInstructionAsync,
    TOKEN_MESSENGER_MINTER_V2_PROGRAM_ADDRESS,
} from './generated/token-messenger-minter';
import { signAndSendSolanaTx } from './signer';
import { tagMemoInstruction } from './tag';
import { tagEnabled } from '../attribution/tag';
import { SOLANA } from '$lib/config';
import type { SolanaWallet } from './wallet';

const TMM = TOKEN_MESSENGER_MINTER_V2_PROGRAM_ADDRESS;

// The generated Async builder auto-resolves senderAuthorityPda, denylistAccount
// and localToken, but requires us to supply these program-config PDAs. Seeds
// are the canonical CCTP V2 ones (Circle solana-cctp-contracts).
async function derivePdas(destinationDomain: number) {
    const [tokenMessenger] = await getProgramDerivedAddress({
        programAddress: TMM,
        seeds: ['token_messenger'],
    });
    const [tokenMinter] = await getProgramDerivedAddress({
        programAddress: TMM,
        seeds: ['token_minter'],
    });
    const [remoteTokenMessenger] = await getProgramDerivedAddress({
        programAddress: TMM,
        seeds: ['remote_token_messenger', String(destinationDomain)],
    });
    const [messageTransmitter] = await getProgramDerivedAddress({
        programAddress: address(SOLANA.programs.messageTransmitterV2),
        seeds: ['message_transmitter'],
    });
    return { tokenMessenger, tokenMinter, remoteTokenMessenger, messageTransmitter };
}

// The burn instruction itself, built from the destination adapter's
// MintTarget so the slot composition rules live in exactly one place
// (src/lib/adapters). Stellar bound burns carry the forwarder payload and use
// the hook instruction; every other destination has no hook data and takes
// the plain deposit_for_burn (mirrors the EVM rule). No RPC is touched here:
// every account is derived, which is what lets the size of the real
// transaction be tested.
//
// The owner arrives as a signer, not an address: the same signer object must
// also be the fee payer, because a transaction cannot carry two different
// signers for one address.
export async function buildBurnInstruction(args: {
    ownerSigner: TransactionSigner;
    amount: bigint;
    destinationDomain: number;
    target: import('$lib/adapters/types').MintTarget;
    maxFee: bigint;
    minFinalityThreshold: number;
}): Promise<Instruction> {
    const mint = address(SOLANA.usdc.mint);
    const decodeAddress = getAddressDecoder();

    const [burnTokenAccount] = await findAssociatedTokenPda({
        owner: args.ownerSigner.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint,
    });

    const pdas = await derivePdas(args.destinationDomain);
    const messageSentEventData = await generateKeyPairSigner();

    const common = {
        owner: args.ownerSigner,
        eventRentPayer: args.ownerSigner,
        burnTokenAccount,
        burnTokenMint: mint,
        messageSentEventData,
        messageTransmitter: pdas.messageTransmitter,
        tokenMessenger: pdas.tokenMessenger,
        remoteTokenMessenger: pdas.remoteTokenMessenger,
        tokenMinter: pdas.tokenMinter,
        messageTransmitterProgram: address(SOLANA.programs.messageTransmitterV2),
        program: TMM,
        amount: args.amount,
        destinationDomain: args.destinationDomain,
        mintRecipient: decodeAddress.decode(args.target.mintRecipient),
        destinationCaller: decodeAddress.decode(args.target.destinationCaller),
        maxFee: args.maxFee,
        minFinalityThreshold: args.minFinalityThreshold,
    };
    const hookData = args.target.hookData;
    return hookData && hookData.length > 0
        ? await getDepositForBurnWithHookInstructionAsync({ ...common, hookData })
        : await getDepositForBurnInstructionAsync(common);
}

// Generalized burn used by the transfer engine.
export async function solanaBurnToTarget(args: {
    wallet: SolanaWallet;
    amount: bigint;
    destinationDomain: number;
    target: import('$lib/adapters/types').MintTarget;
    maxFee: bigint;
    minFinalityThreshold: number;
}): Promise<{ signature: string }> {
    const ownerSigner = createNoopSigner(address(args.wallet.address));
    const instruction = await buildBurnInstruction({
        ownerSigner,
        amount: args.amount,
        destinationDomain: args.destinationDomain,
        target: args.target,
        maxFee: args.maxFee,
        minFinalityThreshold: args.minFinalityThreshold,
    });

    const signature = await signAndSendSolanaTx({
        wallet: args.wallet,
        instructions: [instruction],
        // The public usage tag, dropped by the signer if it would not fit.
        optionalInstructions: tagEnabled() ? [tagMemoInstruction()] : undefined,
        feePayerSigner: ownerSigner,
    });
    return { signature };
}
