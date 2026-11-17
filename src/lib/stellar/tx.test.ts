import { describe, expect, test } from 'vitest';
import { Contract, Networks, nativeToScVal } from '@stellar/stellar-sdk';
import { STELLAR_TAG_MIN_TIME } from '../attribution/tag';
import {
    STELLAR_TX_TIMEOUT_S,
    contractCallBuilder,
    pickTaggedOrPlain,
    stellarTimebounds,
} from './tx';

const CALLER = 'GBRFS5SMB55JJHJIHZQEZYBHDPBEM3WGMDUR7WQ6YBVYTOYJXXHAGIJ7';
const CONTRACT = 'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY';

describe('time bounds', () => {
    test('the upper bound is the usual timeout from now, the lower bound is what was asked', () => {
        expect(STELLAR_TX_TIMEOUT_S).toBe(180);
        expect(stellarTimebounds(0, 1_000_000)).toEqual({ minTime: 0, maxTime: 1180 });
        expect(stellarTimebounds(STELLAR_TAG_MIN_TIME, 1_000_000)).toEqual({
            minTime: 1752133747,
            maxTime: 1180,
        });
    });
});

// A simulation result is just "did it fail" here; the real one is the RPC's.
type Sim = { ok: boolean; of: number };

function harness(outcome: (minTime: number) => boolean | Error) {
    const built: number[] = [];
    const simulated: number[] = [];
    return {
        built,
        simulated,
        args: {
            build: (minTime: number) => {
                built.push(minTime);
                return minTime;
            },
            simulate: async (tx: number): Promise<Sim> => {
                simulated.push(tx);
                const result = outcome(tx);
                if (result instanceof Error) throw result;
                return { ok: result, of: tx };
            },
            failed: (sim: Sim) => !sim.ok,
        },
    };
}

describe('the tagged transaction is used only when it simulates cleanly', () => {
    test('tagged simulation succeeds: the tagged transaction is the one to sign', async () => {
        const h = harness(() => true);
        const picked = await pickTaggedOrPlain({ ...h.args, enabled: true });
        expect(picked).toEqual({
            tx: STELLAR_TAG_MIN_TIME,
            sim: { ok: true, of: STELLAR_TAG_MIN_TIME },
            tagged: true,
        });
        expect(h.simulated).toEqual([STELLAR_TAG_MIN_TIME]);
    });

    test('tagged simulation fails: the plain transaction and its simulation are used', async () => {
        const h = harness((minTime) => minTime === 0);
        const picked = await pickTaggedOrPlain({ ...h.args, enabled: true });
        expect(picked).toEqual({ tx: 0, sim: { ok: true, of: 0 }, tagged: false });
        expect(h.built).toEqual([STELLAR_TAG_MIN_TIME, 0]);
    });

    test('both fail: the plain failure is the one reported, as before the tag existed', async () => {
        const h = harness(() => false);
        const picked = await pickTaggedOrPlain({ ...h.args, enabled: true });
        expect(picked).toEqual({ tx: 0, sim: { ok: false, of: 0 }, tagged: false });
    });

    test('the RPC throws on the tagged attempt: the plain attempt decides', async () => {
        const h = harness((minTime) => (minTime === 0 ? true : new Error('rpc down')));
        const picked = await pickTaggedOrPlain({ ...h.args, enabled: true });
        expect(picked.tagged).toBe(false);
        expect(picked.tx).toBe(0);
    });

    test('the RPC throws on the plain attempt: the error surfaces, as today', async () => {
        const h = harness(() => new Error('rpc down'));
        await expect(pickTaggedOrPlain({ ...h.args, enabled: false })).rejects.toThrow('rpc down');
    });

    test('building the tagged transaction throws: the plain one is built and used', async () => {
        const h = harness(() => true);
        const build = (minTime: number) => {
            if (minTime !== 0) throw new Error('cannot build with a lower bound');
            return h.args.build(minTime);
        };
        const picked = await pickTaggedOrPlain({ ...h.args, build, enabled: true });
        expect(picked).toEqual({ tx: 0, sim: { ok: true, of: 0 }, tagged: false });
    });

    test('tag off: one plain build, one simulation', async () => {
        const h = harness(() => true);
        const picked = await pickTaggedOrPlain({ ...h.args, enabled: false });
        expect(picked.tagged).toBe(false);
        expect(h.built).toEqual([0]);
        expect(h.simulated).toEqual([0]);
    });
});

describe('the contract call builder', () => {
    const operation = new Contract(CONTRACT).call(
        'is_nonce_used',
        nativeToScVal(new Uint8Array(32), { type: 'bytes' }),
    );
    const build = contractCallBuilder({
        caller: CALLER,
        sequence: '1000',
        fee: '10000',
        networkPassphrase: Networks.TESTNET,
        operation,
    });

    test('the tagged build carries the tag as its lower time bound', () => {
        const tagged = build(STELLAR_TAG_MIN_TIME);
        expect(tagged.timeBounds?.minTime).toBe('1752133747');
        expect(Number(tagged.timeBounds?.maxTime)).toBeGreaterThan(Date.now() / 1000);
    });

    test('the plain build has no lower bound, exactly like a transaction before the tag', () => {
        const plain = build(0);
        expect(plain.timeBounds?.minTime).toBe('0');
        const now = Date.now() / 1000;
        expect(Number(plain.timeBounds?.maxTime)).toBeGreaterThan(now + 170);
        expect(Number(plain.timeBounds?.maxTime)).toBeLessThanOrEqual(now + 181);
    });

    test('building twice does not consume a second sequence number', () => {
        // The fallback builds a second transaction for the same slot. If the
        // two differed in sequence the fallback would be invalid on chain.
        const tagged = build(STELLAR_TAG_MIN_TIME);
        const plain = build(0);
        expect(tagged.sequence).toBe('1001');
        expect(plain.sequence).toBe('1001');
        expect(build(0).sequence).toBe('1001');
    });

    test('nothing else differs between the two builds', () => {
        const tagged = build(STELLAR_TAG_MIN_TIME);
        const plain = build(0);
        expect(tagged.fee).toBe(plain.fee);
        expect(tagged.source).toBe(plain.source);
        expect(tagged.memo.type).toBe('none');
        expect(tagged.operations).toHaveLength(1);
        expect(tagged.operations[0]).toEqual(plain.operations[0]);
    });
});
