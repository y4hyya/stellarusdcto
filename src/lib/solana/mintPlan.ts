import {
    AccountRole,
    address,
    getAddressDecoder,
    getAddressEncoder,
    getProgramDerivedAddress,
    type Address,
    type Instruction,
    type TransactionSigner,
} from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { getReceiveMessageInstructionAsync } from './generated/message-transmitter';

// Everything the Solana mint needs is read out of the signed message itself,
// never out of app state. The attesters signed these exact bytes, so a value
// taken from them cannot disagree with what the destination program is about
// to verify, and a transfer stays completable from nothing but its burn hash.
// Taking the source domain from app state instead is what broke every non
// Stellar route into Solana: the domain seeds two of the accounts below, and a
// wrong seed points the instruction at accounts that were never initialized.
//
// Offsets are byte positions into the CCTP V2 message.
const HEADER = {
    version: 0,
    sourceDomain: 4,
    destinationDomain: 8,
    nonce: 12,
    sender: 44,
    recipient: 76,
    destinationCaller: 108,
    minFinalityThreshold: 140,
    finalityThresholdExecuted: 144,
    body: 148,
} as const;

// Burn message body, as absolute offsets so nothing has to add twice.
const BODY = {
    version: HEADER.body,
    burnToken: HEADER.body + 4,
    mintRecipient: HEADER.body + 36,
    amount: HEADER.body + 68,
    messageSender: HEADER.body + 100,
    maxFee: HEADER.body + 132,
    feeExecuted: HEADER.body + 164,
    expirationBlock: HEADER.body + 196,
    hookData: HEADER.body + 228,
} as const;

const WORD = 32;

export type CctpMessage = {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    /** 32 bytes, also the used_nonce seed on Solana. */
    nonce: Uint8Array;
    /** 32 bytes. All zero means anyone may complete the mint. */
    destinationCaller: Uint8Array;
    /** 32 bytes, the source chain USDC address, a token_pair seed on Solana. */
    burnToken: Uint8Array;
    /** 32 bytes. On Solana this is a token account, not a wallet. */
    mintRecipient: Uint8Array;
    amount: bigint;
    hookData: Uint8Array;
};

// Read the fields a mint depends on. Deliberately tolerant about everything
// else: this runs on messages produced by other tools too.
export function parseCctpMessage(message: Uint8Array): CctpMessage {
    if (message.length < BODY.hookData) {
        throw new Error(
            `CCTP message is ${message.length} bytes, a burn message needs at least ${BODY.hookData}`,
        );
    }
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    const word = (at: number) => message.slice(at, at + WORD);
    const uint256 = (at: number) => {
        let value = 0n;
        for (const byte of word(at)) value = (value << 8n) | BigInt(byte);
        return value;
    };

    return {
        version: view.getUint32(HEADER.version),
        sourceDomain: view.getUint32(HEADER.sourceDomain),
        destinationDomain: view.getUint32(HEADER.destinationDomain),
        nonce: word(HEADER.nonce),
        destinationCaller: word(HEADER.destinationCaller),
        burnToken: word(BODY.burnToken),
        mintRecipient: word(BODY.mintRecipient),
        amount: uint256(BODY.amount),
        hookData: message.slice(BODY.hookData),
    };
}

// Data only, so this module stays importable from plain node scripts as well
// as the app. Values come from the registry entry for the active environment.
export type SolanaCctpConfig = {
    domain: number;
    messageTransmitter: string;
    tokenMessengerMinter: string;
    usdcMint: string;
};

export type SolanaMintPlan = {
    message: CctpMessage;
    /** The token account named by the burn. Never derived from a wallet. */
    recipientTokenAccount: Address;
    messageTransmitter: Address;
    usedNonce: Address;
    tokenMessenger: Address;
    remoteTokenMessenger: Address;
    tokenMinter: Address;
    localToken: Address;
    tokenPair: Address;
    custody: Address;
    eventAuthority: Address;
};

