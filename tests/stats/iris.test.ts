import { describe, expect, test } from 'vitest';
import { resolveNonces } from '../../scripts/stats/iris';
import type { TransferRecord } from '../../src/lib/stats/types';

const record = (over: Partial<TransferRecord>): TransferRecord => ({
    id: 'base:0xaa:1',
    chain: 'base',
    tx: '0xAA',
    time: '2026-11-20T10:00:00Z',
    from: '0x1',
    amount: '1000000',
    destDomain: 27,
    dest: 'stellar',
    nonce: null,
    ...over,
});

const NONCE_A = '0x' + 'a'.repeat(64);
const NONCE_B = '0x' + 'b'.repeat(64);
const ZERO = '0x' + '0'.repeat(64);
const domainOf = (chain: string) => (chain === 'base' ? 6 : chain === 'solana' ? 5 : 27);

function fakeIris(answers: Record<string, unknown>) {
    const asked: string[] = [];
    return {
        asked,
        fetchJson: async (url: string) => {
            asked.push(url);
            return url in answers ? answers[url] : null;
        },
    };
}

const BASE = 'https://iris.test';

describe('resolving burns to the nonce Circle assigned', () => {
    test('a burn gets its nonce from the message Circle reports for its transaction', async () => {
        const iris = fakeIris({
            [`${BASE}/v2/messages/6?transactionHash=0xaa`]: { messages: [{ eventNonce: NONCE_A }] },
        });
        const [resolved] = await resolveNonces([record({})], { irisBase: BASE, domainOf, ...iris });
        expect(resolved.nonce).toBe(NONCE_A);
        // Hex hashes are lowercased for the lookup.
        expect(iris.asked).toEqual([`${BASE}/v2/messages/6?transactionHash=0xaa`]);
    });

    test('a Solana signature is looked up exactly as it is', async () => {
        const signature = '5f9XwFpTo5dfMXv8yqsrR1tCtXZz8FvhDg5Fxj2fMoCg';
        const iris = fakeIris({
            [`${BASE}/v2/messages/5?transactionHash=${signature}`]: {
                messages: [{ eventNonce: NONCE_A }],
            },
        });
        const [resolved] = await resolveNonces(
            [record({ id: `solana:${signature}:0`, chain: 'solana', tx: signature })],
            { irisBase: BASE, domainOf, ...iris },
        );
        expect(resolved.nonce).toBe(NONCE_A);
    });

    test('a burn Circle does not know yet stays unresolved for the next run', async () => {
        const iris = fakeIris({});
        const [resolved] = await resolveNonces([record({})], { irisBase: BASE, domainOf, ...iris });
        expect(resolved.nonce).toBeNull();
    });

    test('a placeholder nonce (not attested yet) is not accepted', async () => {
        const iris = fakeIris({
            [`${BASE}/v2/messages/6?transactionHash=0xaa`]: { messages: [{ eventNonce: ZERO }] },
        });
        const [resolved] = await resolveNonces([record({})], { irisBase: BASE, domainOf, ...iris });
        expect(resolved.nonce).toBeNull();
    });

    test('a burn that already has its nonce is not asked about again', async () => {
        const iris = fakeIris({});
        const [resolved] = await resolveNonces([record({ nonce: NONCE_B })], {
            irisBase: BASE,
            domainOf,
            ...iris,
        });
        expect(resolved.nonce).toBe(NONCE_B);
        expect(iris.asked).toEqual([]);
    });

    test('several burns in one transaction take the messages in order, with one request', async () => {
        const iris = fakeIris({
            [`${BASE}/v2/messages/6?transactionHash=0xaa`]: {
                messages: [{ eventNonce: NONCE_A }, { eventNonce: NONCE_B }],
            },
        });
        const resolved = await resolveNonces(
            [record({ id: 'base:0xaa:7' }), record({ id: 'base:0xaa:3' })],
            { irisBase: BASE, domainOf, ...iris },
        );
        expect(iris.asked).toHaveLength(1);
        // Log position 3 comes before 7, whatever order the records are in.
        expect(resolved.map((r) => [r.id, r.nonce])).toEqual([
            ['base:0xaa:7', NONCE_B],
            ['base:0xaa:3', NONCE_A],
        ]);
    });

    test('a count mismatch between burns and messages resolves nothing rather than guess', async () => {
        const iris = fakeIris({
            [`${BASE}/v2/messages/6?transactionHash=0xaa`]: {
                messages: [{ eventNonce: NONCE_A }, { eventNonce: NONCE_B }],
            },
        });
        const [resolved] = await resolveNonces([record({})], { irisBase: BASE, domainOf, ...iris });
        expect(resolved.nonce).toBeNull();
    });

    test('a burn on a chain the registry no longer knows is skipped, not fatal', async () => {
        const strict = (chain: string) => {
            if (chain === 'gone') throw new Error('unknown chain: gone');
            return domainOf(chain);
        };
        const resolved = await resolveNonces(
            [
                record({ id: 'gone:0xcc:1', chain: 'gone', tx: '0xcc' }),
                record({ id: 'base:0xbb:1', tx: '0xbb' }),
            ],
            {
                irisBase: BASE,
                domainOf: strict,
                fetchJson: async () => ({ messages: [{ eventNonce: NONCE_B }] }),
            },
        );
        expect(resolved.map((r) => r.nonce)).toEqual([null, NONCE_B]);
    });

    test('a failing lookup leaves the burn unresolved and does not stop the others', async () => {
        const resolved = await resolveNonces(
            [record({ id: 'base:0xaa:1', tx: '0xaa' }), record({ id: 'base:0xbb:1', tx: '0xbb' })],
            {
                irisBase: BASE,
                domainOf,
                fetchJson: async (url: string) => {
                    if (url.endsWith('0xaa')) throw new Error('rate limited');
                    return { messages: [{ eventNonce: NONCE_B }] };
                },
            },
        );
        expect(resolved.map((r) => r.nonce)).toEqual([null, NONCE_B]);
    });
});
