import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Account, Contract, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import {
    cursorLedger,
    envelopeMinTime,
    eventName,
    parseBurnEvent,
    parseMintEvent,
    scanStellar,
    type StellarEvent,
} from '../../scripts/stats/stellar';
import { STELLAR_TAG_MIN_TIME, minTimeIsTag } from '../../src/lib/attribution/tag';

const read = (name: string) =>
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').trim();
const event = (name: string) => JSON.parse(read(name));

// Real mainnet events, as the RPC returns them (base64 XDR). Expected values
// were decoded by hand when the fixtures were captured.
describe('reading CCTP events on Stellar', () => {
    test('event names', () => {
        expect(eventName(event('stellar-deposit-for-burn.json'))).toBe('deposit_for_burn');
        expect(eventName(event('stellar-message-received.json'))).toBe('message_received');
        expect(eventName(event('stellar-mint-and-forward.json'))).toBe('mint_and_forward');
    });

    test('a burn: who burned, how much in 6 decimal units, and where to', () => {
        expect(parseBurnEvent(event('stellar-deposit-for-burn.json'))).toEqual({
            depositor: 'GALDWCQPPCAGTMDGAFL74FIKC2QBNWYXHPOXBZC3JO7KMOWPEOF5YNVI',
            // 11.48 USDC. The contract reports the wire amount, not Stellar's 7 decimals.
            amount: 11_480_000n,
            destDomain: 5,
        });
    });

    test('a mint: the nonce, the source domain and the burned amount from the message', () => {
        expect(parseMintEvent(event('stellar-message-received.json'))).toEqual({
            nonce: '0x265356d997d4d6c61392f00dc44ac38f2e6bd7aa323e3d2c4d762935c0f76b22',
            sourceDomain: 6,
            amount: 117_822_246n,
        });
    });

    test('each parser ignores the other kinds of event', () => {
        expect(parseBurnEvent(event('stellar-message-received.json'))).toBeNull();
        expect(parseBurnEvent(event('stellar-mint-and-forward.json'))).toBeNull();
        expect(parseMintEvent(event('stellar-deposit-for-burn.json'))).toBeNull();
    });

    test('an event that cannot be decoded is ignored, not fatal', () => {
        const broken = { ...event('stellar-deposit-for-burn.json'), value: 'AAAA' };
        expect(parseBurnEvent(broken)).toBeNull();
        expect(eventName({ topic: [], value: '' } as never)).toBeNull();
    });
});

describe('reading the tag off a transaction envelope', () => {
    test('the testnet proof transaction carries the lower time bound it was built with', () => {
        expect(envelopeMinTime(read('stellar-tagged-envelope.txt'))).toBe('1234567890');
    });

    test('an ordinary mainnet burn has a lower bound of zero, which is not the tag', () => {
        const minTime = envelopeMinTime(read('stellar-plain-envelope.txt'));
        expect(minTime).toBe('0');
        expect(minTimeIsTag(minTime)).toBe(false);
    });

    test('something that is not an envelope reads as no time bound', () => {
        expect(envelopeMinTime('not xdr at all')).toBeNull();
        expect(envelopeMinTime('')).toBeNull();
    });
});

describe('where an event cursor points', () => {
    test('the ledger is the high 32 bits of the id', () => {
        // The burn fixture: this id, in ledger 65513275.
        expect(cursorLedger('0281377373581017088-0000000003')).toBe(65_513_275);
        expect(cursorLedger(event('stellar-deposit-for-burn.json').id)).toBe(
            event('stellar-deposit-for-burn.json').ledger,
        );
    });

    test('an unreadable cursor is no ledger', () => {
        expect(cursorLedger('')).toBeNull();
        expect(cursorLedger('abc-def')).toBeNull();
    });
});

// ─── the whole scanner against a scripted node ───────────────────────

const CONTRACTS = {
    tokenMessengerMinter: 'CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL',
    messageTransmitter: 'CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV',
};
const SOURCE = 'GALDWCQPPCAGTMDGAFL74FIKC2QBNWYXHPOXBZC3JO7KMOWPEOF5YNVI';