// Every account receive_message and its CPI into TokenMessengerMinterV2 touch,
// derived from the message and the registry alone. Pure: no RPC, no wallet, so
// the mint the app builds and the mint a recovery script builds cannot drift.
export async function planSolanaMint(
    rawMessage: Uint8Array,
    config: SolanaCctpConfig,
): Promise<SolanaMintPlan> {
    const message = parseCctpMessage(rawMessage);
    if (message.destinationDomain !== config.domain) {
        throw new Error(
            `this message is bound for domain ${message.destinationDomain}, not Solana (${config.domain})`,
        );
    }

    const mt = address(config.messageTransmitter);
    const tmm = address(config.tokenMessengerMinter);
    const mintSeed = new Uint8Array(getAddressEncoder().encode(address(config.usdcMint)));
    // Circle seeds the remote accounts with the domain written as ASCII
    // digits, so domain 26 is the two bytes "26", not a number.
    const remoteDomain = String(message.sourceDomain);
    const pda = (programAddress: Address, seeds: (string | Uint8Array)[]) =>
        getProgramDerivedAddress({ programAddress, seeds }).then(([a]) => a);

    const [
        messageTransmitter,
        usedNonce,
        tokenMessenger,
        remoteTokenMessenger,
        tokenMinter,
        localToken,
        tokenPair,
        custody,
        eventAuthority,
    ] = await Promise.all([
        pda(mt, ['message_transmitter']),
        pda(mt, ['used_nonce', message.nonce]),
        pda(tmm, ['token_messenger']),
        pda(tmm, ['remote_token_messenger', remoteDomain]),
        pda(tmm, ['token_minter']),
        pda(tmm, ['local_token', mintSeed]),
        pda(tmm, ['token_pair', remoteDomain, message.burnToken]),
        pda(tmm, ['custody', mintSeed]),
        pda(tmm, ['__event_authority']),
    ]);

    return {
        message,
        recipientTokenAccount: getAddressDecoder().decode(message.mintRecipient),
        messageTransmitter,
        usedNonce,
        tokenMessenger,
        remoteTokenMessenger,
        tokenMinter,
        localToken,
        tokenPair,
        custody,
        eventAuthority,
    };
}

// receive_message verifies the attestation, then CPIs into
// TokenMessengerMinterV2, which transfers USDC out of custody into the token
// account the burn named. The Anchor IDL does not describe the CPI accounts,
// so they are hand appended here in the order and with the roles Circle's own
// test_client.ts uses. This lives beside the plan so the app and any recovery
// script build one instruction, not two that can drift apart.
export async function buildReceiveMessageInstruction(args: {
    plan: SolanaMintPlan;
    rawMessage: Uint8Array;
    attestation: Uint8Array;
    payer: TransactionSigner;
    feeRecipientTokenAccount: Address;
    config: SolanaCctpConfig;
}): Promise<Instruction> {
    const mt = address(args.config.messageTransmitter);
    const tmm = address(args.config.tokenMessengerMinter);
    const { plan } = args;

    const base = await getReceiveMessageInstructionAsync(
        {
            payer: args.payer,
            caller: args.payer,
            messageTransmitter: plan.messageTransmitter,
            usedNonce: plan.usedNonce,
            receiver: tmm, // authorityPda derives from this
            program: mt, //  emit_cpi self program (MessageTransmitter)
            message: args.rawMessage,
            attestation: args.attestation,
        },
        { programAddress: mt },
    );

    const ro = (a: Address) => ({ address: a, role: AccountRole.READONLY });
    const w = (a: Address) => ({ address: a, role: AccountRole.WRITABLE });
    return {
        ...base,
        accounts: [
            ...(base.accounts ?? []),
            ro(plan.tokenMessenger),
            ro(plan.remoteTokenMessenger),
            w(plan.tokenMinter),
            w(plan.localToken),
            ro(plan.tokenPair),
            w(args.feeRecipientTokenAccount),
            w(plan.recipientTokenAccount),
            w(plan.custody),
            ro(TOKEN_PROGRAM_ADDRESS),
            ro(plan.eventAuthority),
            ro(tmm),
        ],
    };
}
