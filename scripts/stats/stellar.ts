// Finds tagged burns and mints on Stellar using a public RPC.
//
// Contract transactions cannot carry a memo, so the tag on Stellar is the
// transaction's lower time bound (see src/lib/attribution/tag.ts). The scan
// reads the events of Circle's two CCTP contracts, then looks at the envelope
// of each transaction that produced one.
//
// The RPC only keeps about seven days of events. A gap longer than that is
// reported in the coverage note; it cannot be read back from here.

import { Networks, TransactionBuilder, scValToNative, xdr } from '@stellar/stellar-sdk';
import { minTimeIsTag } from '../../src/lib/attribution/tag';
import type { ChainCoverage, MintRecord, TransferRecord } from '../../src/lib/stats/types';
import { describeError, jsonRpc, mapLimit } from './rpc';

/** An event as `getEvents` returns it: topics and value are base64 XDR. */
export type StellarEvent = {
    id: string;
    ledger: number;
    ledgerClosedAt: string;
    contractId: string;
    txHash: string;
    inSuccessfulContractCall?: boolean;
    topic: string[];
    value: string;
};

const native = (base64: string): unknown => scValToNative(xdr.ScVal.fromXDR(base64, 'base64'));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

export function eventName(event: Pick<StellarEvent, 'topic'>): string | null {
    try {
        const name = native(event.topic[0]);
        return typeof name === 'string' ? name : null;
    } catch {
        return null;
    }
}

/**
 * A `deposit_for_burn` event from the TokenMessengerMinter. The amount is the
 * CCTP wire amount (6 decimals), not Stellar's 7 decimal token amount.
 */
export function parseBurnEvent(
    event: Pick<StellarEvent, 'topic' | 'value'>,
): { depositor: string; amount: bigint; destDomain: number } | null {
    if (eventName(event) !== 'deposit_for_burn') return null;
    try {
        const depositor = native(event.topic[2]);
        const value = native(event.value) as Record<string, unknown>;
        const amount = value.amount;
        const destDomain = value.destination_domain;
        if (
            typeof depositor !== 'string' ||
            typeof amount !== 'bigint' ||
            typeof destDomain !== 'number'
        ) {
            return null;
        }
        return { depositor, amount, destDomain };
    } catch {
        return null;
    }
}

/**
 * A `message_received` event from the MessageTransmitter: one CCTP message
 * minted on Stellar. The nonce is a topic; the burned amount is read out of
 * the burn message it carries (version, burn token, recipient, then amount).
 */
export function parseMintEvent(
    event: Pick<StellarEvent, 'topic' | 'value'>,
): { nonce: string; sourceDomain: number; amount: bigint } | null {
    if (eventName(event) !== 'message_received') return null;
    try {
        const nonce = native(event.topic[2]);
        const value = native(event.value) as Record<string, unknown>;
        const body = value.message_body;
        const sourceDomain = value.source_domain;
        if (!(nonce instanceof Uint8Array) || nonce.length !== 32) return null;
        if (!(body instanceof Uint8Array) || body.length < 100) return null;
        if (typeof sourceDomain !== 'number') return null;
        // Burn message version 1 is the only layout this reads.
        if (hex(body.subarray(0, 4)) !== '00000001') return null;
        return {
            nonce: `0x${hex(nonce)}`,
            sourceDomain,
            amount: BigInt(`0x${hex(body.subarray(68, 100))}`),
        };
    } catch {
        return null;
    }
}

/** The lower time bound of a transaction envelope, or null if it has none. */
export function envelopeMinTime(envelopeXdr: string): string | null {
    try {
        // The passphrase only matters for hashing; any will do for reading.
        const tx = TransactionBuilder.fromXDR(envelopeXdr, Networks.PUBLIC);
        const inner = 'innerTransaction' in tx ? tx.innerTransaction : tx;
        return inner.timeBounds?.minTime ?? null;
    } catch {
        return null;
    }
}

/** The ledger an event id or paging cursor points into (its high 32 bits). */
export function cursorLedger(cursor: string): number | null {
    const match = /^(\d+)-\d+$/.exec(cursor);
    if (!match) return null;
    return Number(BigInt(match[1]) >> 32n);
}

type EventsPage = { events: StellarEvent[]; cursor: string; latestLedger: number };
type Health = { latestLedger: number; oldestLedger: number; latestLedgerCloseTime?: string };

const PAGE_SIZE = 1_000;
// Ledgers close about every five to six seconds. Erring long starts a first
// run a little early, which costs a few extra events and misses nothing.
const SECONDS_PER_LEDGER = 5;

