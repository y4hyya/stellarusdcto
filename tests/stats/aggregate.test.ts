import { describe, expect, test } from 'vitest';
import { buildStats } from '../../scripts/stats/aggregate';
import type { MintRecord, TransferRecord } from '../../src/lib/stats/types';

const EVM_A = '0xAbCdEf0000000000000000000000000000000001';
const SOL_A = '3roaATgp65UYKFSf1y9vdE73x4v9cSZrfYkWCBLXSCnU';
const XLM_A = 'GBRFS5SMB55JJHJIHZQEZYBHDPBEM3WGMDUR7WQ6YBVYTOYJXXHAGIJ7';

let seq = 0;
function transfer(over: Partial<TransferRecord> = {}): TransferRecord {
    seq += 1;
    return {
        id: `base:0x${seq}:0`,
        chain: 'base',
        tx: `0x${seq}`,
        time: '2026-11-20T10:00:00Z',
        from: EVM_A,
        amount: '1000000',
        destDomain: 27,
        dest: 'stellar',
        nonce: `0x${String(seq).padStart(64, '0')}`,
        ...over,
    };
}

function mint(over: Partial<MintRecord> = {}): MintRecord {
    seq += 1;
    return {
        id: `stellar:m${seq}`,
        chain: 'stellar',
        tx: `m${seq}`,
        time: '2026-11-20T11:00:00Z',
        sourceDomain: 6,
        source: 'base',
        amount: '1000000',
        nonce: `0x${String(seq).padStart(64, 'f')}`,
        ...over,
    };
}

const familyOf = (chain: string) =>
    chain === 'solana' ? 'solana' : chain === 'stellar' ? 'stellar' : 'evm';
const explorerUrl = (chain: string, tx: string) => `https://explorer.test/${chain}/${tx}`;
const now = new Date('2026-11-22T12:00:00Z');

const stats = (transfers: TransferRecord[], mints: MintRecord[] = []) =>
    buildStats({
        transfers,
        mints,
        coverage: [{ chain: 'base', status: 'ok', through: '2026-11-22T11:00:00Z' }],
        familyOf,
        explorerUrl,
        now,
        since: '2026-11-16',
    });

describe('totals', () => {
    test('count and volume add up in 6 decimal units', () => {
        const s = stats([
            transfer({ amount: '1000000' }),
            transfer({ amount: '2500000' }),
            transfer({ amount: '500000' }),
        ]);
        expect(s.totals.transfers).toBe(3);
        expect(s.totals.volume).toBe('4000000');
    });

    test('nothing counted yet is a valid, empty result', () => {
        const s = stats([]);
        expect(s.schema).toBe(1);
        expect(s.tag).toBe('stablehops');
        expect(s.since).toBe('2026-11-16');
        expect(s.generatedAt).toBe('2026-11-22T12:00:00.000Z');
        expect(s.totals).toEqual({
            transfers: 0,
            volume: '0',
            wallets: 0,
            walletsByFamily: { evm: 0, solana: 0, stellar: 0 },
            rescues: 0,
            rescuedVolume: '0',
        });
        expect(s.daily).toEqual([]);
        expect(s.routes).toEqual([]);
        expect(s.recent).toEqual([]);
        expect(s.coverage).toHaveLength(1);
    });

    test('volume beyond 2^53 units is still exact', () => {
        const s = stats([
            transfer({ amount: '9007199254740993' }),
            transfer({ amount: '9007199254740993' }),
        ]);
        expect(s.totals.volume).toBe('18014398509481986');
    });
});

describe('unique wallets', () => {
    test('one EVM address on two chains, in different letter case, counts once', () => {
        const s = stats([
            transfer({ chain: 'base', from: EVM_A }),
            transfer({ chain: 'arbitrum', from: EVM_A.toLowerCase() }),
        ]);
        expect(s.totals.wallets).toBe(1);
        expect(s.totals.walletsByFamily).toEqual({ evm: 1, solana: 0, stellar: 0 });
    });

    test('Solana and Stellar addresses add one each and stay case sensitive', () => {
        const s = stats([
            transfer({ chain: 'base', from: EVM_A }),
            transfer({ chain: 'solana', from: SOL_A }),
            transfer({ chain: 'stellar', from: XLM_A }),
            transfer({ chain: 'stellar', from: XLM_A }),
        ]);
        expect(s.totals.wallets).toBe(3);
        expect(s.totals.walletsByFamily).toEqual({ evm: 1, solana: 1, stellar: 1 });
    });
});

