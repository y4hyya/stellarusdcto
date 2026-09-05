import { describe, expect, test } from 'vitest';
import {
    buildSteps,
    candidateDomains,
    classifyHash,
    needsApprove,
    pickableSides,
    validateRoute,
} from './core';
import { TransferError } from '../errors/codes';
import { getChain, TESTNET } from '../registry';

const SOLANA_SIG =
    '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';

describe('classifyHash', () => {
    test('recognizes the three hash shapes and preserves base58 case', () => {
        expect(classifyHash('0x' + 'ab'.repeat(32))).toEqual({
            kind: 'evm',
            normalized: '0x' + 'ab'.repeat(32),
        });
        expect(classifyHash('AB'.repeat(32))).toEqual({
            kind: 'stellarish',
            normalized: 'ab'.repeat(32),
        });
        expect(classifyHash(SOLANA_SIG)).toEqual({ kind: 'solana', normalized: SOLANA_SIG });
    });

    test('lowercases hex but never base58', () => {
        const evm = classifyHash('0x' + 'AB'.repeat(32));
        expect(evm?.normalized).toBe('0x' + 'ab'.repeat(32));
        const sol = classifyHash(SOLANA_SIG);
        expect(sol?.normalized).toBe(SOLANA_SIG);
    });

    test('rejects garbage', () => {
        for (const bad of ['', 'xyz', '0x1234', 'hello world', '0x' + 'gg'.repeat(32)]) {
            expect(classifyHash(bad), bad).toBeNull();
        }
    });
});

describe('candidateDomains', () => {
    test('narrows the probe list by hash shape', () => {
        expect(candidateDomains('stellarish', TESTNET)).toEqual([27]);
        expect(candidateDomains('solana', TESTNET)).toEqual([5]);
        const evm = candidateDomains('evm', TESTNET);
        expect(evm).toContain(26);
        expect(evm).toContain(6);
        expect(evm).toContain(0);
        expect(evm).not.toContain(27);
        expect(evm).not.toContain(5);
    });
});

describe('needsApprove', () => {
    test('stellar sources approve unless the wallet bundles, solana never, evm only direct', () => {
        expect(needsApprove('stellar', 'direct')).toBe(true);
        expect(needsApprove('stellar', 'forwarded')).toBe(true);
        expect(needsApprove('evm', 'direct')).toBe(true);
        expect(needsApprove('evm', 'sendCalls')).toBe(false);
        expect(needsApprove('solana', 'direct')).toBe(false);
    });
});

describe('buildSteps', () => {
    test('a direct outbound transfer has approve, burn, attest, mint', () => {
        const steps = buildSteps('stellar', getChain('base'), 'direct');
        expect(steps.map((s) => s.key)).toEqual(['approve', 'burn', 'attest', 'mint']);
        expect(steps[1].label).toContain('Stellar');
        expect(steps[3].label).toContain('Base Sepolia');
    });

    test('a sendCalls inbound transfer folds approve into the burn', () => {
        const steps = buildSteps(getChain('base'), 'stellar', 'sendCalls');
        expect(steps.map((s) => s.key)).toEqual(['burn', 'attest', 'mint']);
        expect(steps[0].label.toLowerCase()).toContain('batched');
        expect(steps[2].label).toContain('Stellar');
    });

    test('a solana source never shows an approve step', () => {
        const steps = buildSteps(getChain('solana'), 'stellar', 'direct');
        expect(steps.map((s) => s.key)).toEqual(['burn', 'attest', 'mint']);
    });

    test('a forwarded outbound transfer labels the relayer mint', () => {
        const steps = buildSteps('stellar', getChain('base'), 'forwarded');
        expect(steps.map((s) => s.key)).toEqual(['approve', 'burn', 'attest', 'mint']);
        expect(steps[3].label.toLowerCase()).toContain('relayer');
    });
});

describe('validateRoute', () => {
    test('rejects the same side twice', () => {
        expect(validateRoute('base', 'base')).toBeInstanceOf(TransferError);
        expect(validateRoute('stellar', 'stellar')).toBeInstanceOf(TransferError);
    });

    test('accepts any two different sides, with or without stellar', () => {
        expect(validateRoute('arbitrum', 'base')).toBeNull();
        expect(validateRoute('solana', 'base')).toBeNull();
        expect(validateRoute('base', 'solana')).toBeNull();
        expect(validateRoute('stellar', 'base')).toBeNull();
    });
});

describe('pickableSides', () => {
    test('lists stellar first, then every registry chain', () => {
        const sides = pickableSides(TESTNET);
        expect(sides[0]).toEqual({
            id: 'stellar',
            label: 'Stellar',
            family: 'stellar',
            domain: 27,
        });
        expect(sides).toHaveLength(TESTNET.chains.length + 1);
        expect(sides.some((s) => s.id === 'base')).toBe(true);
    });
});

describe('buildSteps between two non stellar chains', () => {
    test('an evm to evm transfer approves, burns, attests, then mints plainly', () => {
        const steps = buildSteps(getChain('arbitrum'), getChain('base'), 'direct');
        expect(steps.map((s) => s.key)).toEqual(['approve', 'burn', 'attest', 'mint']);
        expect(steps[0].label).toContain('Arbitrum');
        expect(steps[3].label).toContain('Base Sepolia');
        expect(steps[3].label).not.toContain('forwarder');
    });

    test('a solana to evm transfer skips approve', () => {
        const steps = buildSteps(getChain('solana'), getChain('base'), 'direct');
        expect(steps.map((s) => s.key)).toEqual(['burn', 'attest', 'mint']);
    });
});
