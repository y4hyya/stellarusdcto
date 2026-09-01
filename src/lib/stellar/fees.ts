import { stellarRpc } from './client';

// Inclusion fee bidding. BASE_FEE (100 stroops) is the protocol minimum and
// always wins on testnet, but mainnet runs surge pricing: a 100 stroop bid
// loses every ledger auction and the transaction is silently evicted from
// the queue. Bid around the network's p90 instead. Stellar charges the
// market clearing fee, not the bid, so overbidding costs nothing extra.

const FLOOR = 10_000n; // 0.001 XLM, comfortably above quiet network rates
const CAP = 200_000n; // 0.02 XLM, the most we are willing to bid
const FALLBACK = '100000'; // when fee stats are unavailable

/** p90 plus 20% headroom, clamped to [FLOOR, CAP]. */
export function clampInclusionFee(p90: bigint): bigint {
    const withHeadroom = p90 + p90 / 5n;
    if (withHeadroom < FLOOR) return FLOOR;
    if (withHeadroom > CAP) return CAP;
    return withHeadroom;
}

let cached: { at: number; fee: string } | null = null;

/**
 * The inclusion fee to bid on the next submitted transaction, as the string
 * TransactionBuilder wants. Live fee stats cached for 30s; any failure falls
 * back to a flat generous bid.
 */
export async function inclusionFee(): Promise<string> {
    if (cached && Date.now() - cached.at < 30_000) return cached.fee;
    try {
        const stats = await stellarRpc.getFeeStats();
        const p90 = BigInt(
            Math.max(
                Number(stats.sorobanInclusionFee?.p90 ?? 0),
                Number(stats.inclusionFee?.p90 ?? 0),
            ),
        );
        const fee = clampInclusionFee(p90).toString();
        cached = { at: Date.now(), fee };
        return fee;
    } catch {
        return FALLBACK;
    }
}
