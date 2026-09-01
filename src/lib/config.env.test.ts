import { afterEach, describe, expect, test, vi } from 'vitest';

// The compat layer must follow the persisted environment choice, because the
// engine and every EVM module resolve chains through it. Pinning it to one
// env once sent a mainnet mint to a testnet contract on Sepolia.

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

async function loadConfigWithEnv(env: string | null) {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => (key === 'stellarusdcto.env' ? env : null),
        setItem: () => {},
    });
    return await import('./config');
}

describe('config follows the active environment', () => {
    test('mainnet: EVM chains resolve to the mainnet roster', async () => {
        const config = await loadConfigWithEnv('mainnet');
        expect(config.EVM_CHAINS['ethereum'].chain.id).toBe(1);
        expect(config.EVM_CHAINS['ethereum'].tokenMessenger).toBe(
            '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
        );
        expect(config.EVM_CHAINS['ethereum'].messageTransmitter).toBe(
            '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
        );
        expect(config.IRIS_API).toBe('https://iris-api.circle.com');
    });

    test('mainnet: EDGE keeps its own contract pair', async () => {
        const config = await loadConfigWithEnv('mainnet');
        expect(config.EVM_CHAINS['edge'].tokenMessenger).toBe(
            '0x98706A006bc632Df31CAdFCBD43F38887ce2ca5c',
        );
        expect(config.EVM_CHAINS['edge'].messageTransmitter).toBe(
            '0x5b61381Fc9e58E70EfC13a4A97516997019198ee',
        );
    });

    test('no stored choice: EVM chains resolve to the testnet roster', async () => {
        const config = await loadConfigWithEnv(null);
        expect(config.EVM_CHAINS['ethereum'].chain.id).toBe(11155111);
        expect(config.EVM_CHAINS['ethereum'].messageTransmitter).toBe(
            '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
        );
        expect(config.IRIS_API).toBe('https://iris-api-sandbox.circle.com');
    });
});
