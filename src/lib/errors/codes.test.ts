import { describe, expect, test } from 'vitest';
import { TransferError, MESSAGES } from './codes';

describe('TransferError', () => {
    test('carries a code, a plain message, and the raw cause', () => {
        const e = new TransferError('NO_TRUSTLINE', { raw: 'HostError: trustline entry is missing' });
        expect(e).toBeInstanceOf(Error);
        expect(e.code).toBe('NO_TRUSTLINE');
        expect(e.userMessage.length).toBeGreaterThan(10);
        expect(e.raw).toBe('HostError: trustline entry is missing');
    });

    test('every code has a user message and a next step', () => {
        for (const [code, entry] of Object.entries(MESSAGES)) {
            expect(entry.userMessage.length, code).toBeGreaterThan(10);
            expect(entry.action.length, code).toBeGreaterThan(5);
        }
    });

    test('a message override wins over the catalog', () => {
        const e = new TransferError('UNKNOWN', { userMessage: 'Something specific happened.' });
        expect(e.userMessage).toBe('Something specific happened.');
    });

    test('retryable defaults come from the catalog', () => {
        expect(new TransferError('RPC_UNREACHABLE').retryable).toBe(true);
        expect(new TransferError('ALREADY_MINTED').retryable).toBe(false);
    });
});
