import { TransferError } from './codes';

export type TranslateContext = {
    family?: 'evm' | 'solana' | 'stellar';
    phase?: string;
};

// Order matters: the first matching rule wins. Patterns come from failures
// observed in the wild (wallet rejections, Soroban host errors, EVM reverts,
// Solana program errors, Circle API responses); anything unmatched stays
// UNKNOWN with the raw error preserved for the details view.

function messageOf(raw: unknown): string {
    if (raw instanceof Error) return raw.message;
    if (typeof raw === 'string') return raw;
    try {
        return JSON.stringify(raw);
    } catch {
        return String(raw);
    }
}

const REJECTION_PATTERNS = [
    'user rejected',
    'user declined',
    'rejected by user',
    'request rejected',
    'user cancelled',
    'user canceled',
];

export function translateError(raw: unknown, ctx: TranslateContext): TransferError {
    if (raw instanceof TransferError) return raw;

    const msg = messageOf(raw);
    const lower = msg.toLowerCase();
    const name = raw instanceof Error ? raw.name : '';

    if (name === 'UserRejectedRequestError' || REJECTION_PATTERNS.some((p) => lower.includes(p))) {
        return new TransferError('USER_REJECTED', { raw });
    }

    if (
        lower.includes('nonce already used') ||
        msg.includes('Error(Contract, #6908)') ||
        msg.includes('"Custom":6023')
    ) {
        return new TransferError('ALREADY_MINTED', { raw });
    }

    if (ctx.family === 'stellar') {
        if (msg.includes('Error(Contract, #9)')) {
            return new TransferError('ALLOWANCE_EXPIRED', { raw });
        }
        if (msg.includes('Error(Contract, #7105)')) {
            return new TransferError('MAX_FEE_TOO_LOW', { raw });
        }
        if (lower.includes('account not found')) {
            return new TransferError('ACCOUNT_NOT_FOUND', { raw });
        }
    }

    if (lower.includes('iris 429') || lower.includes('fee api 429')) {
        return new TransferError('IRIS_RATE_LIMITED', { raw });
    }

    if (
        lower.includes('failed to fetch') ||
        lower.includes('fetch failed') ||
        lower.includes('load failed')
    ) {
        return new TransferError('RPC_UNREACHABLE', { raw });
    }

    return new TransferError('UNKNOWN', { raw });
}
