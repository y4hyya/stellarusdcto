import { BaseError, concat, type Hex, type PublicClient } from 'viem';
import { EVM_TAG_SUFFIX, tagEnabled } from '../attribution/tag';

// ─────────────────────────────────────────────────────────────────────
//  The usage tag on EVM calls
// ─────────────────────────────────────────────────────────────────────
//
// The tag is a few bytes after the encoded arguments. Solidity ignores
// trailing call data, and Circle's contracts were checked to do so on
// mainnet, but "checked once" is not good enough next to a burn. So before
// every tagged call the same call is simulated twice from the user's own
// address, with and without the suffix, and the suffix is only used when the
// two outcomes are identical. A chain, proxy or future upgrade that treated
// the extra bytes differently would show up here as a difference, and the
// transfer would simply go out untagged, exactly as it did before the tag
// existed.

type Outcome = string | null;

/**
 * Revert data from a failed simulation, or undefined when there is none.
 * Mirrors how viem itself digs it out: the innermost error carries `data`,
 * either as the hex string or wrapped one level deeper.
 */
function revertData(err: unknown): Hex | undefined {
    if (!(err instanceof BaseError)) return undefined;
    const root = err.walk() as { data?: unknown } | undefined;
    const raw =
        typeof root?.data === 'object' && root.data !== null
            ? (root.data as { data?: unknown }).data
            : root?.data;
    return typeof raw === 'string' && /^0x[0-9a-fA-F]+$/.test(raw) && raw.length > 2
        ? (raw as Hex)
        : undefined;
}

async function simulate(
    client: { call: PublicClient['call'] },
    request: { account: `0x${string}`; to: `0x${string}`; data: Hex },
): Promise<Outcome> {
    try {
        const { data } = await client.call(request);
        return `ok:${data ?? '0x'}`;
    } catch (err) {
        // A revert only counts as an outcome when the node says why. Without
        // revert data two failures cannot be told apart, and a transport
        // failure is no outcome at all.
        const data = revertData(err);
        return data ? `revert:${data.toLowerCase()}` : null;
    }
}

// The check runs right before the wallet opens, so it gets a short budget. A
// slow or silent RPC must cost the user a few seconds at most, never the
// transfer: when the budget runs out the call goes out untagged.
const GATE_TIMEOUT_MS = 4_000;

/**
 * The suffix to append to this call, or undefined to send it untagged.
 * `enabled`, `suffix` and `timeoutMs` exist for tests and read only checks;
 * everywhere else the hostname decides and the suffix is the tag.
 */
export async function evmTagSuffix(args: {
    client: { call: PublicClient['call'] };
    account: `0x${string}`;
    to: `0x${string}`;
    data: Hex;
    enabled?: boolean;
    suffix?: Hex;
    timeoutMs?: number;
}): Promise<Hex | undefined> {
    if (!(args.enabled ?? tagEnabled())) return undefined;
    const { client, account, to, data } = args;
    const suffix = args.suffix ?? EVM_TAG_SUFFIX;
    const verdict = Promise.all([
        simulate(client, { account, to, data }),
        simulate(client, { account, to, data: concat([data, suffix]) }),
    ]).then(([plain, tagged]) => (plain !== null && plain === tagged ? suffix : undefined));

    let timer: ReturnType<typeof setTimeout> | undefined;
    const outOfTime = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), args.timeoutMs ?? GATE_TIMEOUT_MS);
    });
    try {
        return await Promise.race([verdict, outOfTime]);
    } finally {
        clearTimeout(timer);
    }
}
