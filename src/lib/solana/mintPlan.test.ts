import { describe, expect, test } from 'vitest';
import { hexToBytes } from 'viem';
import { AccountRole, address, createNoopSigner, getAddressDecoder } from '@solana/kit';
import {
    buildReceiveMessageInstruction,
    planSolanaMint,
    parseCctpMessage,
    type SolanaCctpConfig,
} from './mintPlan';
import { TESTNET } from '../registry/index';
import type { SolanaChainEntry } from '../registry/types';

// These are golden vectors, not invented ones. ARC_TO_SOLANA is the exact
// message Circle attested for Arc testnet burn
// 0xabe6e1d7aa6345088a54b791dde3a1438cccf34c543f754db3c30e5268427ff0, and
// every EXPECTED address below was read back out of the Solana transaction
// that successfully minted it, 24fc69z2seC6ckRuhXfwj8LRMPuVWhQkikj7GwSL2rmr4
// oGTCvMpg5Hen6S9rs4yJxLTM8poqZmhqDaSGr7Tp5PA on devnet. So this pins the
// byte offsets and the seeds against a mint that is known to have worked,
// rather than against our own reading of the spec.
//
// Before the fix the plan hardcoded Stellar as the source, which put
// remote_token_messenger and token_pair on accounts that do not exist and made
// every non Stellar route into Solana impossible to complete.
const ARC_TO_SOLANA =
    '0x000000010000001a00000005b762e463b4252e4bb217a0fd4202b48eec22240b146ee258d4fd889622ab56af' +
    '0000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daa' +
    'a65fc81d0fefa8860cb3b83f089b0224be8a6687b7ae49f594c0b9b4d7e93893' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '000007d0000007d0' +
    '00000001' +
    '0000000000000000000000003600000000000000000000000000000000000000' +
    '2a797e0c3daf0b9f60f8fde74d41bbf81851d0cf7cb55d6e0f7f194e8a867481' +
    '0000000000000000000000000000000000000000000000000000000001312d00' +
    '000000000000000000000000fdea5ebbe7970a00792562e1c5299215cf6a3813' +
    '00000000000000000000000000000000000000000000000000000000000001f4' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000';

const EXPECTED = {
    recipientTokenAccount: '3roaATgp65UYKFSf1y9vdE73x4v9cSZrfYkWCBLXSCnU',
    messageTransmitter: 'W1k5ijkaSTo5iA5zChNpfzcy796fLhkBxfmJuR8W8HU',
    usedNonce: 'E8rLtChECSGVb9LvhKpj4dXLgGJkfgWsHeHWJgFCu38v',
    tokenMessenger: 'AawthJCGRmggpfv9MMWV6Jmo9cue4gL9wUZgRBShg58W',
    remoteTokenMessenger: '2mfHPyiRdSkp2dJxmhMPvhfZCPDKDtzPQ5GUj1YB8n18',
    tokenMinter: 'E1bQJ8eMMn3zmeSewW3HQ8zmJr7KR75JonbwAtWx2bux',
    localToken: '7MwmWTK2R9Na6rnoSAEt5gytFmSZj9WLVdazvxvru9AU',
    tokenPair: 'FekqRSqWBeQGvmhZ2zV5oYDMWPfKu8h8YnXGJFeSw5gh',
    custody: 'CFUgYpbas5UdJkwwSobYgzhFqFuj6C8MfXwBetE3o4SY',
    eventAuthority: '6TCCnJ9R1m1RXFzyoH7GYH2J6NJDtZaUvfipPuLWxHNd',
} as const;

// Stellar testnet USDC (CBIELTK6...) as it appears in the burnToken slot, and
// the two accounts Circle registered for domain 27 on devnet. Both were
// confirmed to exist on chain, so the Stellar route stays pinned too.
const STELLAR_USDC = '5045cd5ec0729a768fd5ad02505852df4f028dce830e5ac52209ba48483b2f01';
const STELLAR_REMOTE_TOKEN_MESSENGER = '7rFyL6KPFT6DtREZbbtQCYHinYtWCUS6WXqtw5EC3bQF';
const STELLAR_TOKEN_PAIR = 'H2EBXV1s5PBd94rf5TWaQemMzTMuN2A4LBfMzg532zEb';

