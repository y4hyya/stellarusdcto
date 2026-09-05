import { describe, expect, test } from 'vitest';
import { burnCall } from './cctp';
import type { MintTarget } from '../adapters/types';

const usdc = '0x0000000000000000000000000000000000000001' as const;
const recipient = new Uint8Array(32).fill(7);
const zero = new Uint8Array(32);

describe('burnCall picks the TokenMessengerV2 entry point from the target', () => {
    test('no hook data uses plain depositForBurn with seven arguments', () => {
        const target: MintTarget = {
            mintRecipient: recipient,
            destinationCaller: zero,
            hookData: null,
        };
        const call = burnCall(usdc, 40_000_000n, 3, target, 500n, 2000);
        expect(call.functionName).toBe('depositForBurn');
        expect(call.args).toHaveLength(7);
    });

    test('hook data (a Stellar bound burn) keeps depositForBurnWithHook', () => {
        const hook = new Uint8Array([1, 2, 3]);
        const target: MintTarget = {
            mintRecipient: recipient,
            destinationCaller: recipient,
            hookData: hook,
        };
        const call = burnCall(usdc, 1n, 27, target, 10_000n, 2000);
        expect(call.functionName).toBe('depositForBurnWithHook');
        expect(call.args).toHaveLength(8);
        expect(call.args[7]).toBe('0x010203');
    });
});
