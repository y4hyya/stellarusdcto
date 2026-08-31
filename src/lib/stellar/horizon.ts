import { TransferError } from '../errors/codes';
import { stellarConfig } from '../registry';

// One Horizon account lookup answers every inbound preflight at once:
// does the account exist, does it hold a USDC trustline, is that trustline
// authorized (Circle's USDC is auth revocable, the issuer can freeze lines),
// and does it have room for the incoming amount. All reads, no keys, CORS
// open, so a static page can hard gate burns on it.

type HorizonBalanceLine = {
    asset_type?: string;
    asset_code?: string;
    asset_issuer?: string;
    balance?: string;
    limit?: string;
    buying_liabilities?: string;
    is_authorized?: boolean;
};

type HorizonAccount = { balances?: HorizonBalanceLine[] };

/** Parse a Horizon 7 decimal amount string into 7 decimal subunits. */
function parse7(value: string | undefined): bigint {
    if (!value) return 0n;
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(7, '0').slice(0, 7));
}

export function evaluateStellarAccount(
    account: HorizonAccount | null,
    amount6: bigint,
    usdc: { code: string; issuer: string },
): TransferError[] {
    if (!account) return [new TransferError('ACCOUNT_NOT_FOUND')];

    const line = (account.balances ?? []).find(
        (b) => b.asset_code === usdc.code && b.asset_issuer === usdc.issuer,
    );
    if (!line) return [new TransferError('NO_TRUSTLINE')];
    if (line.is_authorized === false) return [new TransferError('TRUSTLINE_FROZEN')];

    // Room left on the trustline. Pending buy offers reserve room too, so an
    // incoming transfer can fail exactly like a missing trustline when the
    // line is effectively full.
    const room = parse7(line.limit) - parse7(line.balance) - parse7(line.buying_liabilities);
    const amount7 = amount6 * 10n;
    if (room < amount7) return [new TransferError('TRUSTLINE_FULL')];

    return [];
}

/** Fetch the account from Horizon and evaluate it. 404 means no account. */
export async function checkStellarDestination(
    accountId: string,
    amount6: bigint,
): Promise<TransferError[]> {
    const cfg = stellarConfig();
    let response: Response;
    try {
        response = await fetch(`${cfg.horizonUrl}/accounts/${accountId}`, {
            headers: { Accept: 'application/json' },
        });
    } catch (raw) {
        return [new TransferError('RPC_UNREACHABLE', { raw })];
    }
    if (response.status === 404) return [new TransferError('ACCOUNT_NOT_FOUND')];
    if (!response.ok) {
        return [new TransferError('RPC_UNREACHABLE', { raw: `Horizon ${response.status}` })];
    }
    const json = (await response.json()) as HorizonAccount;
    return evaluateStellarAccount(json, amount6, cfg.usdc);
}
