import { beforeEach, describe, expect, test } from 'vitest';
import {
    clearJournal,
    listTransfers,
    removeTransfer,
    saveTransfer,
    unfinishedTransfers,
    updateTransfer,
    type TransferRecord,
} from './journal';

function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear: () => map.clear(),
        getItem: (k) => map.get(k) ?? null,
        key: (i) => [...map.keys()][i] ?? null,
        removeItem: (k) => void map.delete(k),
        setItem: (k, v) => void map.set(k, v),
    };
}

const record = (overrides: Partial<TransferRecord> = {}): TransferRecord => ({
    id: 'burn123',
    env: 'testnet',
    sourceId: 'base',
    destId: 'stellar',
    amount6: '1000000',
    recipient: 'GABC',
    speed: 'standard',
    flow: 'direct',
    phase: 'burning',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
});

let storage: Storage;
beforeEach(() => {
    storage = memoryStorage();
});

describe('journal', () => {
    test('saves and lists transfers, newest first', () => {
        saveTransfer(record({ id: 'a', createdAt: 1, updatedAt: 1 }), storage);
        saveTransfer(record({ id: 'b', createdAt: 2, updatedAt: 2 }), storage);
        const all = listTransfers(storage);
        expect(all.map((r) => r.id)).toEqual(['b', 'a']);
    });

    test('updates a transfer in place and bumps updatedAt', () => {
        saveTransfer(record({ id: 'a' }), storage);
        updateTransfer('a', { phase: 'done', mintTxId: '0xmint' }, storage);
        const [saved] = listTransfers(storage);
        expect(saved.phase).toBe('done');
        expect(saved.mintTxId).toBe('0xmint');
        expect(saved.updatedAt).toBeGreaterThanOrEqual(saved.createdAt);
    });

    test('unfinished transfers exclude done, keep in flight ones', () => {
        saveTransfer(record({ id: 'a', phase: 'done' }), storage);
        saveTransfer(record({ id: 'b', phase: 'attesting' }), storage);
        expect(unfinishedTransfers(storage).map((r) => r.id)).toEqual(['b']);
    });

    test('an errored transfer whose burn already happened is still unfinished', () => {
        saveTransfer(record({ id: 'failedPreBurn', phase: 'error' }), storage);
        saveTransfer(record({ id: 'failedPostBurn', phase: 'error', burnTxId: '0xburn' }), storage);
        expect(unfinishedTransfers(storage).map((r) => r.id)).toEqual(['failedPostBurn']);
    });

    test('remove and clear work', () => {
        saveTransfer(record({ id: 'a' }), storage);
        saveTransfer(record({ id: 'b' }), storage);
        removeTransfer('a', storage);
        expect(listTransfers(storage).map((r) => r.id)).toEqual(['b']);
        clearJournal(storage);
        expect(listTransfers(storage)).toEqual([]);
    });

    test('survives a broken or absent storage without throwing', () => {
        const broken = {
            getItem: () => {
                throw new Error('denied');
            },
            setItem: () => {
                throw new Error('denied');
            },
        } as unknown as Storage;
        expect(() => saveTransfer(record(), broken)).not.toThrow();
        expect(listTransfers(broken)).toEqual([]);
        expect(listTransfers(undefined)).toEqual([]);
    });

    test('ignores corrupted json instead of crashing', () => {
        storage.setItem('stellarusdcto.journal.v1', '{not json');
        expect(listTransfers(storage)).toEqual([]);
    });
});
