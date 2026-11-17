import { describe, expect, test } from 'vitest';
import { SITE_URLS, resolveEnv } from './index';

// The environment is decided by the domain in production: the main site can
// only ever serve mainnet, the testnet site only testnet, and no stored
// toggle can flip either. Local development keeps the stored choice.
describe('resolveEnv', () => {
    test('a testnet. address pins testnet, whatever was stored', () => {
        expect(resolveEnv('testnet.stablehops.com', null)).toBe('testnet');
        expect(resolveEnv('testnet.stablehops.com', 'mainnet')).toBe('testnet');
        expect(resolveEnv('TESTNET.StableHops.com', 'mainnet')).toBe('testnet');
        // Anyone hosting a copy gets the same rule on their own domain.
        expect(resolveEnv('testnet.example.org', 'mainnet')).toBe('testnet');
    });

    test('every other public domain pins mainnet, whatever was stored', () => {
        expect(resolveEnv('stablehops.com', 'testnet')).toBe('mainnet');
        expect(resolveEnv('www.stablehops.com', 'testnet')).toBe('mainnet');
        // The address a host hands out before a domain is attached.
        expect(resolveEnv('nice-rock-0a1b2c3d4.5.azurestaticapps.net', 'testnet')).toBe('mainnet');
        // The word has to be the first label; a name that only contains it
        // is not the testnet site.
        expect(resolveEnv('stellarusdcto-testnet.example.org', 'testnet')).toBe('mainnet');
        expect(resolveEnv('my-testnet.example.org', 'testnet')).toBe('mainnet');
    });

    test('local development follows the stored choice, defaulting to testnet', () => {
        expect(resolveEnv('localhost', null)).toBe('testnet');
        expect(resolveEnv('localhost', 'mainnet')).toBe('mainnet');
        expect(resolveEnv('127.0.0.1', 'mainnet')).toBe('mainnet');
        expect(resolveEnv(undefined, 'mainnet')).toBe('mainnet');
        expect(resolveEnv(undefined, null)).toBe('testnet');
        expect(resolveEnv(undefined, 'garbage')).toBe('testnet');
    });
});

describe('the links between the two sites', () => {
    test('point at the official addresses', () => {
        expect(SITE_URLS).toEqual({
            mainnet: 'https://stablehops.com',
            testnet: 'https://testnet.stablehops.com',
        });
    });

    test('each link lands on a site that serves the network it names', () => {
        // If a link and the hostname rule ever disagreed, the "Testnet" link
        // would open a page that moves real money.
        for (const env of ['mainnet', 'testnet'] as const) {
            const other = env === 'mainnet' ? 'testnet' : 'mainnet';
            expect(resolveEnv(new URL(SITE_URLS[env]).hostname, other)).toBe(env);
        }
    });
});
