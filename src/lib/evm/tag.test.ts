import { describe, expect, test } from 'vitest';
import { createPublicClient, custom, type Hex } from 'viem';
import { EVM_TAG_SUFFIX } from '../attribution/tag';
import { evmTagSuffix } from './tag';

// The gate is exercised through a real viem client, so the errors it has to
// read are the ones viem really produces. Only the node behind it is scripted:
// `node` answers each eth_call from the call data it is given.
type Reply = { result: Hex } | { error: { code: number; message: string; data?: unknown } } | Error;

const ACCOUNT = '0x000000000000000000000000000000000000dEaD' as const;
const TO = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as const;
const DATA = '0x8e0250ee00000000000000000000000000000000000000000000000000000000000f4240' as Hex;
const TAGGED = (DATA + EVM_TAG_SUFFIX.slice(2)) as Hex;

// Error(string) "nope", the shape a Solidity require produces.
const REVERT_DATA =
    '0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000046e6f706500000000000000000000000000000000000000000000000000000000';

function clientWith(node: (data: Hex) => Reply) {
    const seen: Hex[] = [];
    const client = createPublicClient({
        transport: custom(
            {
                async request({ method, params }: { method: string; params?: unknown }) {
                    if (method !== 'eth_call') throw new Error(`unexpected ${method}`);
                    const data = (params as [{ data: Hex }])[0].data;
                    seen.push(data);
                    const reply = node(data);
                    if (reply instanceof Error) throw reply;
                    if ('error' in reply) throw reply.error;
                    return reply.result;
                },
            },
            { retryCount: 0 },
        ),
    });
    return { client, seen };
}

const gate = (client: ReturnType<typeof clientWith>['client'], enabled = true) =>
    evmTagSuffix({ client, account: ACCOUNT, to: TO, data: DATA, enabled });

describe('the suffix is used only when it provably changes nothing', () => {
    test('both simulations succeed with the same return data', async () => {
        const { client } = clientWith(() => ({ result: '0x01' }));
        expect(await gate(client)).toBe(EVM_TAG_SUFFIX);
    });

    test('both simulations revert with the same revert data', async () => {
        // The batched path: no allowance yet, so the burn reverts either way,
        // but for the same reason, deep inside the token transfer.
        const { client } = clientWith(() => ({
            error: { code: 3, message: 'execution reverted: nope', data: REVERT_DATA },
        }));
        expect(await gate(client)).toBe(EVM_TAG_SUFFIX);
    });

    test('the plain call is simulated unchanged and the tagged one ends with the suffix', async () => {
        const { client, seen } = clientWith(() => ({ result: '0x01' }));
        await gate(client);
        expect([...seen].sort()).toEqual([DATA, TAGGED].sort());
    });
});

describe('a caller can gate a different suffix', () => {
    test('the given suffix is simulated and returned instead of the default', async () => {
        const other = '0x62617365617070070080218021802180218021802180218021' as Hex;
        const { client, seen } = clientWith(() => ({ result: '0x01' }));
        const result = await evmTagSuffix({
            client,
            account: ACCOUNT,
            to: TO,
            data: DATA,
            enabled: true,
            suffix: other,
        });
        expect(result).toBe(other);
        expect([...seen].sort()).toEqual([DATA, DATA + other.slice(2)].sort());
    });
});

describe('anything else sends the transaction untagged', () => {
    test('the tagged call reverts where the plain one succeeds', async () => {
        const { client } = clientWith((data) =>
            data === TAGGED
                ? { error: { code: 3, message: 'execution reverted', data: REVERT_DATA } }
                : { result: '0x01' },
        );
        expect(await gate(client)).toBeUndefined();
    });

    test('both succeed but return different data', async () => {
        const { client } = clientWith((data) => ({ result: data === TAGGED ? '0x02' : '0x01' }));
        expect(await gate(client)).toBeUndefined();
    });

    test('both revert for different reasons', async () => {
        const other = REVERT_DATA.replace('6e6f7065', '6e6f7066') as Hex;
        const { client } = clientWith((data) => ({
            error: {
                code: 3,
                message: 'execution reverted',
                data: data === TAGGED ? other : REVERT_DATA,
            },
        }));
        expect(await gate(client)).toBeUndefined();
    });

    test('both revert but the node strips the revert data', async () => {
        // "execution reverted" twice proves nothing: a decoding failure caused
        // by the suffix would look exactly the same.
        const { client } = clientWith(() => ({
            error: { code: 3, message: 'execution reverted' },
        }));
        expect(await gate(client)).toBeUndefined();
    });

    test('the node cannot be reached', async () => {
        const { client } = clientWith(() => new Error('fetch failed'));
        expect(await gate(client)).toBeUndefined();
    });

    test('the node never answers: the wait is bounded and the transfer goes out untagged', async () => {
        const silent = { call: () => new Promise<never>(() => {}) };
        const started = Date.now();
        const result = await evmTagSuffix({
            client: silent as never,
            account: ACCOUNT,
            to: TO,
            data: DATA,
            enabled: true,
            timeoutMs: 30,
        });
        expect(result).toBeUndefined();
        expect(Date.now() - started).toBeLessThan(1000);
    });

    test('the tag is switched off, and nothing is simulated', async () => {
        const { client, seen } = clientWith(() => ({ result: '0x01' }));
        expect(await gate(client, false)).toBeUndefined();
        expect(seen).toEqual([]);
    });
});
