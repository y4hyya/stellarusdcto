import { describe, expect, test } from 'vitest';
import { TransferError } from './codes';
import { translateError } from './translate';

describe('translateError', () => {
    test('passes an existing TransferError through untouched', () => {
        const original = new TransferError('NO_TRUSTLINE');
        expect(translateError(original, {})).toBe(original);
    });

    test('recognizes wallet rejections from viem, Freighter, and plain messages', () => {
        const viemish = Object.assign(new Error('User rejected the request.'), {
            name: 'UserRejectedRequestError',
        });
        expect(translateError(viemish, { family: 'evm' }).code).toBe('USER_REJECTED');
        expect(translateError(new Error('User declined access'), { family: 'stellar' }).code).toBe(
            'USER_REJECTED',
        );
        expect(
            translateError(new Error('Transaction rejected by user'), { family: 'solana' }).code,
        ).toBe('USER_REJECTED');
    });

    test('maps the Soroban allowance failure on a burn to the approval message', () => {
        const raw = new Error('Soroban simulation failed: HostError: Error(Contract, #9)');
        expect(translateError(raw, { family: 'stellar', phase: 'burning' }).code).toBe(
            'ALLOWANCE_EXPIRED',
        );
    });

    test('maps a missing Stellar account', () => {
        expect(
            translateError(new Error('Account not found: GDOES...NOTEXIST'), { family: 'stellar' })
                .code,
        ).toBe('ACCOUNT_NOT_FOUND');
    });

    test('recognizes an already used nonce on all three families', () => {
        expect(
            translateError(new Error('execution reverted: Nonce already used'), { family: 'evm' })
                .code,
        ).toBe('ALREADY_MINTED');
        expect(
            translateError(new Error('Soroban simulation failed: Error(Contract, #6908)'), {
                family: 'stellar',
            }).code,
        ).toBe('ALREADY_MINTED');
        expect(
            translateError(
                new Error('Transaction failed: {"InstructionError":[3,{"Custom":6023}]}'),
                {
                    family: 'solana',
                },
            ).code,
        ).toBe('ALREADY_MINTED');
    });

    test('maps rate limiting, unreachable endpoints, and the max fee floor', () => {
        expect(translateError(new Error('Iris 429: too many requests'), {}).code).toBe(
            'IRIS_RATE_LIMITED',
        );
        expect(translateError(new TypeError('Failed to fetch'), {}).code).toBe('RPC_UNREACHABLE');
        expect(
            translateError(new Error('Soroban simulation failed: Error(Contract, #7105)'), {
                family: 'stellar',
            }).code,
        ).toBe('MAX_FEE_TOO_LOW');
    });

    test('keeps the raw text behind UNKNOWN for anything else', () => {
        const raw = new Error('some inscrutable failure');
        const translated = translateError(raw, {});
        expect(translated.code).toBe('UNKNOWN');
        expect(translated.raw).toBe(raw);
    });
});
