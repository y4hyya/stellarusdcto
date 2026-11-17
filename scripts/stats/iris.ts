// Resolves counted burns to the CCTP nonce Circle assigned them.
//
// A burn does not know its own nonce on chain: Circle's attestation service
// assigns it afterwards. The nonce is what a mint on the destination refers
// to, so it is what tells "we finished our own burn" from "we finished a burn
// started somewhere else". Circle's public Iris API returns it by burn
// transaction; a burn Circle has not attested yet simply stays unresolved
// until a later run.

import type { TransferRecord } from '../../src/lib/stats/types';

const NONCE = /^0x[0-9a-fA-F]{64}$/;
const isRealNonce = (value: unknown): value is string =>
    typeof value === 'string' && NONCE.test(value) && !/^0x0+$/.test(value);

/** The position of a burn within its transaction: the last part of its id. */
function position(record: TransferRecord): string {
    return record.id.slice(record.id.lastIndexOf(':') + 1);
}

function byPosition(a: TransferRecord, b: TransferRecord): number {
    const pa = position(a);
    const pb = position(b);
    if (/^\d+$/.test(pa) && /^\d+$/.test(pb)) return Number(pa) - Number(pb);
    return pa < pb ? -1 : pa > pb ? 1 : 0;
}

export async function resolveNonces(
    records: TransferRecord[],
    deps: {
        irisBase: string;
        domainOf: (chain: string) => number;
        fetchJson: (url: string) => Promise<unknown>;
    },
): Promise<TransferRecord[]> {
    const groups = new Map<string, TransferRecord[]>();
    for (const record of records) {
        if (record.nonce) continue;
        const key = `${record.chain}|${record.tx}`;
        groups.set(key, [...(groups.get(key) ?? []), record]);
    }

    const nonces = new Map<string, string>();
    for (const group of groups.values()) {
        const { chain, tx } = group[0];
        // Hex hashes are case insensitive and Iris wants them lowercase. Solana
        // signatures are base58, where case is part of the value.
        const hash = /^(0x)?[0-9a-fA-F]+$/.test(tx) ? tx.toLowerCase() : tx;
        const url = `${deps.irisBase}/v2/messages/${deps.domainOf(chain)}?transactionHash=${hash}`;
        let found: unknown[];
        try {
            const body = (await deps.fetchJson(url)) as {
                messages?: { eventNonce?: unknown }[];
            } | null;
            found = (body?.messages ?? []).map((m) => m.eventNonce);
        } catch {
            continue;
        }
        // Burns and messages are paired in order. If the counts differ, or a
        // nonce is still a placeholder, nothing is assigned: a wrong pairing
        // would silently misclassify a rescue.
        if (found.length !== group.length || !found.every(isRealNonce)) continue;
        [...group]
            .sort(byPosition)
            .forEach((record, i) => nonces.set(record.id, found[i] as string));
    }

    return records.map((record) =>
        record.nonce ? record : { ...record, nonce: nonces.get(record.id) ?? null },
    );
}
