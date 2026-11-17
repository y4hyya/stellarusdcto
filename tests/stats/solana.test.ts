import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
    collectSignatures,
    decodeSolanaBurns,
    type SignatureInfo,
} from '../../scripts/stats/solana';

const PROGRAM = 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe';
const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

// Two real mainnet burns. Expected values were read from the raw instruction
// bytes when the fixtures were captured, not produced by this decoder.
describe('reading a burn out of a Solana transaction', () => {
    test('deposit_for_burn_with_hook in a legacy transaction', () => {
        expect(decodeSolanaBurns(fixture('solana-burn-hook.json'), PROGRAM)).toEqual([
            {
                index: 0,
                owner: '2S5iaGNfK6EAUVGymFX3QjxVgAxtJ4UhSntYmHB2zd83',
                amount: 114_554_200n,
                destDomain: 19,
            },
        ]);
    });

    test('plain deposit_for_burn among other instructions in a v0 transaction', () => {
        const burns = decodeSolanaBurns(fixture('solana-burn-plain.json'), PROGRAM);
        expect(burns).toHaveLength(1);
        expect(burns[0]).toMatchObject({
            owner: 'JDDa5PHbVp6oAR94cX3VetfFY7jVrNWK8yTpRino6ABB',
            amount: 30_736_734n,
            destDomain: 0,
        });
    });

    test('a transaction that touches another program holds no burn', () => {
        const tx = fixture('solana-burn-hook.json');
        expect(decodeSolanaBurns(tx, '11111111111111111111111111111111')).toEqual([]);
    });

    test('an instruction of the program that is not a burn is ignored', () => {
        const tx = fixture('solana-burn-hook.json');
        // Corrupt the discriminator: same program, some other instruction.
        tx.transaction.message.instructions[0].data =
            '1111' + tx.transaction.message.instructions[0].data.slice(4);
        expect(decodeSolanaBurns(tx, PROGRAM)).toEqual([]);
    });
});

const sig = (n: number, blockTime: number, memo: string | null = null): SignatureInfo => ({
    signature: `sig${n}`,
    blockTime,
    err: null,
    memo,
});

describe('paging through a program history, newest first', () => {
    const base = { sinceSec: 0, deadline: 1_000, now: () => 0, pageSize: 3 };

    test('pages are followed until a short one, each asked for from the last signature', async () => {
        const asked: (string | null)[] = [];
        const pages = [
            [sig(9, 900), sig(8, 800), sig(7, 700)],
            [sig(6, 600), sig(5, 500), sig(4, 400)],
            [sig(3, 300)],
        ];
        const result = await collectSignatures({
            ...base,
            fetchPage: async (before) => {
                asked.push(before);
                return pages.shift() ?? [];
            },
        });
        expect(asked).toEqual([null, 'sig7', 'sig4']);
        expect(result.complete).toBe(true);
        expect(result.entries.map((e) => e.signature)).toEqual([
            'sig9',
            'sig8',
            'sig7',
            'sig6',
            'sig5',
            'sig4',
            'sig3',
        ]);
    });

    test('a first run stops at the start time and keeps nothing older', async () => {
        const pages = [
            [sig(9, 900), sig(8, 800), sig(7, 700)],
            [sig(6, 600), sig(5, 500), sig(4, 400)],
            [sig(3, 300), sig(2, 200), sig(1, 100)],
        ];
        let calls = 0;
        const result = await collectSignatures({
            ...base,
            sinceSec: 550,
            fetchPage: async () => {
                calls += 1;
                return pages.shift() ?? [];
            },
        });
        expect(calls).toBe(2);
        expect(result.complete).toBe(true);
        expect(result.entries.map((e) => e.signature)).toEqual(['sig9', 'sig8', 'sig7', 'sig6']);
    });

    test('an empty history is complete', async () => {
        const result = await collectSignatures({ ...base, fetchPage: async () => [] });
        expect(result).toEqual({ entries: [], complete: true });
    });

    test('running out of time leaves the run incomplete so the checkpoint does not move', async () => {
        let clock = 0;
        const result = await collectSignatures({
            ...base,
            now: () => (clock += 600),
            fetchPage: async () => [sig(9, 900), sig(8, 800), sig(7, 700)],
        });
        expect(result.complete).toBe(false);
        expect(result.entries).toHaveLength(3);
    });
});
