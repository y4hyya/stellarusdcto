import { TransferError } from './errors/codes';

// Canonical USDC amounts are 6 decimal integer units, matching the CCTP wire
// format on every chain. Stellar renders USDC with 7 decimals, so its subunit
// values are exactly these units times ten; the extra digit must never carry
// value or the displayed amount and the delivered amount drift apart.

export const USDC_DECIMALS = 6;

const AMOUNT_RE = /^(\d+)(?:\.(\d+))?$/;

export function parseUsdc(input: string): bigint {
    const trimmed = input.trim();
    const match = AMOUNT_RE.exec(trimmed);
    if (!match) throw new TransferError('AMOUNT_INVALID', { raw: input });
    const [, whole, fraction = ''] = match;
    if (fraction.length > USDC_DECIMALS) {
        throw new TransferError('AMOUNT_TOO_MANY_DECIMALS', { raw: input });
    }
    const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(USDC_DECIMALS, '0'));
    if (units <= 0n) throw new TransferError('AMOUNT_INVALID', { raw: input });
    return units;
}

export function formatUsdc(units6: bigint): string {
    const whole = units6 / 1_000_000n;
    const fraction = (units6 % 1_000_000n).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function toStellarSubunits(units6: bigint): bigint {
    return units6 * 10n;
}

export function fromStellarSubunits(subunits7: bigint): bigint {
    if (subunits7 % 10n !== 0n) {
        throw new TransferError('AMOUNT_TOO_MANY_DECIMALS', { raw: subunits7.toString() });
    }
    return subunits7 / 10n;
}
