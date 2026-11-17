import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { xdr } from '@stellar/stellar-sdk';
import { translateError } from '../errors/translate';
import { latestLedgerSequence, stellarRpcCall, transactionStatus } from './client';

// What a protocol 30 node really answers: captured from Stellar testnet two
// weeks after it upgraded. Protocol 30 changed the ledger header, and a
// library older than that cannot read it.
const protocol30 = JSON.parse(
    readFileSync(new URL('./fixtures/latest-ledger-protocol-30.json', import.meta.url), 'utf8'),
).result as { sequence: number; protocolVersion: number; headerXdr: string };

describe('the Stellar library this app ships', () => {
    test('can read a protocol 30 ledger header', () => {
        // The failure this guards against, word for word:
        // "XDR Read Error: unknown StellarValueType member for value 3".
        const header = xdr.LedgerHeader.fromXDR(protocol30.headerXdr, 'base64');
        expect(header.ledgerVersion()).toBe(30);
        expect(header.ledgerSeq()).toBe(protocol30.sequence);
    });
});

describe('the latest ledger number', () => {
    test('comes straight out of the reply of a protocol 30 node', async () => {
        expect(await latestLedgerSequence(async () => protocol30)).toBe(5786032);
    });

    test('does not depend on the binary parts of the reply at all', async () => {
        // Whatever a future protocol does to these fields, the number is
        // still the number.
        const unreadable = { ...protocol30, headerXdr: 'not base64 !!', metadataXdr: 'AAAA' };
        expect(await latestLedgerSequence(async () => unreadable)).toBe(protocol30.sequence);
    });

    test('a reply without a usable ledger number is refused, not guessed at', async () => {
        for (const sequence of [undefined, null, '5786032', 0, -1, 1.5, Number.NaN]) {
            await expect(
                latestLedgerSequence(async () => ({ ...protocol30, sequence })),
                String(sequence),
            ).rejects.toThrow(/getLatestLedger/);
        }
    });
});

describe('the status of a submitted transaction', () => {
    test.each(['SUCCESS', 'FAILED', 'NOT_FOUND'] as const)('%s is passed on as is', async (s) => {
        expect(await transactionStatus('abc', async () => ({ status: s }))).toBe(s);
    });

    test('asks about the hash it was given', async () => {
        const asked: unknown[] = [];
        await transactionStatus('f00d', async (method, params) => {
            asked.push(method, params);
            return { status: 'NOT_FOUND' };
        });
        expect(asked).toEqual(['getTransaction', { hash: 'f00d' }]);
    });

    test('the binary parts of the reply are never read', async () => {
        // A transaction that landed must read as landed even when the result
        // comes back in a format this app has never seen.
        const reply = {
            status: 'SUCCESS',
            resultXdr: '!!',
            resultMetaXdr: '!!',
            envelopeXdr: '!!',
        };
        expect(await transactionStatus('abc', async () => reply)).toBe('SUCCESS');
    });

    test('an unknown status word is an error, never a guess', async () => {
        await expect(transactionStatus('abc', async () => ({ status: 'MAYBE' }))).rejects.toThrow(
            /getTransaction/,
        );
        await expect(transactionStatus('abc', async () => ({}))).rejects.toThrow(/getTransaction/);
    });
});

describe('a plain call to the node', () => {
    const answering = (body: unknown, status = 200) =>
        (async () => ({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        })) as unknown as typeof fetch;

    test('sends one JSON-RPC request and returns its result', async () => {
        const sent: { url: string; body: unknown }[] = [];
        const spy = (async (url: string, init: RequestInit) => {
            sent.push({ url, body: JSON.parse(String(init.body)) });
            return { ok: true, status: 200, json: async () => ({ result: { sequence: 7 } }) };
        }) as unknown as typeof fetch;

        const result = await stellarRpcCall(
            'getTransaction',
            { hash: 'abc' },
            { url: 'https://node.example', fetch: spy },
        );

        expect(result).toEqual({ sequence: 7 });
        expect(sent).toEqual([
            {
                url: 'https://node.example',
                body: { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: { hash: 'abc' } },
            },
        ]);
    });

    test('a node that cannot be reached reads as unreachable', async () => {
        const down = (async () => {
            throw new TypeError('Failed to fetch');
        }) as unknown as typeof fetch;
        const error = await stellarRpcCall('getLatestLedger', undefined, { fetch: down }).catch(
            (e) => e,
        );
        expect(translateError(error, { family: 'stellar' }).code).toBe('RPC_UNREACHABLE');
    });

    test('an HTTP error reads as unreachable too', async () => {
        const error = await stellarRpcCall('getLatestLedger', undefined, {
            fetch: answering({}, 503),
        }).catch((e) => e);
        expect(String(error.message)).toContain('503');
        expect(translateError(error, { family: 'stellar' }).code).toBe('RPC_UNREACHABLE');
    });

    test('a call that never answers is given up on', async () => {
        const hanging = ((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
            })) as unknown as typeof fetch;
        const error = await stellarRpcCall('getLatestLedger', undefined, {
            fetch: hanging,
            timeoutMs: 20,
        }).catch((e) => e);
        expect(translateError(error, { family: 'stellar' }).code).toBe('RPC_UNREACHABLE');
    });

    test('an error from the node is reported with its own words', async () => {
        const refusing = answering({ error: { code: -32601, message: 'method not found' } });
        await expect(
            stellarRpcCall('getLatestLedger', undefined, { fetch: refusing }),
        ).rejects.toThrow(/method not found/);
    });

    test('a reply with no result is refused', async () => {
        await expect(
            stellarRpcCall('getLatestLedger', undefined, { fetch: answering({}) }),
        ).rejects.toThrow(/getLatestLedger/);
        await expect(
            stellarRpcCall('getLatestLedger', undefined, { fetch: answering({ result: 'nope' }) }),
        ).rejects.toThrow(/getLatestLedger/);
    });
});
