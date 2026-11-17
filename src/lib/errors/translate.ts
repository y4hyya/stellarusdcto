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

    // Arbitrum style sequencers refuse a transaction whose fee cap is under
    // the base fee of the block that would include it; mempool chains report
    // the same underbid as "underpriced". A replacement that is underpriced
    // is a different problem (nonce reuse) and stays unmatched.
    if (
        lower.includes('less than block base fee') ||
        lower.includes('max fee per gas less than') ||
        (lower.includes('underpriced') && !lower.includes('replacement'))
    ) {
        return new TransferError('GAS_BID_TOO_LOW', { raw });
    }

    // A wallet that cannot estimate a transaction guesses a gas limit instead
    // (MetaMask takes 35% of the block gas limit), and the node refuses one
    // above its per transaction cap (EIP 7825: 16,777,216) or the block limit
    // at submission, before anything is sent.
    if (
        lower.includes('gas limit too high') ||
        lower.includes('gas limit cap exceeded') ||
        lower.includes('exceeds block gas limit')
    ) {
        return new TransferError('GAS_LIMIT_REFUSED', { raw });
    }

    // The Stellar library could not decode a reply: the network has moved to
    // a protocol newer than the library this build ships. Every such decode
    // happens before a transaction is accepted, so nothing was sent.
    if (msg.includes('XDR Read Error')) {
        return new TransferError('NETWORK_AHEAD_OF_APP', { raw });
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
