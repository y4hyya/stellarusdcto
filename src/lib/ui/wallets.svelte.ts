import { connectFreighter, detectFreighter } from '$lib/stellar/freighter';
import { getUsdcBalance as fetchStellarBalance } from '$lib/stellar/usdc';
import {
    connectEvm,
    detectExistingEvm,
    disconnectEvm,
    discoverEvmProviders,
    ensureChain,
    type EvmProviderInfo,
    type EvmWallet,
} from '$lib/evm/wallet';
import { getEvmUsdcBalance } from '$lib/evm/usdc';
import { fetchSendCallsCapability, type SendCallsCapability } from '$lib/evm/capabilities';
import {
    connectSolana,
    detectExistingSolana,
    disconnectSolana,
    discoverSolanaWallets,
    type SolanaWallet,
} from '$lib/solana/wallet';
import { getUsdcBalance as fetchSolanaBalance } from '$lib/solana/usdc';
import { DEFAULT_EVM_CHAIN, EVM_CHAINS, type EvmChainId } from '$lib/config';

// The three wallet connections as shared singletons, so the transfer card,
// the rescue page, and the history panel all see the same state. Logic is
// ported from the retired per family panels; only the presentation moved.

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

// ── Stellar (Freighter) ─────────────────────────────────────────────

const stellarState = $state({
    address: null as string | null,
    installed: false,
    connecting: false,
    error: null as string | null,
    /** Raw Stellar balance in 7 decimal subunits. */
    balance7: null as bigint | null,
    detected: false,
});

async function stellarDetect() {
    if (stellarState.detected) return;
    stellarState.detected = true;
    try {
        const f = await detectFreighter();
        stellarState.installed = f.installed;
        stellarState.address = f.address;
        if (f.address) await stellarRefresh();
    } catch {
        // Not installed: the connect button explains.
    }
}

async function stellarConnect() {
    stellarState.connecting = true;
    stellarState.error = null;
    try {
        const f = await connectFreighter();
        stellarState.installed = f.installed;
        stellarState.address = f.address;
        await stellarRefresh();
    } catch (err) {
        stellarState.error = message(err);
    } finally {
        stellarState.connecting = false;
    }
}

async function stellarRefresh() {
    if (!stellarState.address) {
        stellarState.balance7 = null;
        return;
    }
    try {
        stellarState.balance7 = await fetchStellarBalance(stellarState.address);
    } catch {
        stellarState.balance7 = null;
    }
}

export const stellarWallet = {
    get state() {
        return stellarState;
    },
    detect: stellarDetect,
    connect: stellarConnect,
    refresh: stellarRefresh,
    /** Spendable balance floored to 6 decimal units (7th decimal dust stays). */
    get balance6(): bigint | null {
        return stellarState.balance7 === null ? null : stellarState.balance7 / 10n;
    },
};

// ── EVM (EIP 6963 injected wallets) ─────────────────────────────────

const evmState = $state({
    wallet: null as EvmWallet | null,
    chainId: DEFAULT_EVM_CHAIN as EvmChainId,
    connecting: false,
    error: null as string | null,
    balance6: null as bigint | null,
    cap: { supported: false, atomic: false } as SendCallsCapability,
    pickerProviders: null as EvmProviderInfo[] | null,
    detected: false,
});

async function evmDetect() {
    if (evmState.detected) return;
    evmState.detected = true;
    try {
        const existing = await detectExistingEvm();
        if (existing) {
            evmState.wallet = existing;
            await evmRefresh();
            await evmRefreshCap();
        }
    } catch {
        // No injected wallet: the connect button explains.
    }
}

async function evmRefresh() {
    if (!evmState.wallet) {
        evmState.balance6 = null;
        return;
    }
    try {
        evmState.balance6 = await getEvmUsdcBalance(evmState.chainId, evmState.wallet.address);
    } catch {
        evmState.balance6 = null;
    }
}

async function evmRefreshCap() {
    if (!evmState.wallet) {
        evmState.cap = { supported: false, atomic: false };
        return;
    }
    evmState.cap = await fetchSendCallsCapability(evmState.wallet, evmState.chainId);
}

async function evmStartConnect() {
    evmState.error = null;
    evmState.connecting = true;
    try {
        const providers = await discoverEvmProviders();
        if (providers.length === 0) {
            await evmConnectWith(undefined);
        } else if (providers.length === 1) {
            await evmConnectWith(providers[0]);
        } else {
            evmState.pickerProviders = providers;
        }
    } catch (err) {
        evmState.error = message(err);
    } finally {
        evmState.connecting = false;
    }
}

