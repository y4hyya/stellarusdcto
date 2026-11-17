import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
    cursorLedger,
    envelopeMinTime,
    eventName,
    parseBurnEvent,
    parseMintEvent,
} from '../../scripts/stats/stellar';
import { minTimeIsTag } from '../../src/lib/attribution/tag';

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
