import { rpc } from '@stellar/stellar-sdk';
import { STELLAR } from '$lib/config';

export const stellarRpc = new rpc.Server(STELLAR.rpcUrl, { allowHttp: false });

// ─── plain reads ─────────────────────────────────────────────────────
//
// The SDK decodes every binary field of a reply, whether or not the caller
// wants it. When the network moves to a protocol the bundled SDK does not
// know yet, that decoding throws and takes the whole call down with it, even
// if all the app needed was a number or a status word. (Protocol 30 did this
// to getLatestLedger: the new ledger header broke a call the app only used
// for the ledger number.) So the facts the app reads as plain JSON are
// fetched as plain JSON, and no change to Stellar's binary formats can reach
// them.

const CALL_TIMEOUT_MS = 20_000;

export type StellarRpcCall = (method: string, params?: object) => Promise<Record<string, unknown>>;

/**
 * One JSON-RPC call to the Stellar node, returning the `result` object
 * untouched. A node that cannot be reached, answers with an HTTP error or
 * never answers is reported in the words the error layer already reads as
 * "the node is unreachable".
 */
export async function stellarRpcCall(
    method: string,
    params?: object,
    opts: { url?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
    const send = opts.fetch ?? fetch;
    let response: Response;
    try {
        response = await send(opts.url ?? STELLAR.rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: AbortSignal.timeout(opts.timeoutMs ?? CALL_TIMEOUT_MS),
        });
    } catch (cause) {
        throw new Error(`Stellar RPC ${method}: fetch failed`, { cause });
    }
    if (!response.ok) {
        throw new Error(`Stellar RPC ${method}: fetch failed (HTTP ${response.status})`);
    }

    const body = (await response.json()) as {
        result?: unknown;
        error?: { message?: unknown; code?: unknown };
    };
    if (body.error) {
        throw new Error(
            `Stellar RPC ${method}: ${String(body.error.message ?? body.error.code).slice(0, 200)}`,
        );
    }
    if (typeof body.result !== 'object' || body.result === null) {
        throw new Error(`Stellar RPC ${method}: unexpected reply`);
    }
    return body.result as Record<string, unknown>;
}

/** The number of the latest closed ledger. */
export async function latestLedgerSequence(call: StellarRpcCall = stellarRpcCall): Promise<number> {
    const { sequence } = await call('getLatestLedger');
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence <= 0) {
        throw new Error('Stellar RPC getLatestLedger: unexpected reply (no ledger number)');
    }
    return sequence;
}

export type StellarTxStatus = 'SUCCESS' | 'FAILED' | 'NOT_FOUND';

/** Whether a submitted transaction has been included, and how it went. */
export async function transactionStatus(
    hash: string,
    call: StellarRpcCall = stellarRpcCall,
): Promise<StellarTxStatus> {
    const { status } = await call('getTransaction', { hash });
    if (status === 'SUCCESS' || status === 'FAILED' || status === 'NOT_FOUND') return status;
    throw new Error(`Stellar RPC getTransaction: unexpected status ${String(status).slice(0, 40)}`);
}
