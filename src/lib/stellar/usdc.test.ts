import { describe, expect, test } from 'vitest';
import { Account } from '@stellar/stellar-sdk';
import { STELLAR } from '$lib/config';
import { trustlineTx } from './usdc';

const CALLER = 'GBRFS5SMB55JJHJIHZQEZYBHDPBEM3WGMDUR7WQ6YBVYTOYJXXHAGIJ7';

describe('the trustline setup transaction', () => {
    test('opens the official USDC trustline and nothing else', () => {
        const tx = trustlineTx({ account: new Account(CALLER, '7'), fee: '10000', tagged: false });
        expect(tx.operations).toHaveLength(1);
        const op = tx.operations[0] as unknown as {
            type: string;
            line: { code: string; issuer: string };
        };
        expect(op.type).toBe('changeTrust');
        expect(op.line.code).toBe('USDC');
        expect(op.line.issuer).toBe(STELLAR.usdc.issuer);
        expect(tx.memo.type).toBe('none');
    });

    test('untagged it has no lower time bound and the usual timeout', () => {
        const tx = trustlineTx({ account: new Account(CALLER, '7'), fee: '10000', tagged: false });
        expect(tx.timeBounds?.minTime).toBe('0');
        const now = Date.now() / 1000;
        expect(Number(tx.timeBounds?.maxTime)).toBeGreaterThan(now + 170);
        expect(Number(tx.timeBounds?.maxTime)).toBeLessThanOrEqual(now + 181);
    });

    test('tagged it carries the tag as its lower time bound', () => {
        const tx = trustlineTx({ account: new Account(CALLER, '7'), fee: '10000', tagged: true });
        expect(tx.timeBounds?.minTime).toBe('1752133747');
    });
});
