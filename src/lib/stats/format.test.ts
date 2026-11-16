import { describe, expect, test } from 'vitest';
import { chainLabel, formatUsdc6, parseStats } from './format';

const valid = {
    schema: 1,
    generatedAt: '2026-11-22T12:00:00.000Z',
    since: '2026-11-16',
    tag: 'stablehops',
    totals: {
        transfers: 2,
        volume: '3500000',
        wallets: 2,
        walletsByFamily: { evm: 1, solana: 0, stellar: 1 },
        rescues: 0,
        rescuedVolume: '0',
    },
    daily: [{ date: '2026-11-20', transfers: 2, volume: '3500000', newWallets: 2 }],
    routes: [{ source: 'base', dest: 'stellar', transfers: 2, volume: '3500000' }],
    recent: [
        {
            time: '2026-11-20T10:00:00Z',
            source: 'base',
            dest: 'stellar',
            amount: '1000000',
            tx: '0x1',
            url: 'https://basescan.org/tx/0x1',
        },
    ],
    coverage: [{ chain: 'base', status: 'ok', through: '2026-11-22T11:00:00Z' }],
};

describe('parseStats only accepts the shape the page can draw', () => {
    test('a well formed file is returned as is', () => {
        expect(parseStats(structuredClone(valid))).toEqual(valid);
    });

    test('an empty but well formed file is fine', () => {
        const empty = { ...valid, daily: [], routes: [], recent: [], coverage: [] };
        expect(parseStats(empty)).toEqual(empty);
    });

    test('anything that is not an object is refused', () => {
        expect(parseStats(null)).toBeNull();
        expect(parseStats('<!doctype html>')).toBeNull();
        expect(parseStats(42)).toBeNull();
        expect(parseStats([])).toBeNull();
    });

    test('a different schema is refused rather than half drawn', () => {
        expect(parseStats({ ...valid, schema: 2 })).toBeNull();
    });

    test('missing or malformed parts are refused', () => {
        expect(parseStats({ ...valid, totals: undefined })).toBeNull();
        expect(parseStats({ ...valid, totals: { ...valid.totals, volume: 3500000 } })).toBeNull();
        expect(parseStats({ ...valid, totals: { ...valid.totals, volume: '1e6' } })).toBeNull();
        expect(parseStats({ ...valid, daily: 'none' })).toBeNull();
        expect(parseStats({ ...valid, daily: [{ date: '2026-11-20' }] })).toBeNull();
        expect(parseStats({ ...valid, routes: [{ source: 'base' }] })).toBeNull();
        expect(parseStats({ ...valid, coverage: [{ chain: 'base', status: 'great' }] })).toBeNull();
    });

    test('a link that is not https is refused, since the page renders it as a link', () => {
        const bad = structuredClone(valid);
        bad.recent[0].url = 'javascript:alert(1)';
        expect(parseStats(bad)).toBeNull();
    });
});

describe('formatUsdc6', () => {
    test('two decimals with thousands separators, rounded half up', () => {
        expect(formatUsdc6('1234567890')).toBe('1,234.57');
        expect(formatUsdc6('1234565000')).toBe('1,234.57');
        expect(formatUsdc6('1234564999')).toBe('1,234.56');
    });

    test('whole amounts drop the decimals, fractional ones always show two', () => {
        expect(formatUsdc6('0')).toBe('0');
        expect(formatUsdc6('1000000')).toBe('1');
        expect(formatUsdc6('1500000')).toBe('1.50');
        expect(formatUsdc6('10000')).toBe('0.01');
        expect(formatUsdc6('999999')).toBe('1');
    });

    test('compact form for headline numbers', () => {
        expect(formatUsdc6('1234567890000', { compact: true })).toBe('1.23M');
        expect(formatUsdc6('12345670000', { compact: true })).toBe('12.35K');
        expect(formatUsdc6('2500000000000000', { compact: true })).toBe('2.50B');
        expect(formatUsdc6('999990000', { compact: true })).toBe('999.99');
        // Rounding must not produce 1,000.00K: it becomes the next unit.
        expect(formatUsdc6('999999999000', { compact: true })).toBe('1.00M');
        expect(formatUsdc6('1000000000', { compact: true })).toBe('1.00K');
        expect(formatUsdc6('0', { compact: true })).toBe('0');
    });

    test('anything that is not a whole number of units reads as zero', () => {
        expect(formatUsdc6('abc')).toBe('0');
        expect(formatUsdc6('-5')).toBe('0');
        expect(formatUsdc6('')).toBe('0');
    });
});

describe('chainLabel', () => {
    const labels = { base: 'Base', stellar: 'Stellar' };
    test('known ids use their label', () => {
        expect(chainLabel('base', labels)).toBe('Base');
    });
    test('an unknown domain reads as a domain, anything else as itself', () => {
        expect(chainLabel('domain 99', labels)).toBe('Domain 99');
        expect(chainLabel('mystery', labels)).toBe('mystery');
    });
});
