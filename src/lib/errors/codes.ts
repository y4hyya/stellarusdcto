// Every failure a user can hit maps to one of these codes. The catalog below
// is the single source of user facing failure copy: plain language, one
// concrete next step, and whether retrying the same action can ever help.

export type TransferErrorCode =
    | 'USER_REJECTED'
    | 'WRONG_NETWORK'
    | 'INSUFFICIENT_USDC'
    | 'INSUFFICIENT_GAS'
    | 'NO_TRUSTLINE'
    | 'TRUSTLINE_FULL'
    | 'TRUSTLINE_FROZEN'
    | 'ACCOUNT_NOT_FOUND'
    | 'ALLOWANCE_EXPIRED'
    | 'ALREADY_MINTED'
    | 'ATTESTATION_PENDING'
    | 'RPC_UNREACHABLE'
    | 'IRIS_RATE_LIMITED'
    | 'MAX_FEE_TOO_LOW'
    | 'AMOUNT_INVALID'
    | 'AMOUNT_TOO_MANY_DECIMALS'
    | 'RECIPIENT_INVALID'
    | 'HASH_INVALID'
    | 'WALLET_REQUIRED'
    | 'CONFIG_MISSING'
    | 'UNKNOWN';

type CatalogEntry = { userMessage: string; action: string; retryable: boolean };

export const MESSAGES: Record<TransferErrorCode, CatalogEntry> = {
    USER_REJECTED: {
        userMessage: 'The request was declined in your wallet.',
        action: 'Try again and approve the wallet prompt when it appears.',
        retryable: true,
    },
    WRONG_NETWORK: {
        userMessage: 'Your wallet is on a different network than this transfer needs.',
        action: 'Switch the network in your wallet, then try again.',
        retryable: true,
    },
    INSUFFICIENT_USDC: {
        userMessage: 'There is not enough USDC in the source wallet for this amount.',
        action: 'Lower the amount or top up the wallet, then try again.',
        retryable: true,
    },
    INSUFFICIENT_GAS: {
        userMessage:
            'The wallet does not have enough of the network fee token to pay for this transaction.',
        action: 'Add a small amount of the fee token shown next to the chain, then try again.',
        retryable: true,
    },
    NO_TRUSTLINE: {
        userMessage:
            'The receiving Stellar account cannot hold USDC yet, it has no USDC trustline.',
        action: 'Add the USDC trustline in the recipient wallet, then retry. Nothing is lost, the transfer stays completable.',
        retryable: true,
    },
    TRUSTLINE_FULL: {
        userMessage: 'The receiving trustline does not have room for this amount.',
        action: 'Raise the trustline limit or free up room, then retry the mint.',
        retryable: true,
    },
    TRUSTLINE_FROZEN: {
        userMessage: 'The USDC trustline on the receiving account was frozen by the issuer.',
        action: 'This account cannot receive USDC right now. Contact Circle support, or use a different recipient account.',
        retryable: false,
    },
    ACCOUNT_NOT_FOUND: {
        userMessage: 'This Stellar account does not exist on the network yet.',
        action: 'Fund the account with XLM first (any wallet or exchange can send XLM to create it), then try again.',
        retryable: true,
    },
    ALLOWANCE_EXPIRED: {
        userMessage: 'The USDC spending approval expired before the burn ran.',
        action: 'Approve again and complete the burn right after.',
        retryable: true,
    },
    ALREADY_MINTED: {
        userMessage: 'This transfer was already completed on the destination.',
        action: 'Check the destination balance, the USDC should already be there.',
        retryable: false,
    },
    ATTESTATION_PENDING: {
        userMessage: 'Circle is still attesting the burn. Your funds are safe and nothing is lost.',
        action: 'Keep this page open, or save the burn hash and finish any time from the resume box.',
        retryable: true,
    },
    RPC_UNREACHABLE: {
        userMessage: 'A network endpoint did not respond.',
        action: 'Check your connection and try again in a moment.',
        retryable: true,
    },
    IRIS_RATE_LIMITED: {
        userMessage: 'Circle temporarily rate limited status checks from this connection.',
        action: 'Wait about five minutes, then try again. The transfer itself is unaffected.',
        retryable: true,
    },
    MAX_FEE_TOO_LOW: {
        userMessage:
            'The fee ceiling for this transfer is below what the route currently requires.',
        action: 'Retry so a fresh fee quote is used.',
        retryable: true,
    },
    AMOUNT_INVALID: {
        userMessage: 'That amount could not be read as a positive USDC value.',
        action: 'Enter a plain number like 25 or 12.50.',
        retryable: true,
    },
    AMOUNT_TOO_MANY_DECIMALS: {
        userMessage:
            'USDC transfers carry at most 6 decimal places, a 7th digit would be left behind.',
        action: 'Round the amount to 6 decimals.',
        retryable: true,
    },
    RECIPIENT_INVALID: {
        userMessage: 'The recipient address is not valid for the destination chain.',
        action: 'Paste the full address again and check the chain it belongs to.',
        retryable: true,
    },
    HASH_INVALID: {
        userMessage: 'That does not look like a transaction hash from a supported chain.',
        action: 'Paste the burn transaction hash exactly as the explorer shows it.',
        retryable: true,
    },
    WALLET_REQUIRED: {
        userMessage: 'The wallet needed for this step is not connected.',
        action: 'Connect the highlighted wallet, then retry.',
        retryable: true,
    },
    CONFIG_MISSING: {
        userMessage: 'This route is not configured in this build.',
        action: 'Pick a different chain, or report this so the route can be added.',
        retryable: false,
    },
    UNKNOWN: {
        userMessage: 'Something failed in a way this app did not recognize.',
        action: 'The technical details below may help. Retrying is usually safe, burns never get lost.',
        retryable: true,
    },
};

export class TransferError extends Error {
    readonly code: TransferErrorCode;
    readonly userMessage: string;
    readonly action: string;
    readonly retryable: boolean;
    readonly raw?: unknown;

    constructor(
        code: TransferErrorCode,
        opts: { userMessage?: string; action?: string; retryable?: boolean; raw?: unknown } = {},
    ) {
        const entry = MESSAGES[code];
        super(opts.userMessage ?? entry.userMessage);
        this.name = 'TransferError';
        this.code = code;
        this.userMessage = opts.userMessage ?? entry.userMessage;
        this.action = opts.action ?? entry.action;
        this.retryable = opts.retryable ?? entry.retryable;
        this.raw = opts.raw;
    }
}
