import { describe, expect, test } from 'vitest';
import { evaluateStellarAccount } from './horizon';

// Horizon /accounts/{id} fixtures, trimmed to the fields the evaluation uses.
const USDC = {
    code: 'USDC',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

const account = (balances: unknown[]) => ({ balances }) as never;

const usdcLine = (overrides: Record<string, unknown> = {}) => ({
    asset_type: 'credit_alphanum4',
    asset_code: USDC.code,
    asset_issuer: USDC.issuer,
    balance: '5.0000000',
    limit: '1000.0000000',
    buying_liabilities: '0.0000000',
    is_authorized: true,
    ...overrides,
});

describe('evaluateStellarAccount', () => {
    test('a healthy account with room passes', () => {
        const problems = evaluateStellarAccount(account([usdcLine()]), 1_000_000n, USDC);
        expect(problems).toEqual([]);
    });

    test('a missing account reports ACCOUNT_NOT_FOUND', () => {
        const problems = evaluateStellarAccount(null, 1_000_000n, USDC);
        expect(problems.map((p) => p.code)).toEqual(['ACCOUNT_NOT_FOUND']);
    });

    test('no USDC trustline reports NO_TRUSTLINE', () => {
        const problems = evaluateStellarAccount(
            account([{ asset_type: 'native', balance: '10.0000000' }]),
            1_000_000n,
            USDC,
        );
        expect(problems.map((p) => p.code)).toEqual(['NO_TRUSTLINE']);
    });

    test('a trustline to a different issuer does not count', () => {
        const problems = evaluateStellarAccount(
            account([
                usdcLine({
                    asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
                }),
            ]),
            1_000_000n,
            USDC,
        );
        expect(problems.map((p) => p.code)).toEqual(['NO_TRUSTLINE']);
    });

    test('a frozen trustline reports TRUSTLINE_FROZEN', () => {
        const problems = evaluateStellarAccount(
            account([usdcLine({ is_authorized: false })]),
            1_000_000n,
            USDC,
        );
        expect(problems.map((p) => p.code)).toEqual(['TRUSTLINE_FROZEN']);
    });

    test('an over limit incoming amount reports TRUSTLINE_FULL', () => {
        // limit 1000, balance 5, buying liabilities 990: room is 5 USDC.
        const problems = evaluateStellarAccount(
            account([usdcLine({ buying_liabilities: '990.0000000' })]),
            6_000_000n,
            USDC,
        );
        expect(problems.map((p) => p.code)).toEqual(['TRUSTLINE_FULL']);
        expect(
            evaluateStellarAccount(
                account([usdcLine({ buying_liabilities: '990.0000000' })]),
                5_000_000n,
                USDC,
            ),
        ).toEqual([]);
    });
});
