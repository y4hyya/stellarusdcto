import { describe, expect, test } from 'vitest';
import { scanRpcUrls } from '../../scripts/stats/rpcs';

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

        const xdc = scanRpcUrls('xdc', ['https://rpc.xdcrpc.com']);
        expect(xdc[0]).toBe('https://rpc.xdcrpc.com');
        expect(xdc).toContain('https://rpc.ankr.com/xdc');
    });

    test('an endpoint listed twice is tried once', () => {
        const urls = scanRpcUrls('base', [
            'https://base-rpc.publicnode.com',
            'https://mainnet.base.org',
        ]);
        expect(urls).toEqual(['https://base-rpc.publicnode.com', 'https://mainnet.base.org']);
    });
});