describe('daily series', () => {
    test('one row per UTC day from the first transfer to today, gaps filled with zeros', () => {
        const s = stats([
            transfer({ time: '2026-11-20T23:59:59Z', amount: '1000000' }),
            transfer({ time: '2026-11-22T00:00:01Z', amount: '3000000' }),
        ]);
        expect(s.daily).toEqual([
            { date: '2026-11-20', transfers: 1, volume: '1000000', newWallets: 1 },
            { date: '2026-11-21', transfers: 0, volume: '0', newWallets: 0 },
            { date: '2026-11-22', transfers: 1, volume: '3000000', newWallets: 0 },
        ]);
    });

    test('a wallet is new only on the day of its first transfer', () => {
        const s = stats([
            transfer({ time: '2026-11-21T08:00:00Z', from: EVM_A }),
            transfer({ time: '2026-11-22T08:00:00Z', from: EVM_A }),
            transfer({ time: '2026-11-22T09:00:00Z', chain: 'solana', from: SOL_A }),
        ]);
        expect(s.daily.map((d) => d.newWallets)).toEqual([1, 1]);
    });

    test('records arriving out of time order still land on the right days', () => {
        const s = stats([
            transfer({ time: '2026-11-22T08:00:00Z', from: EVM_A }),
            transfer({ time: '2026-11-21T08:00:00Z', from: EVM_A }),
        ]);
        expect(s.daily.map((d) => [d.date, d.newWallets])).toEqual([
            ['2026-11-21', 1],
            ['2026-11-22', 0],
        ]);
    });
});

describe('routes', () => {
    test('grouped by source and destination, largest volume first', () => {
        const s = stats([
            transfer({ chain: 'base', dest: 'stellar', amount: '1000000' }),
            transfer({ chain: 'base', dest: 'stellar', amount: '1000000' }),
            transfer({ chain: 'stellar', dest: 'solana', destDomain: 5, amount: '9000000' }),
        ]);
        expect(s.routes).toEqual([
            { source: 'stellar', dest: 'solana', transfers: 1, volume: '9000000' },
            { source: 'base', dest: 'stellar', transfers: 2, volume: '2000000' },
        ]);
    });

    test('a destination the registry does not know is labelled by its domain', () => {
        const s = stats([transfer({ dest: null, destDomain: 99 })]);
        expect(s.routes[0].dest).toBe('domain 99');
        expect(s.recent[0].dest).toBe('domain 99');
    });
});

describe('rescues: finished here, started elsewhere', () => {
    test('a tagged mint whose nonce matches no tagged burn is a rescue', () => {
        const s = stats([transfer()], [mint({ amount: '7000000' })]);
        expect(s.totals.rescues).toBe(1);
        expect(s.totals.rescuedVolume).toBe('7000000');
    });

    test('a tagged mint that finishes one of our own burns is not', () => {
        const burn = transfer({ nonce: '0xAAAA' });
        const s = stats([burn], [mint({ nonce: '0xaaaa' })]);
        expect(s.totals.rescues).toBe(0);
        expect(s.totals.rescuedVolume).toBe('0');
    });

    test('a burn whose nonce is not known yet still claims its own mint', () => {
        // Until Circle reports the nonce, the burn is matched by source and
        // amount so its mint is not miscounted as a rescue in the meantime.
        const burn = transfer({ chain: 'base', amount: '4200000', nonce: null });
        const s = stats([burn], [mint({ source: 'base', amount: '4200000' })]);
        expect(s.totals.rescues).toBe(0);
    });

    test('rescues never add to transfers or volume', () => {
        const s = stats([], [mint({ amount: '7000000' })]);
        expect(s.totals.transfers).toBe(0);
        expect(s.totals.volume).toBe('0');
        expect(s.totals.rescues).toBe(1);
    });
});

describe('recent transfers', () => {
    test('at most 20, newest first, each with an explorer link', () => {
        const many = Array.from({ length: 25 }, (_, i) =>
            transfer({ time: `2026-11-20T10:${String(i).padStart(2, '0')}:00Z`, tx: `0xtx${i}` }),
        );
        const s = stats(many);
        expect(s.recent).toHaveLength(20);
        expect(s.recent[0].tx).toBe('0xtx24');
        expect(s.recent[19].tx).toBe('0xtx5');
        expect(s.recent[0]).toEqual({
            time: '2026-11-20T10:24:00Z',
            source: 'base',
            dest: 'stellar',
            amount: '1000000',
            tx: '0xtx24',
            url: 'https://explorer.test/base/0xtx24',
        });
    });
});