/** A transaction envelope whose lower time bound is `minTime`. */
const envelope = (minTime: number) =>
    new TransactionBuilder(new Account(SOURCE, '1'), {
        fee: '100',
        networkPassphrase: Networks.PUBLIC,
        timebounds: { minTime, maxTime: 2_000_000_000 },
    })
        .addOperation(new Contract(CONTRACTS.tokenMessengerMinter).call('noop'))
        .build()
        .toEnvelope()
        .toXDR('base64');
const TAGGED = envelope(STELLAR_TAG_MIN_TIME);
const PLAIN = envelope(0);

const toid = (ledger: number) => (BigInt(ledger) << 32n).toString().padStart(19, '0');
let serial = 0;
/** A real burn or mint event, moved to a given ledger and transaction. */
function at(kind: 'burn' | 'mint', ledger: number, txHash: string): StellarEvent {
    serial += 1;
    const template = event(
        kind === 'burn' ? 'stellar-deposit-for-burn.json' : 'stellar-message-received.json',
    );
    return {
        ...template,
        ledger,
        txHash,
        id: `${toid(ledger)}-${String(serial).padStart(10, '0')}`,
        ledgerClosedAt: new Date((1_800_000_000 + ledger * 5) * 1000).toISOString(),
    };
}

type NodeOptions = {
    latest: number;
    oldest: number;
    events: StellarEvent[];
    envelopes: Record<string, string>;
    /** Ledgers one call may cover, like the real 10,000 ledger window. */
    window?: number;
    /** Leave the cursor out of every reply. */
    noCursor?: boolean;
    /** Fail the Nth getEvents call (1 based). */
    failOnCall?: number;
};

function node(o: NodeOptions) {
    const calls: { method: string; params: unknown }[] = [];
    let eventCalls = 0;
    const close = (ledger: number) => String(1_800_000_000 + ledger * 5);
    return {
        calls,
        eventCalls: () => eventCalls,
        call: async (method: string, params: unknown): Promise<unknown> => {
            calls.push({ method, params });
            if (method === 'getHealth') {
                return {
                    latestLedger: o.latest,
                    oldestLedger: o.oldest,
                    latestLedgerCloseTime: close(o.latest),
                    oldestLedgerCloseTime: close(o.oldest),
                };
            }
            if (method === 'getTransaction') {
                const { hash } = params as { hash: string };
                return { status: 'SUCCESS', envelopeXdr: o.envelopes[hash] };
            }
            if (method === 'getEvents') {
                eventCalls += 1;
                if (o.failOnCall === eventCalls) throw new Error('HTTP 502');
                const p = params as {
                    startLedger?: number;
                    pagination: { limit: number; cursor?: string };
                };
                if (p.startLedger !== undefined && p.startLedger < o.oldest) {
                    throw new Error(
                        `startLedger must be within the ledger range: ${o.oldest} - ${o.latest}`,
                    );
                }
                const cursor = p.pagination.cursor;
                const fromLedger = cursor
                    ? Number(BigInt(cursor.split('-')[0]) >> 32n)
                    : p.startLedger!;
                const end = Math.min(o.latest, fromLedger + (o.window ?? 10_000) - 1);
                const pending = o.events
                    .filter(
                        (e) => (cursor ? e.id > cursor : e.ledger >= fromLedger) && e.ledger <= end,
                    )
                    .sort((a, b) => (a.id < b.id ? -1 : 1));
                const page = pending.slice(0, p.pagination.limit);
                const full = page.length === p.pagination.limit && pending.length > page.length;
                const next = full ? page[page.length - 1].id : `${toid(end)}-4294967295`;
                return {
                    events: page,
                    latestLedger: o.latest,
                    ...(o.noCursor ? {} : { cursor: next }),
                };
            }
            throw new Error(`unexpected ${method}`);
        },
    };
}

const stellarScan = (
    n: ReturnType<typeof node>,
    extra: Partial<Parameters<typeof scanStellar>[0]> = {},
) =>
    scanStellar({
        contracts: CONTRACTS,
        rpcUrls: ['scripted'],
        fromLedger: 1_000,
        since: new Date(0),
        deadline: Number.MAX_SAFE_INTEGER,
        destOf: (domain) => (domain === 5 ? 'solana' : domain === 6 ? 'base' : null),
        call: n.call,
        ...extra,
    });

