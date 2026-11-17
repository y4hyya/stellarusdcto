import { describe, expect, test } from 'vitest';
import { MAINNET } from '../registry/index';
import { explorerUrlFor } from './links';

describe('explorer links are built from the registry, never taken from a file', () => {
    const url = explorerUrlFor(MAINNET);

    test('each family follows the form the app itself uses', () => {
        expect(url('base', '0xabc')).toBe('https://basescan.org/tx/0xabc');
        expect(url('solana', 'sig')).toBe('https://explorer.solana.com/tx/sig');
        expect(url('stellar', 'hash')).toBe('https://stellar.expert/explorer/public/tx/hash');
    });

    test('a chain the registry does not know has no link', () => {
        expect(url('gone', '0xabc')).toBe('');
        expect(url('domain 99', '0xabc')).toBe('');
    });

    test('whatever the transaction id says, the link stays on the explorer path', () => {
        expect(url('base', '../../x?y#z')).toBe('https://basescan.org/tx/..%2F..%2Fx%3Fy%23z');
    });
});
