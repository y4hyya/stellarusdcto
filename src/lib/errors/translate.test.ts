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

    test('maps a gas bid the network refused, but not an underpriced replacement', () => {
        const refused = new Error(
            'The contract function "receiveMessage" reverted with the following reason:\n' +
                'RPC 0x66eee Custom eth_sendRawTransaction: max fee per gas less than block base fee: ' +
                'address 0xFdEA5EBBe7970a00792562E1c5299215cF6A3813, maxFeePerGas: 209742000, baseFee: 211594000',
        );
        expect(translateError(refused, { family: 'evm', phase: 'mint' }).code).toBe(
            'GAS_BID_TOO_LOW',
        );
        expect(translateError(new Error('transaction underpriced'), { family: 'evm' }).code).toBe(
            'GAS_BID_TOO_LOW',
        );
        expect(
            translateError(new Error('replacement transaction underpriced'), { family: 'evm' })
                .code,
        ).toBe('UNKNOWN');
    });

    test('maps a gas limit the network refused at submission', () => {
        // The wallet could not estimate a batch on Unichain Sepolia, guessed
        // 21,000,000 gas, and the node refused anything above 16,777,216.
        const unichain = new Error(
            'An internal error was received.\n\n' +
                'Request Arguments:\n' +
                '  chain:  Unichain Sepolia (id: 1301)\n' +
                '  from:   0xfdea5ebbe7970a00792562e1c5299215cf6a3813\n\n' +
                'Details: RPC 0x515 Custom eth_sendRawTransaction: gas limit too high\n' +
                'Version: viem@2.55.10',
        );
        expect(translateError(unichain, { family: 'evm', phase: 'burn' }).code).toBe(
            'GAS_LIMIT_REFUSED',
        );
        // How Sepolia, Linea, and a node past its block limit word the same refusal.
        for (const text of [
            'transaction gas limit too high (cap: 16777216, tx: 21000000)',
            'Transaction gas limit cap exceeded',
            'exceeds block gas limit',
        ]) {
            expect(translateError(new Error(text), { family: 'evm' }).code, text).toBe(
                'GAS_LIMIT_REFUSED',
            );
        }
    });

    test('keeps the raw text behind UNKNOWN for anything else', () => {
        const raw = new Error('some inscrutable failure');
        const translated = translateError(raw, {});
        expect(translated.code).toBe('UNKNOWN');
        expect(translated.raw).toBe(raw);
    });
});
