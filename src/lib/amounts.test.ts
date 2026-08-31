import { describe, expect, test } from 'vitest';
import { parseUsdc, formatUsdc, toStellarSubunits, fromStellarSubunits } from './amounts';
import { TransferError } from './errors/codes';

const code = (fn: () => unknown): string => {
    try {
        fn();
    } catch (e) {
        if (e instanceof TransferError) return e.code;
        throw e;
    }
    throw new Error('expected a TransferError');
};

describe('parseUsdc', () => {
    test('parses whole and fractional amounts into 6 decimal units', () => {
        expect(parseUsdc('1')).toBe(1_000_000n);
        expect(parseUsdc('0.5')).toBe(500_000n);
        expect(parseUsdc('12.345678')).toBe(12_345_678n);
        expect(parseUsdc(' 3.20 ')).toBe(3_200_000n);
    });

    test('rejects a seventh decimal digit instead of silently dropping it', () => {
        expect(code(() => parseUsdc('0.1234567'))).toBe('AMOUNT_TOO_MANY_DECIMALS');
    });

    test('rejects garbage, empty, exponential, negative, and zero input', () => {
        for (const bad of ['', '  ', '1,5', '1e5', 'abc', '-1', '1.2.3', '.']) {
            expect(
                code(() => parseUsdc(bad)),
                bad,
            ).toBe('AMOUNT_INVALID');
        }
        expect(code(() => parseUsdc('0'))).toBe('AMOUNT_INVALID');
        expect(code(() => parseUsdc('0.000000'))).toBe('AMOUNT_INVALID');
    });
});

describe('formatUsdc', () => {
    test('renders units back to a human amount without trailing zeros', () => {
        expect(formatUsdc(1_000_000n)).toBe('1');
        expect(formatUsdc(12_345_678n)).toBe('12.345678');
        expect(formatUsdc(500_000n)).toBe('0.5');
        expect(formatUsdc(1n)).toBe('0.000001');
    });

    test('round trips with parseUsdc', () => {
        for (const s of ['1', '0.5', '12.345678', '0.000001']) {
            expect(formatUsdc(parseUsdc(s))).toBe(s);
        }
    });
});

describe('Stellar subunit conversion', () => {
    test('scales 6 decimal units up to 7 decimal subunits and back', () => {
        expect(toStellarSubunits(1_000_000n)).toBe(10_000_000n);
        expect(fromStellarSubunits(10_000_000n)).toBe(1_000_000n);
    });

    test('refuses 7 decimal subunits that do not divide evenly', () => {
        expect(code(() => fromStellarSubunits(1_234_567n))).toBe('AMOUNT_TOO_MANY_DECIMALS');
    });
});
