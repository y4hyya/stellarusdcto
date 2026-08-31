import type { NetworkEnv } from '../registry/types';

// Every transfer is journaled to localStorage at each step transition, so a
// refresh or crash mid transfer is a non event: unfinished entries surface on
// the next load and can be resumed. Local only, clearable, never sent
// anywhere. Storage can be absent or broken (private mode, disabled site
// data), so every access is guarded and failures degrade to no persistence.

const KEY = 'stellarusdcto.journal.v1';

export type TransferPhase =
    'preflight' | 'approving' | 'burning' | 'attesting' | 'minting' | 'done' | 'error';

export type TransferRecord = {
    /** Burn tx id once known, otherwise a provisional id. */
    id: string;
    env: NetworkEnv;
    sourceId: string;
    destId: string;
    /** Canonical 6 decimal units, stringified for JSON. */
    amount6: string;
    recipient: string;
    speed: 'standard' | 'fast';
    flow: string;
    phase: TransferPhase;
    burnTxId?: string;
    nonce?: string;
    mintTxId?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
};

function defaultStorage(): Storage | undefined {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined;
    }
}

function readAll(storage: Storage | undefined): TransferRecord[] {
    if (!storage) return [];
    try {
        const raw = storage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as TransferRecord[]) : [];
    } catch {
        return [];
    }
}

function writeAll(storage: Storage | undefined, records: TransferRecord[]): void {
    if (!storage) return;
    try {
        storage.setItem(KEY, JSON.stringify(records));
    } catch {
        // Storage full or forbidden: transfers simply are not remembered.
    }
}

export function saveTransfer(record: TransferRecord, storage = defaultStorage()): void {
    const rest = readAll(storage).filter((r) => r.id !== record.id);
    writeAll(storage, [record, ...rest]);
}

export function updateTransfer(
    id: string,
    patch: Partial<TransferRecord>,
    storage = defaultStorage(),
): void {
    const records = readAll(storage);
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return;
    records[index] = { ...records[index], ...patch, updatedAt: Date.now() };
    writeAll(storage, records);
}

export function listTransfers(storage = defaultStorage()): TransferRecord[] {
    return readAll(storage).sort((a, b) => b.createdAt - a.createdAt);
}

export function unfinishedTransfers(storage = defaultStorage()): TransferRecord[] {
    // An error after the burn is not terminal: the burn is on chain and the
    // transfer stays completable, so it must keep surfacing until minted.
    return listTransfers(storage).filter(
        (r) => r.phase !== 'done' && (r.phase !== 'error' || Boolean(r.burnTxId)),
    );
}

export function removeTransfer(id: string, storage = defaultStorage()): void {
    writeAll(
        storage,
        readAll(storage).filter((r) => r.id !== id),
    );
}

export function clearJournal(storage = defaultStorage()): void {
    if (!storage) return;
    try {
        storage.removeItem(KEY);
    } catch {
        // Nothing to clear if storage is unavailable.
    }
}