async function evmConnectWith(info: EvmProviderInfo | undefined) {
    evmState.connecting = true;
    evmState.error = null;
    try {
        let w = await connectEvm(info);
        w = await ensureChain(w, evmState.chainId);
        evmState.wallet = w;
        await evmRefresh();
        await evmRefreshCap();
    } catch (err) {
        evmState.error = message(err);
    } finally {
        evmState.pickerProviders = null;
        evmState.connecting = false;
    }
}

async function evmSwitchNetwork() {
    if (!evmState.wallet) return;
    evmState.error = null;
    try {
        evmState.wallet = await ensureChain(evmState.wallet, evmState.chainId);
        await evmRefresh();
        await evmRefreshCap();
    } catch (err) {
        evmState.error = message(err);
    }
}

/**
 * Owns the chainId write: pre assigning it elsewhere would skip the wallet
 * network switch and the balance/capability refreshes.
 */
async function evmSetChain(id: EvmChainId) {
    if (id === evmState.chainId) {
        // Wallet may have drifted networks while another chain was selected;
        // re assert silently (no prompt when already correct).
        if (evmState.wallet && evmState.wallet.chainId !== chainNumericId(id)) {
            await evmSwitchNetwork();
        }
        return;
    }
    evmState.chainId = id;
    if (evmState.wallet) {
        await evmSwitchNetwork();
    } else {
        evmState.balance6 = null;
        evmState.cap = { supported: false, atomic: false };
    }
}

async function evmDisconnect() {
    await disconnectEvm(evmState.wallet?.provider);
    evmState.wallet = null;
    evmState.balance6 = null;
    evmState.cap = { supported: false, atomic: false };
}

function chainNumericId(id: EvmChainId): number {
    return EVM_CHAINS[id].chain.id;
}

export const evmWallet = {
    get state() {
        return evmState;
    },
    detect: evmDetect,
    startConnect: evmStartConnect,
    connectWith: evmConnectWith,
    setChain: evmSetChain,
    switchNetwork: evmSwitchNetwork,
    refresh: evmRefresh,
    disconnect: evmDisconnect,
    cancelPicker() {
        evmState.pickerProviders = null;
    },
    get onSelectedNetwork(): boolean {
        return !!evmState.wallet && evmState.wallet.chainId === chainNumericId(evmState.chainId);
    },
};

// ── Solana (Wallet Standard) ────────────────────────────────────────

const solanaState = $state({
    wallet: null as SolanaWallet | null,
    connecting: false,
    error: null as string | null,
    /** Display balance string from the RPC, e.g. "12.34". */
    balanceText: null as string | null,
    detected: false,
});

async function solanaDetect() {
    if (solanaState.detected) return;
    solanaState.detected = true;
    try {
        const existing = await detectExistingSolana();
        if (existing) {
            solanaState.wallet = existing;
            await solanaRefresh();
        }
    } catch {
        // No wallet: the connect button explains.
    }
}

async function solanaConnect() {
    solanaState.error = null;
    solanaState.connecting = true;
    try {
        const wallets = discoverSolanaWallets();
        if (wallets.length === 0) {
            throw new Error('No Solana wallet found. Install Phantom from phantom.app and reload.');
        }
        const pick = wallets.find((w) => w.name.toLowerCase().includes('phantom')) ?? wallets[0];
        solanaState.wallet = await connectSolana(pick);
        await solanaRefresh();
    } catch (err) {
        solanaState.error = message(err);
    } finally {
        solanaState.connecting = false;
    }
}

async function solanaRefresh() {
    if (!solanaState.wallet) {
        solanaState.balanceText = null;
        return;
    }
    try {
        solanaState.balanceText = await fetchSolanaBalance(solanaState.wallet.address);
    } catch {
        solanaState.balanceText = null;
    }
}

function solanaDisconnectAll() {
    disconnectSolana();
    solanaState.wallet = null;
    solanaState.balanceText = null;
}

export const solanaWallet = {
    get state() {
        return solanaState;
    },
    detect: solanaDetect,
    connect: solanaConnect,
    refresh: solanaRefresh,
    disconnect: solanaDisconnectAll,
    get balance6(): bigint | null {
        const text = solanaState.balanceText;
        if (text === null) return null;
        const [whole, fraction = ''] = text.split('.');
        try {
            return BigInt(whole + fraction.padEnd(6, '0').slice(0, 6));
        } catch {
            return null;
        }
    },
};

/** Kick every silent reconnect once (layout mount). */
export function detectAllWallets() {
    void stellarDetect();
    void evmDetect();
    void solanaDetect();
}