const solana = TESTNET.chains.find((c): c is SolanaChainEntry => c.family === 'solana')!;
const config: SolanaCctpConfig = {
    domain: solana.domain,
    messageTransmitter: solana.messageTransmitter,
    tokenMessengerMinter: solana.tokenMessengerMinter,
    usdcMint: solana.usdcMint,
};

const message = () => new Uint8Array(hexToBytes(ARC_TO_SOLANA as `0x${string}`));

// Overwrite one field in place, so every variant below keeps a real frame and
// only differs where the test says it differs.
function patched(edit: (m: Uint8Array) => void): Uint8Array {
    const m = message();
    edit(m);
    return m;
}
const writeU32 = (m: Uint8Array, at: number, value: number) =>
    new DataView(m.buffer, m.byteOffset, m.byteLength).setUint32(at, value);

describe('parseCctpMessage reads the wire format', () => {
    test('header and burn body of a real attested message', () => {
        const parsed = parseCctpMessage(message());
        expect(parsed.version).toBe(1);
        expect(parsed.sourceDomain).toBe(26); // Arc testnet, not Stellar
        expect(parsed.destinationDomain).toBe(5);
        expect(parsed.amount).toBe(20_000_000n);
        expect(Buffer.from(parsed.nonce).toString('hex')).toBe(
            'b762e463b4252e4bb217a0fd4202b48eec22240b146ee258d4fd889622ab56af',
        );
        // Arc's USDC is the native gas token at a special address.
        expect(Buffer.from(parsed.burnToken).toString('hex')).toBe(
            '0000000000000000000000003600000000000000000000000000000000000000',
        );
        // All zero: anyone may complete this mint.
        expect(parsed.destinationCaller.every((b) => b === 0)).toBe(true);
        expect(parsed.hookData).toHaveLength(0);
    });

    test('refuses a message too short to hold a burn body', () => {
        expect(() => parseCctpMessage(message().slice(0, 200))).toThrow(/at least 376/);
    });
});

describe('planSolanaMint derives the accounts a mint actually needs', () => {
    test('every account matches the transaction that minted this message', async () => {
        const plan = await planSolanaMint(message(), config);
        expect({
            recipientTokenAccount: plan.recipientTokenAccount,
            messageTransmitter: plan.messageTransmitter,
            usedNonce: plan.usedNonce,
            tokenMessenger: plan.tokenMessenger,
            remoteTokenMessenger: plan.remoteTokenMessenger,
            tokenMinter: plan.tokenMinter,
            localToken: plan.localToken,
            tokenPair: plan.tokenPair,
            custody: plan.custody,
            eventAuthority: plan.eventAuthority,
        }).toEqual(EXPECTED);
    });

    test('the Stellar route still derives the accounts Circle registered for domain 27', async () => {
        const stellarSourced = patched((m) => {
            writeU32(m, 4, 27);
            m.set(hexToBytes(`0x${STELLAR_USDC}`), 152);
        });
        const plan = await planSolanaMint(stellarSourced, config);
        expect(plan.remoteTokenMessenger).toBe(STELLAR_REMOTE_TOKEN_MESSENGER);
        expect(plan.tokenPair).toBe(STELLAR_TOKEN_PAIR);
        // The seeds have to move with the source, or one of the two routes
        // points at accounts that were never initialized.
        expect(plan.remoteTokenMessenger).not.toBe(EXPECTED.remoteTokenMessenger);
        expect(plan.tokenPair).not.toBe(EXPECTED.tokenPair);
    });

    test('the destination token account follows the message, never a wallet', async () => {
        const elsewhere = new Uint8Array(32).fill(9);
        const plan = await planSolanaMint(
            patched((m) => m.set(elsewhere, 184)),
            config,
        );
        expect(plan.recipientTokenAccount).toBe(getAddressDecoder().decode(elsewhere));
        expect(plan.recipientTokenAccount).not.toBe(EXPECTED.recipientTokenAccount);
    });

    test('the used_nonce account moves with the nonce', async () => {
        const plan = await planSolanaMint(
            patched((m) => m.set(new Uint8Array(32).fill(1), 12)),
            config,
        );
        expect(plan.usedNonce).not.toBe(EXPECTED.usedNonce);
    });

    test('refuses a message bound for another chain', async () => {
        await expect(
            planSolanaMint(
                patched((m) => writeU32(m, 8, 0)),
                config,
            ),
        ).rejects.toThrow(/bound for domain 0/);
    });
});

