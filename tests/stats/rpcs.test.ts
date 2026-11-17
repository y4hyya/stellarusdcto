import { describe, expect, test } from 'vitest';
import { scanRpcUrls, scanSpan } from '../../scripts/stats/rpcs';

describe('which RPCs a chain is scanned through', () => {
    test('a chain with no entry uses its registry default only', () => {
        expect(scanRpcUrls('sei', ['https://default.example'])).toEqual([
            'https://default.example',
        ]);
    });

    test('a preferred endpoint goes before the default, a spare one after', () => {
        const base = scanRpcUrls('base', ['https://mainnet.base.org']);
        expect(base[0]).toBe('https://base-rpc.publicnode.com');
        expect(base[base.length - 1]).toBe('https://mainnet.base.org');

        const ethereum = scanRpcUrls('ethereum', ['https://eth.merkle.io']);
        expect(ethereum[0]).toBe('https://eth.merkle.io');
        expect(ethereum).toContain('https://ethereum-rpc.publicnode.com');
    });

    test('the default always stays in the list as a last resort', () => {
        for (const chain of ['base', 'hyperevm', 'xdc', 'op', 'monad']) {
            expect(scanRpcUrls(chain, ['https://default.example'])).toContain(
                'https://default.example',
            );
        }
    });

    test('an endpoint listed twice is tried once', () => {
        const urls = scanRpcUrls('base', [
            'https://base-rpc.publicnode.com',
            'https://mainnet.base.org',
        ]);
        expect(urls).toEqual(['https://base-rpc.publicnode.com', 'https://mainnet.base.org']);
    });
});

describe('how wide a first log query is', () => {
    test('most chains have no override', () => {
        expect(scanSpan('base')).toBeUndefined();
        expect(scanSpan('sei')).toBeUndefined();
    });

    test('a chain whose fast endpoint is narrow starts at that width', () => {
        // Otherwise every too wide query would fall through to the slow default.
        expect(scanSpan('xdc')).toBe(500n);
    });
});
