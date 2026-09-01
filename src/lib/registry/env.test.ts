import { describe, expect, test } from 'vitest';
import { resolveEnv } from './index';

// The environment is decided by the domain in production: the main site can
// only ever serve mainnet, the testnet site only testnet, and no stored
// toggle can flip either. Local development keeps the stored choice.
describe('resolveEnv', () => {
    test('the testnet domain pins testnet, whatever was stored', () => {
        expect(resolveEnv('stellarusdcto-testnet.vercel.app', null)).toBe('testnet');
        expect(resolveEnv('stellarusdcto-testnet.vercel.app', 'mainnet')).toBe('testnet');
        // Preview deployments of the testnet project.
        expect(resolveEnv('stellarusdcto-testnet-abc12-someteam.vercel.app', 'mainnet')).toBe(
            'testnet',
        );
        // A future custom domain keeps working by prefix.
        expect(resolveEnv('testnet.stellarusdcto.com', 'mainnet')).toBe('testnet');
    });

    test('every other public domain pins mainnet, whatever was stored', () => {
        expect(resolveEnv('stellarusdcto.vercel.app', 'testnet')).toBe('mainnet');
        expect(resolveEnv('stellarusdcto.com', 'testnet')).toBe('mainnet');
        // Preview deployments of the main project.
        expect(resolveEnv('stellarusdcto-1hqpo54nt-someteam.vercel.app', 'testnet')).toBe(
            'mainnet',
        );
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