// The 20 accounts of the receive_message instruction in transaction 24fc69z2,
// in the order the network accepted them, plus the fee recipient account that
// transaction resolved. Account order is exactly the kind of thing that breaks
// silently, since the Anchor IDL says nothing about the CPI accounts.
const CALLER = '88zoQKEF5FWdaEYZFryVF7ASxW6KnG6FRV5XPiBwaUkg';
const FEE_RECIPIENT_ATA = '2cDia1Ga9XDBGWVyFmaqiE7FKMDEtcy3xoRCW7B7S4es';
const CONFIRMED_ACCOUNTS = [
    CALLER, //                                          payer
    CALLER, //                                          caller
    'DsAdX23SVpTPYhKP2ua1mx8gTPqLyzx7a43cyxYjS2up', //  authority pda
    EXPECTED.messageTransmitter,
    EXPECTED.usedNonce,
    'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe', //  receiver, TokenMessengerMinter
    '11111111111111111111111111111111', //              system program
    '2PcXTomVAbX5Es1NUZUkxwuCm8tvV4NmRk3fmQWFCWoV', //  MessageTransmitter event authority
    'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC', //  MessageTransmitter program
    EXPECTED.tokenMessenger,
    EXPECTED.remoteTokenMessenger,
    EXPECTED.tokenMinter,
    EXPECTED.localToken,
    EXPECTED.tokenPair,
    FEE_RECIPIENT_ATA,
    EXPECTED.recipientTokenAccount,
    EXPECTED.custody,
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', //   SPL token program
    EXPECTED.eventAuthority,
    'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe', //  TokenMessengerMinter program
];

// The six accounts the confirmed transaction marked writable, read back out of
// its message header. The fee payer is writable too, but the caller slot
// repeats that address, and per slot roles collapse on the wire, so compare
// the set rather than each position.
const CONFIRMED_WRITABLE = new Set([
    CALLER,
    EXPECTED.usedNonce,
    EXPECTED.tokenMinter,
    EXPECTED.localToken,
    FEE_RECIPIENT_ATA,
    EXPECTED.recipientTokenAccount,
    EXPECTED.custody,
]);

describe('buildReceiveMessageInstruction', () => {
    test('rebuilds the instruction that minted this message, account for account', async () => {
        const plan = await planSolanaMint(message(), config);
        const instruction = await buildReceiveMessageInstruction({
            plan,
            rawMessage: message(),
            attestation: new Uint8Array(65),
            payer: createNoopSigner(address(CALLER)),
            feeRecipientTokenAccount: address(FEE_RECIPIENT_ATA),
            config,
        });

        const accounts = instruction.accounts ?? [];
        expect(accounts.map((a) => a.address)).toEqual(CONFIRMED_ACCOUNTS);
        expect(instruction.programAddress).toBe(config.messageTransmitter);

        const writable = new Set(
            accounts
                .filter(
                    (a) =>
                        a.role === AccountRole.WRITABLE || a.role === AccountRole.WRITABLE_SIGNER,
                )
                .map((a) => a.address),
        );
        expect(writable).toEqual(CONFIRMED_WRITABLE);
    });
});
