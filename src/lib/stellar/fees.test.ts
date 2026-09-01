import { describe, expect, test } from 'vitest';
import { clampInclusionFee } from './fees';
import { pollDeadline } from './tx';

describe('clampInclusionFee', () => {
    test('quiet network still bids the floor', () => {
        expect(clampInclusionFee(100n)).toBe(10_000n);
    });

    test('surge pricing bids p90 plus headroom', () => {
        // Observed mainnet surge: p90 9486 stroops. 20% headroom on top.
        expect(clampInclusionFee(9_486n)).toBe(11_383n);
    });

    test('extreme surge is capped at 0.02 XLM', () => {
        expect(clampInclusionFee(5_000_000n)).toBe(200_000n);
    });
});

describe('pollDeadline', () => {
    const now = 1_700_000_000_000;

    test('polls until the timebound passes plus grace', () => {
        const maxTime = String(1_700_000_000 + 180);
        expect(pollDeadline(maxTime, now)).toBe(now + 180_000 + 15_000);
    });

    test('no timebound falls back to 90s', () => {
        expect(pollDeadline(undefined, now)).toBe(now + 90_000);
        expect(pollDeadline('0', now)).toBe(now + 90_000);
    });

    test('a timebound already in the past still gets one grace window', () => {
        const maxTime = String(1_700_000_000 - 600);
        expect(pollDeadline(maxTime, now)).toBe(now + 15_000);
    });
});
