import { describe, expect, test } from 'vitest';
import { resolveCta, type CtaInput } from './cta';

const base: CtaInput = {
    busy: false,
    sourceConnected: true,
    connectLabel: 'Connect Freighter',
    wrongNetwork: false,
    amountText: '25',
    amountError: null,
    amount6: 25_000_000n,
    balance6: 100_000_000n,
    recipientState: 'ok',
    recipientProblem: null,
    destLabel: 'Base Sepolia',
};

describe('resolveCta', () => {
    test('a clean state sends, naming the amount', () => {
        const cta = resolveCta(base);
        expect(cta.kind).toBe('send');
        expect(cta.enabled).toBe(true);
        expect(cta.label).toBe('Send 25 USDC');
    });

    test('the ladder resolves in order: busy first, then wallet, then network', () => {
        expect(resolveCta({ ...base, busy: true }).kind).toBe('busy');
        expect(resolveCta({ ...base, busy: true, sourceConnected: false }).kind).toBe('busy');
        const disconnected = resolveCta({ ...base, sourceConnected: false, wrongNetwork: true });
        expect(disconnected.kind).toBe('connect-source');
        expect(disconnected.label).toBe('Connect Freighter');
        expect(disconnected.enabled).toBe(true);
        expect(resolveCta({ ...base, wrongNetwork: true }).kind).toBe('switch-network');
    });

    test('amount problems name themselves and disable the button', () => {
        const empty = resolveCta({ ...base, amountText: '', amount6: null });
        expect(empty.kind).toBe('enter-amount');
        expect(empty.enabled).toBe(false);
        const invalid = resolveCta({
            ...base,
            amountText: '1.2345678',
            amount6: null,
            amountError: 'USDC transfers carry at most 6 decimal places',
        });
        expect(invalid.kind).toBe('fix-amount');
        expect(invalid.label).toContain('6 decimal');
        const broke = resolveCta({ ...base, amount6: 200_000_000n });
        expect(broke.kind).toBe('insufficient');
        expect(broke.label).toBe('Not enough USDC');
        // Unknown balance must not block sending.
        expect(resolveCta({ ...base, balance6: null }).kind).toBe('send');
    });

    test('chains that pay gas in USDC keep a reserve out of the max', () => {
        // Balance 100, gas reserve 0.05: 100 is affordable in USDC terms but
        // would leave nothing for gas, so the button explains instead of
        // letting the burn revert on chain.
        const gasEats = resolveCta({
            ...base,
            amount6: 100_000_000n,
            balance6: 100_000_000n,
            gasReserve6: 50_000n,
        });
        expect(gasEats.kind).toBe('insufficient');
        expect(gasEats.label).toBe('Leave a little USDC for gas');
        expect(
            resolveCta({
                ...base,
                amount6: 99_900_000n,
                balance6: 100_000_000n,
                gasReserve6: 50_000n,
            }).kind,
        ).toBe('send');
    });

    test('recipient states gate the send', () => {
        expect(resolveCta({ ...base, recipientState: 'empty' }).kind).toBe('enter-recipient');
        expect(resolveCta({ ...base, recipientState: 'invalid' }).kind).toBe('fix-recipient');
        const problem = resolveCta({
            ...base,
            recipientState: 'problem',
            recipientProblem: 'Recipient needs a USDC trustline',
        });
        expect(problem.kind).toBe('fix-recipient');
        expect(problem.label).toBe('Recipient needs a USDC trustline');
        const checking = resolveCta({ ...base, recipientState: 'checking' });
        expect(checking.kind).toBe('checking');
        expect(checking.enabled).toBe(false);
    });
});
