import { describe, expect, test } from 'vitest';
import { TransferError } from '../errors/codes';
import { TESTNET, MAINNET } from './index';
import { getChain, chainByDomain } from './index';
import type { Registry } from './types';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ID = /^G[A-Z2-7]{55}$/;

function eachRegistry(fn: (r: Registry) => void) {
    for (const r of [TESTNET, MAINNET]) fn(r);
}

describe('registry data', () => {
    test('chain ids and domains are unique within an environment', () => {
        eachRegistry((r) => {
            const ids = r.chains.map((c) => c.id);
            const domains = r.chains.map((c) => c.domain);
            expect(new Set(ids).size, r.env).toBe(ids.length);
            expect(new Set(domains).size, r.env).toBe(domains.length);
        });
    });

    test('stellar is domain 27 and never appears in the counterparty list', () => {
        eachRegistry((r) => {
            expect(r.stellar.domain).toBe(27);
            expect(
                r.chains.some((c) => c.domain === 27),
                r.env,
            ).toBe(false);
        });
    });

    test('the USYC only BNB domain is excluded everywhere', () => {
        eachRegistry((r) => {
            expect(
                r.chains.some((c) => c.domain === 17),
                r.env,
            ).toBe(false);
        });
    });

    test('addresses have the right shape for their chain', () => {
        eachRegistry((r) => {
            for (const c of r.chains) {
                if (c.family === 'evm') {
                    expect(c.usdc, `${r.env} ${c.id} usdc`).toMatch(EVM_ADDRESS);
                    expect(c.tokenMessenger, `${r.env} ${c.id}`).toMatch(EVM_ADDRESS);
                    expect(c.messageTransmitter, `${r.env} ${c.id}`).toMatch(EVM_ADDRESS);
                }
            }
            for (const id of Object.values(r.stellar.contracts)) {
                expect(id, r.env).toMatch(CONTRACT_ID);
            }
            expect(r.stellar.usdc.issuer, r.env).toMatch(ACCOUNT_ID);
        });
    });

    test('every testnet EVM chain uses the testnet contract pair, mainnet the mainnet pair', () => {
        for (const c of TESTNET.chains) {
            if (c.family !== 'evm') continue;
            expect(c.tokenMessenger).toBe('0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA');
            expect(c.messageTransmitter).toBe('0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275');
        }
        for (const c of MAINNET.chains) {
            if (c.family !== 'evm') continue;
            expect(c.tokenMessenger).toBe('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d');
            expect(c.messageTransmitter).toBe('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64');
        }
    });

    test('iris hosts never cross environments', () => {
        expect(TESTNET.irisBase).toBe('https://iris-api-sandbox.circle.com');
        expect(MAINNET.irisBase).toBe('https://iris-api.circle.com');
    });

    test('arc stays out of mainnet until circle publishes its parameters', () => {
        expect(MAINNET.chains.some((c) => c.id === 'arc')).toBe(false);
        expect(TESTNET.chains.some((c) => c.id === 'arc')).toBe(true);
    });

    test('the default chain exists in its environment', () => {
        eachRegistry((r) => {
            expect(
                r.chains.some((c) => c.id === r.defaultChainId),
                r.env,
            ).toBe(true);
        });
    });

    test('every chain carries a hex accent color for its badge', () => {
        eachRegistry((r) => {
            for (const c of r.chains) {
                expect(c.accent, `${r.env} ${c.id}`).toMatch(/^#[0-9a-fA-F]{6}$/);
            }
        });
    });

    test('every environment has at least one stellar RPC and a horizon URL', () => {
        eachRegistry((r) => {
            expect(r.stellar.rpcUrls.length, r.env).toBeGreaterThan(0);
            expect(r.stellar.horizonUrl, r.env).toMatch(/^https:\/\//);
        });
    });
});

describe('registry accessors', () => {
    test('getChain returns a chain from the active environment', () => {
        expect(getChain('base').family).toBe('evm');
        expect(getChain('solana').family).toBe('solana');
    });

    test('getChain throws a typed error for an unknown id', () => {
        try {
            getChain('dogechain');
            throw new Error('should have thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(TransferError);
            expect((e as TransferError).code).toBe('CONFIG_MISSING');
        }
    });

    test('chainByDomain resolves counterparties and stellar itself', () => {
        const base = chainByDomain(6);
        expect(typeof base === 'object' && base.id).toBe('base');
        expect(chainByDomain(27)).toBe('stellar');
        expect(chainByDomain(999)).toBeUndefined();
    });
});
