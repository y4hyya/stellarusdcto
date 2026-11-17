import { describe, expect, test } from 'vitest';
import {
    EVM_TAG_SUFFIX,
    STELLAR_TAG_MIN_TIME,
    TAG,
    TAGGED_HOSTS,
    encodeEvmSuffix,
    inputHasTag,
    isTagHost,
    memoHasTag,
    minTimeIsTag,
    tagEnabled,
} from './tag';
import { SITE_URLS } from '../registry/index';

describe('the EVM suffix follows the ERC-8021 schema 0 layout', () => {
    test('encodes the spec vector', () => {
        // The vector published with the standard: code "baseapp".
        expect(encodeEvmSuffix(['baseapp'])).toBe(
            '0x62617365617070070080218021802180218021802180218021',
        );
    });

    test('the stablehops suffix is 28 bytes and ends with the marker', () => {
        expect(TAG).toBe('stablehops');
        expect(EVM_TAG_SUFFIX).toBe('0x737461626c65686f70730a0080218021802180218021802180218021');
        expect((EVM_TAG_SUFFIX.length - 2) / 2).toBe(28);
    });

    test('several codes are comma delimited and counted in the length byte', () => {
        // "a,b" is 3 bytes: 61 2c 62.
        expect(encodeEvmSuffix(['a', 'b'])).toBe('0x612c62030080218021802180218021802180218021');
    });

    test('rejects codes that are not 7 bit ascii, contain a comma, or are empty', () => {
        expect(() => encodeEvmSuffix(['a,b'])).toThrow();
        expect(() => encodeEvmSuffix(['né'])).toThrow();
        expect(() => encodeEvmSuffix([''])).toThrow();
        expect(() => encodeEvmSuffix([])).toThrow();
        expect(() => encodeEvmSuffix(['x'.repeat(256)])).toThrow();
    });
});

describe('where the tag is switched on', () => {
    test('only listed hosts tag, in any letter case', () => {
        expect(TAGGED_HOSTS).toEqual(['testnet.stablehops.com']);
        expect(isTagHost('testnet.stablehops.com', null)).toBe(true);
        expect(isTagHost('TESTNET.StableHops.com', null)).toBe(true);
        expect(isTagHost('stablehops.com', null)).toBe(false);
    });

    test('every listed host is one of the official sites', () => {
        // A typo here, or a site that moved without this list following,
        // would silently send every transfer out untagged and uncounted.
        const official = Object.values(SITE_URLS).map((url) => new URL(url).hostname);
        for (const host of TAGGED_HOSTS) expect(official).toContain(host);
    });

    test('previews and forks never tag, even with the dev flag', () => {
        expect(isTagHost('nice-rock-0a1b2c3d4.5.azurestaticapps.net', 'on')).toBe(false);
        expect(isTagHost('www.stablehops.com', 'on')).toBe(false);
        expect(isTagHost('example.com', 'on')).toBe(false);
        expect(isTagHost('testnet.stablehops.com.evil.example', null)).toBe(false);
    });

    test('localhost tags only with the dev flag', () => {
        expect(isTagHost('localhost', null)).toBe(false);
        expect(isTagHost('localhost', 'off')).toBe(false);
        expect(isTagHost('localhost', 'on')).toBe(true);
        expect(isTagHost('127.0.0.1', 'on')).toBe(true);
    });

    test('no hostname means no tag', () => {
        expect(isTagHost(undefined, 'on')).toBe(false);
        // Under node there is no location at all.
        expect(tagEnabled()).toBe(false);
    });
});

describe('recognising the tag afterwards', () => {
    const bare = EVM_TAG_SUFFIX.slice(2);

    test('finds the suffix at the tail of an input', () => {
        expect(inputHasTag('0xdeadbeef' + bare)).toBe(true);
    });

    test('finds the suffix embedded in a batched input', () => {
        expect(inputHasTag('0xdeadbeef' + bare + '00'.repeat(40))).toBe(true);
    });

    test('ignores letter case', () => {
        expect(inputHasTag('0xDEADBEEF' + bare.toUpperCase())).toBe(true);
    });

    test('an untagged or empty input does not match', () => {
        expect(inputHasTag('0xdeadbeef')).toBe(false);
        expect(inputHasTag('0x')).toBe(false);
        expect(inputHasTag('')).toBe(false);
    });

    test('a different suffix can be searched for', () => {
        const other = encodeEvmSuffix(['baseapp']);
        expect(inputHasTag('0xdeadbeef' + other.slice(2), other)).toBe(true);
        expect(inputHasTag('0xdeadbeef' + bare, other)).toBe(false);
    });

    test('memo matching reads the RPC memo format', () => {
        expect(memoHasTag('[10] stablehops')).toBe(true);
        expect(memoHasTag('[5] hello; [10] stablehops')).toBe(true);
        expect(memoHasTag('[9] stablehop')).toBe(false);
        expect(memoHasTag(null)).toBe(false);
        expect(memoHasTag(undefined)).toBe(false);
    });

    test('min time matching accepts the forms RPCs return', () => {
        expect(STELLAR_TAG_MIN_TIME).toBe(1752133747);
        // The four bytes spell "hops".
        expect(STELLAR_TAG_MIN_TIME.toString(16)).toBe('686f7073');
        expect(minTimeIsTag('1752133747')).toBe(true);
        expect(minTimeIsTag(1752133747)).toBe(true);
        expect(minTimeIsTag(1752133747n)).toBe(true);
        expect(minTimeIsTag('0')).toBe(false);
        expect(minTimeIsTag('1234567890')).toBe(false);
        expect(minTimeIsTag(null)).toBe(false);
        expect(minTimeIsTag(undefined)).toBe(false);
        expect(minTimeIsTag('not a number')).toBe(false);
    });
});
