import { describe, expect, test } from 'vitest';
import {
    address,
    createNoopSigner,
    type Blockhash,
    type Instruction,
    type TransactionSigner,
} from '@solana/kit';
import { StellarAdapter } from '../adapters/stellar';
import type { MintTarget } from '../adapters/types';
import { SOLANA_MEMO_PROGRAM, TAG } from '../attribution/tag';
import { buildBurnInstruction } from './cctp';
import { SOLANA_MAX_TX_BYTES, encodeForSigning } from './signer';
import { tagMemoInstruction } from './tag';

const OWNER = address('3roaATgp65UYKFSf1y9vdE73x4v9cSZrfYkWCBLXSCnU');
const STELLAR_RECIPIENT = 'GBRFS5SMB55JJHJIHZQEZYBHDPBEM3WGMDUR7WQ6YBVYTOYJXXHAGIJ7';
const blockhash = {
    blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi' as Blockhash,
    lastValidBlockHeight: 1n,
};

// The largest burn the app sends is the one toward Stellar: it carries the
// forwarder payload (the recipient's 56 character address) as hook data.
async function stellarBoundBurn(owner: TransactionSigner): Promise<Instruction> {
    const target = await new StellarAdapter().mintTarget(STELLAR_RECIPIENT);
    return buildBurnInstruction({
        ownerSigner: owner,
        amount: 1_000_000n,
        destinationDomain: 27,
        target,
        maxFee: 500n,
        minFinalityThreshold: 2000,
    });
}

async function plainBurn(owner: TransactionSigner): Promise<Instruction> {
    const target: MintTarget = {
        mintRecipient: new Uint8Array(32).fill(7),
        destinationCaller: new Uint8Array(32),
        hookData: null,
    };
    return buildBurnInstruction({
        ownerSigner: owner,
        amount: 1_000_000n,
        destinationDomain: 6,
        target,
        maxFee: 500n,
        minFinalityThreshold: 2000,
    });
}

describe('the memo instruction', () => {
    test('targets the immutable memo program with the tag text and no accounts', () => {
        const memo = tagMemoInstruction();
        expect(memo.programAddress).toBe(SOLANA_MEMO_PROGRAM);
        expect(memo.accounts ?? []).toEqual([]);
        expect(new TextDecoder().decode(memo.data as Uint8Array)).toBe(TAG);
    });
});

describe('the memo rides along only when the transaction still fits', () => {
    test('a burn toward Stellar plus the memo fits with room to spare', async () => {
        const owner = createNoopSigner(OWNER);
        const burn = await stellarBoundBurn(owner);
        const plain = await encodeForSigning({
            instructions: [burn],
            feePayerSigner: owner,
            blockhash,
        });
        const tagged = await encodeForSigning({
            instructions: [burn],
            optionalInstructions: [tagMemoInstruction()],
            feePayerSigner: owner,
            blockhash,
        });
        expect(tagged.includedOptional).toBe(true);
        // One program key (32) plus the instruction framing and the text.
        expect(tagged.wire.length - plain.wire.length).toBe(32 + 3 + TAG.length);
        expect(tagged.wire.length).toBeLessThanOrEqual(SOLANA_MAX_TX_BYTES);
        // Wallets may add their own instructions, so keep real headroom.
        expect(SOLANA_MAX_TX_BYTES - tagged.wire.length).toBeGreaterThanOrEqual(150);
    });

    test('a burn without hook data plus the memo fits', async () => {
        const owner = createNoopSigner(OWNER);
        const tagged = await encodeForSigning({
            instructions: [await plainBurn(owner)],
            optionalInstructions: [tagMemoInstruction()],
            feePayerSigner: owner,
            blockhash,
        });
        expect(tagged.includedOptional).toBe(true);
        expect(tagged.wire.length).toBeLessThanOrEqual(SOLANA_MAX_TX_BYTES);
    });

    test('an optional instruction that does not fit is dropped, not sent', async () => {
        const owner = createNoopSigner(OWNER);
        const burn = await plainBurn(owner);
        const tooBig: Instruction = {
            programAddress: address(SOLANA_MEMO_PROGRAM),
            data: new Uint8Array(1300).fill(65),
        };
        const plain = await encodeForSigning({
            instructions: [burn],
            feePayerSigner: owner,
            blockhash,
        });
        const result = await encodeForSigning({
            instructions: [burn],
            optionalInstructions: [tooBig],
            feePayerSigner: owner,
            blockhash,
        });
        expect(result.includedOptional).toBe(false);
        expect(result.wire).toEqual(plain.wire);
    });

    test('without optional instructions nothing is added', async () => {
        const owner = createNoopSigner(OWNER);
        const result = await encodeForSigning({
            instructions: [await plainBurn(owner)],
            feePayerSigner: owner,
            blockhash,
        });
        expect(result.includedOptional).toBe(false);
        expect(result.wire.length).toBeLessThanOrEqual(SOLANA_MAX_TX_BYTES);
    });
});
