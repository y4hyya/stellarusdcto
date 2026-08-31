import { describe, expect, test } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { getStellarAdapter, getChainAdapter } from './index';
import { stellarConfig, getChain } from '../registry';
import { TransferError } from '../errors/codes';

// These tests pin the fund safety invariant. A Stellar bound burn whose
// mintRecipient or destinationCaller is anything but the CctpForwarder, or
// whose recipient is not carried in hook data, permanently strands the USDC.
// Circle's docs say so three times, and both forwarder contracts hold
// orphaned USDC from tools that got this wrong.

const G_RECIPIENT = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describe('stellar mint target (inbound burns)', () => {
    test('both 32 byte slots are exactly the forwarder contract, never the recipient', async () => {
        const target = await getStellarAdapter().mintTarget(G_RECIPIENT);
        const forwarderRaw = new Uint8Array(
            StrKey.decodeContract(stellarConfig().contracts.cctpForwarder),
        );
        expect(target.mintRecipient).toEqual(forwarderRaw);
        expect(target.destinationCaller).toEqual(forwarderRaw);
        expect(target.mintRecipient).not.toEqual(
            new Uint8Array(StrKey.decodeEd25519PublicKey(G_RECIPIENT)),
        );
    });

    test('hook data carries the recipient strkey in the documented layout', async () => {
        const target = await getStellarAdapter().mintTarget(G_RECIPIENT);
        const hook = target.hookData;
        expect(hook).not.toBeNull();
        if (!hook) return;
        // bytes 0..23 magic zeros, 24..27 version 0, 28..31 big endian length,
        // then the strkey as UTF-8 text (not decoded bytes).
        expect(Array.from(hook.slice(0, 24))).toEqual(new Array(24).fill(0));
        expect(Array.from(hook.slice(24, 28))).toEqual([0, 0, 0, 0]);
        const length = (hook[28] << 24) | (hook[29] << 16) | (hook[30] << 8) | hook[31];
        expect(length).toBe(G_RECIPIENT.length);
        expect(new TextDecoder().decode(hook.slice(32))).toBe(G_RECIPIENT);
    });

    test('rejects anything that is not a Stellar account today', async () => {
        for (const bad of ['not an address', '0x1111111111111111111111111111111111111111', '']) {
            await expect(getStellarAdapter().mintTarget(bad)).rejects.toMatchObject({
                code: 'RECIPIENT_INVALID',
            });
        }
    });
});

describe('evm mint target (outbound burns toward an EVM chain)', () => {
    test('left pads the recipient address and keeps the caller open for rescue', async () => {
        const adapter = getChainAdapter(getChain('base'));
        const target = await adapter.mintTarget('0x1111111111111111111111111111111111111111');
        expect(target.mintRecipient.length).toBe(32);
        expect(Array.from(target.mintRecipient.slice(0, 12))).toEqual(new Array(12).fill(0));
        expect(Array.from(target.mintRecipient.slice(12))).toEqual(new Array(20).fill(0x11));
        // destinationCaller zero keeps the mint permissionless, so anyone can
        // complete the transfer later. Never restrict it.
        expect(Array.from(target.destinationCaller)).toEqual(new Array(32).fill(0));
        expect(target.hookData).toBeNull();
    });

    test('rejects a non EVM recipient', async () => {
        const adapter = getChainAdapter(getChain('base'));
        await expect(adapter.mintTarget(G_RECIPIENT)).rejects.toMatchObject({
            code: 'RECIPIENT_INVALID',
        });
    });
});

describe('solana mint target (outbound burns toward Solana)', () => {
    test('targets the USDC token account, not the wallet, with an open caller', async () => {
        const adapter = getChainAdapter(getChain('solana'));
        const owner = 'Do7yE22WcpDBhVmHHQKuinGbe9N2RANRvoLPFJYkGyWt';
        const target = await adapter.mintTarget(owner);
        expect(target.mintRecipient.length).toBe(32);
        // The classic mistake is naming the wallet. The mint delivers to a
        // token account, which never equals the owner key.
        expect(target.mintRecipient).not.toEqual(base58Decode32(owner));
        expect(Array.from(target.destinationCaller)).toEqual(new Array(32).fill(0));
        expect(target.hookData).toBeNull();
    });

    test('rejects a non Solana recipient', async () => {
        const adapter = getChainAdapter(getChain('solana'));
        await expect(
            adapter.mintTarget('0x1111111111111111111111111111111111111111'),
        ).rejects.toMatchObject({ code: 'RECIPIENT_INVALID' });
    });
});

test('getChainAdapter refuses unknown families safely', () => {
    expect(() => getChainAdapter({ family: 'move' } as never)).toThrowError(TransferError);
});

function base58Decode32(value: string): Uint8Array {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let acc = 0n;
    for (const ch of value) {
        const idx = ALPHABET.indexOf(ch);
        if (idx === -1) throw new Error('bad base58');
        acc = acc * 58n + BigInt(idx);
    }
    const out = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) {
        out[i] = Number(acc & 0xffn);
        acc >>= 8n;
    }
    return out;
}