export async function scanStellar(args: {
    contracts: { tokenMessengerMinter: string; messageTransmitter: string };
    rpcUrls: readonly string[];
    /** Last ledger fully scanned, or null on the first run. */
    fromLedger: number | null;
    since: Date;
    deadline: number;
    destOf: (domain: number) => string | null;
    /** Which lower time bounds count; the usage tag unless a check passes another. */
    matches?: (minTime: string | null) => boolean;
}): Promise<{
    transfers: TransferRecord[];
    mints: MintRecord[];
    through: number | null;
    /** Transactions examined, tagged or not. */
    seen: number;
    coverage: ChainCoverage;
}> {
    const call = jsonRpc(args.rpcUrls);
    const matches = args.matches ?? minTimeIsTag;
    const transfers: TransferRecord[] = [];
    const mints: MintRecord[] = [];
    let through = args.fromLedger;
    let seen = 0;
    let note: string | undefined;

    try {
        const health = (await call('getHealth', {})) as Health;
        let start: number;
        if (args.fromLedger !== null) {
            start = args.fromLedger + 1;
        } else {
            const latestClose = Number(health.latestLedgerCloseTime ?? Date.now() / 1000);
            const secondsBack = Math.max(0, latestClose - args.since.getTime() / 1000);
            start = health.latestLedger - Math.ceil(secondsBack / SECONDS_PER_LEDGER) - 100;
        }
        if (start < health.oldestLedger) {
            if (args.fromLedger !== null) {
                note = `ledgers ${start} to ${health.oldestLedger - 1} were no longer kept by the RPC and were not scanned`;
            }
            start = health.oldestLedger;
        }

        const filters = [
            {
                type: 'contract',
                contractIds: [
                    args.contracts.tokenMessengerMinter,
                    args.contracts.messageTransmitter,
                ],
            },
        ];
        const tagged = new Map<string, boolean>();
        let cursor: string | null = null;
        let complete = start > health.latestLedger;

        while (!complete) {
            if (Date.now() >= args.deadline) break;
            const page = (await call(
                'getEvents',
                cursor
                    ? { filters, pagination: { cursor, limit: PAGE_SIZE } }
                    : { startLedger: start, filters, pagination: { limit: PAGE_SIZE } },
            )) as EventsPage;

            const relevant = page.events.filter(
                (e) =>
                    e.inSuccessfulContractCall !== false &&
                    (eventName(e) === 'deposit_for_burn' || eventName(e) === 'message_received'),
            );
            const hashes = [...new Set(relevant.map((e) => e.txHash))].filter(
                (hash) => !tagged.has(hash),
            );
            await mapLimit(hashes, 6, async (hash) => {
                const tx = (await call('getTransaction', { hash })) as {
                    status?: string;
                    envelopeXdr?: string;
                };
                if (!tx.envelopeXdr) throw new Error(`transaction ${hash} was not returned`);
                tagged.set(hash, matches(envelopeMinTime(tx.envelopeXdr)));
            });
            seen += hashes.length;

            for (const event of relevant) {
                if (!tagged.get(event.txHash)) continue;
                const id = `stellar:${event.txHash}:${event.id}`;
                const burn = parseBurnEvent(event);
                if (burn) {
                    transfers.push({
                        id,
                        chain: 'stellar',
                        tx: event.txHash,
                        time: event.ledgerClosedAt,
                        from: burn.depositor,
                        amount: burn.amount.toString(),
                        destDomain: burn.destDomain,
                        dest: args.destOf(burn.destDomain),
                        nonce: null,
                    });
                }
                const mint = parseMintEvent(event);
                if (mint) {
                    mints.push({
                        id,
                        chain: 'stellar',
                        tx: event.txHash,
                        time: event.ledgerClosedAt,
                        sourceDomain: mint.sourceDomain,
                        source: args.destOf(mint.sourceDomain),
                        amount: mint.amount.toString(),
                        nonce: mint.nonce,
                    });
                }
            }

            // Each call covers a bounded run of ledgers and returns a cursor
            // at the end of what it covered. A page that was not full and
            // whose cursor has reached the head means everything is read. A
            // full page stopped inside a ledger, so that ledger is read again.
            const at = cursorLedger(page.cursor);
            const stalled = page.cursor === cursor && page.events.length === 0;
            if (at !== null) {
                through = page.events.length < PAGE_SIZE ? at : at - 1;
            }
            if (
                stalled ||
                (page.events.length < PAGE_SIZE && at !== null && at >= page.latestLedger)
            ) {
                complete = true;
            }
            cursor = page.cursor;
        }

        return {
            transfers,
            mints,
            through,
            seen,
            coverage: {
                chain: 'stellar',
                status: complete ? 'ok' : 'behind',
                through: complete ? new Date().toISOString() : null,
                ...(note ? { note } : {}),
            },
        };
    } catch (err) {
        return {
            transfers,
            mints,
            through,
            seen,
            coverage: {
                chain: 'stellar',
                status: 'error',
                through: null,
                note: describeError(err),
            },
        };
    }
}