describe('scanning Stellar end to end', () => {
    const world = (): NodeOptions => ({
        latest: 30_000,
        oldest: 500,
        events: [
            at('burn', 1_010, 'tagged-burn'),
            at('mint', 1_020, 'tagged-mint'),
            at('burn', 1_030, 'plain-burn'),
            at('burn', 25_000, 'late-tagged-burn'),
        ],
        envelopes: {
            'tagged-burn': TAGGED,
            'tagged-mint': TAGGED,
            'plain-burn': PLAIN,
            'late-tagged-burn': TAGGED,
        },
    });

    test('reads window after window to the head and keeps only tagged transactions', async () => {
        const n = node(world());
        const result = await stellarScan(n);
        expect(result.coverage.status).toBe('ok');
        expect(result.through).toBe(30_000);
        expect(result.gap).toBeNull();
        expect(result.seen).toBe(4);
        expect(result.transfers.map((t) => t.tx)).toEqual(['tagged-burn', 'late-tagged-burn']);
        expect(result.transfers[0]).toMatchObject({
            chain: 'stellar',
            from: SOURCE,
            amount: '11480000',
            destDomain: 5,
            dest: 'solana',
            nonce: null,
        });
        expect(result.mints).toHaveLength(1);
        expect(result.mints[0]).toMatchObject({
            tx: 'tagged-mint',
            sourceDomain: 6,
            source: 'base',
            amount: '117822246',
            nonce: '0x265356d997d4d6c61392f00dc44ac38f2e6bd7aa323e3d2c4d762935c0f76b22',
        });
        // 29,000 ledgers at 10,000 a call.
        expect(n.eventCalls()).toBe(3);
    });

    test('a page that fills up inside a ledger loses and repeats nothing', async () => {
        const options = world();
        options.events = [
            at('burn', 1_010, 'tagged-burn'),
            at('mint', 1_010, 'tagged-mint'),
            at('burn', 1_010, 'late-tagged-burn'),
        ];
        const result = await stellarScan(node(options), { pageSize: 2 });
        expect(result.coverage.status).toBe('ok');
        expect(result.transfers.map((t) => t.tx)).toEqual(['tagged-burn', 'late-tagged-burn']);
        expect(result.mints.map((m) => m.tx)).toEqual(['tagged-mint']);
    });

    test('a checkpoint older than the node keeps is reported as a hole, then scanning resumes', async () => {
        const n = node(world());
        const result = await stellarScan(n, { fromLedger: 100 });
        expect(result.coverage.status).toBe('ok');
        expect(result.through).toBe(30_000);
        // Ledgers 101 to 499 are gone. The hole ends where the node's history begins.
        expect(result.gap).toEqual({
            to: new Date((1_800_000_000 + 500 * 5) * 1000).toISOString(),
        });
        expect(result.transfers).toHaveLength(2);
    });

    test('a first run that starts before the node keeps anything reports the hole too', async () => {
        const n = node(world());
        const result = await stellarScan(n, { fromLedger: null, since: new Date(0) });
        expect(result.gap).toEqual({
            to: new Date((1_800_000_000 + 500 * 5) * 1000).toISOString(),
        });
        expect(result.coverage.status).toBe('ok');
    });

    test('a first run that starts inside what the node keeps reports no hole', async () => {
        const n = node(world());
        const since = new Date((1_800_000_000 + 20_000 * 5) * 1000);
        const result = await stellarScan(n, { fromLedger: null, since });
        expect(result.gap).toBeNull();
        expect(result.transfers.map((t) => t.tx)).toEqual(['late-tagged-burn']);
    });

    test('a reply without a cursor stops the scan instead of asking again forever', async () => {
        const n = node({ ...world(), noCursor: true });
        const result = await stellarScan(n);
        expect(result.coverage.status).toBe('error');
        expect(n.eventCalls()).toBe(1);
    });

    test('a failure part way keeps what was read and does not move past it', async () => {
        const n = node({ ...world(), failOnCall: 2 });
        const result = await stellarScan(n);
        expect(result.coverage.status).toBe('error');
        expect(result.transfers.map((t) => t.tx)).toEqual(['tagged-burn']);
        // The first call covered ledgers 1,001 to 11,000.
        expect(result.through).toBe(11_000);
    });

    test('running out of time is reported as behind, with the place kept', async () => {
        const n = node(world());
        let clock = 0;
        const result = await stellarScan(n, { deadline: 1_000, now: () => (clock += 600) });
        expect(result.coverage.status).toBe('behind');
        expect(result.through).toBe(11_000);
    });
});
