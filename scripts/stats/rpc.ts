// Plain JSON-RPC and JSON over fetch for the counting script. Solana and
// Stellar nodes are read through this rather than their SDK clients because
// all it needs is "ask these endpoints in order until one answers".

export type RpcCall = (method: string, params: unknown) => Promise<unknown>;

export function jsonRpc(urls: readonly string[], timeoutMs = 25_000): RpcCall {
    return async (method, params) => {
        let last: unknown = new Error('no RPC endpoint configured');
        for (const url of urls) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                    signal: AbortSignal.timeout(timeoutMs),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
                const body = (await res.json()) as {
                    result?: unknown;
                    error?: { code?: number; message?: string };
                };
                if (body.error) {
                    throw new Error(body.error.message ?? `rpc error ${body.error.code}`);
                }
                return body.result;
            } catch (err) {
                last = err;
            }
        }
        throw last;
    };
}

/** GET a JSON document. A 404 is an answer ("not there"), so it reads as null. */
export async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
}

export async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

export const describeError = (err: unknown) =>
    (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200);
