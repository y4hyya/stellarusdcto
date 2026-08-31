<script lang="ts">
    import { onMount } from 'svelte';
    import { connectFreighter, detectFreighter, type FreighterState } from '$lib/stellar/freighter';
    import { formatUsdc, getUsdcBalance } from '$lib/stellar/usdc';
    import { shortAddr } from '$lib/utils';

    let {
        freighter = $bindable<FreighterState>({
            installed: false,
            address: null,
            networkPassphrase: null,
        }),
        forwarding = $bindable<boolean>(false),
        stellarIsSource,
        disabled = false,
    }: {
        freighter?: FreighterState;
        forwarding?: boolean;
        stellarIsSource: boolean;
        disabled?: boolean;
    } = $props();

    let balance = $state<bigint | null>(null);
    let balanceError = $state<string | null>(null);
    let connecting = $state(false);
    let connectError = $state<string | null>(null);

    onMount(async () => {
        freighter = await detectFreighter();
        if (freighter.address) await refreshBalance();
    });

    async function refreshBalance() {
        if (!freighter.address) {
            balance = null;
            return;
        }
        balanceError = null;
        try {
            balance = await getUsdcBalance(freighter.address);
        } catch (err) {
            balanceError = err instanceof Error ? err.message : String(err);
            balance = null;
        }
    }

    // Exposed via `bind:this` so the parent can refetch balance after a transfer.
    export function refresh() {
        return refreshBalance();
    }

    async function connect() {
        connecting = true;
        connectError = null;
        try {
            freighter = await connectFreighter();
            await refreshBalance();
        } catch (err) {
            connectError = err instanceof Error ? err.message : String(err);
        } finally {
            connecting = false;
        }
    }
</script>

<section class="panel">
    <header class="head">
        <span class="badge stellar">Stellar Testnet</span>
        <span class="muted">domain 27</span>
    </header>

    {#if !freighter.address}
        <button class="connect" onclick={connect} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect Freighter'}
        </button>
        {#if connectError}<p class="error">{connectError}</p>{/if}
    {:else}
        <div class="addr-row">
            <code class="addr" title={freighter.address}>{shortAddr(freighter.address)}</code>
            <button class="link" onclick={refreshBalance}>refresh</button>
        </div>
        <div class="balance">
            <span class="amount">
                {balance === null ? '…' : formatUsdc(balance)}
            </span>
            <span class="symbol">USDC</span>
        </div>
        {#if balanceError}<p class="error">{balanceError}</p>{/if}
    {/if}

    {#if stellarIsSource}
        <div class="flow-picker">
            <div class="forwarding-row">
                <span class="forwarding-text">
                    Circle forwarding ⚗︎
                    <span class="forwarding-sub">
                        Tag the burn so Circle's relayer auto-mints on the destination, so the
                        recipient needs no gas there. The relayer's fee comes out of the USDC.
                    </span>
                </span>
                <button
                    type="button"
                    class="switch"
                    class:on={forwarding}
                    {disabled}
                    role="switch"
                    aria-checked={forwarding}
                    aria-label="Use Circle forwarding"
                    onclick={() => (forwarding = !forwarding)}
                >
                    <span class="knob"></span>
                </button>
            </div>
        </div>
    {/if}
</section>

<style>
    .panel {
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        min-height: 160px;
    }

    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .badge {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 600;
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
    }

    .badge.stellar {
        background: color-mix(in srgb, var(--stellar) 20%, transparent);
        color: var(--stellar);
    }

    .muted {
        color: var(--text-dim);
        font-size: 0.85rem;
        font-family: var(--mono);
    }

    .connect {
        background: var(--bg-elev-2);
        color: var(--text);
        border: 1px solid var(--border-strong);
        padding: 0.6rem 1rem;
        border-radius: var(--radius);
        font-weight: 500;
        transition: background 120ms;
    }

    .connect:hover:not(:disabled) {
        background: var(--accent-dim);
        border-color: var(--accent);
    }

    .addr-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
    }

    .addr {
        font-family: var(--mono);
        font-size: 0.85rem;
        color: var(--text-muted);
    }

    .link {
        background: none;
        border: none;
        color: var(--accent);
        font-size: 0.8rem;
        padding: 0;
    }

    .link:hover {
        text-decoration: underline;
    }

    .balance {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
    }

    .amount {
        font-size: 1.6rem;
        font-weight: 600;
        color: var(--text);
        font-variant-numeric: tabular-nums;
    }

    .symbol {
        font-size: 0.95rem;
        color: var(--text-muted);
    }

    .error {
        color: var(--error);
        font-size: 0.85rem;
        margin: 0;
    }

    .flow-picker {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        margin-top: auto;
        padding-top: 0.5rem;
        border-top: 1px solid var(--border);
    }

    .forwarding-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        margin-top: 0.5rem;
    }

    .forwarding-text {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        font-size: 0.78rem;
        font-weight: 500;
        color: var(--text);
    }

    .forwarding-sub {
        font-size: 0.7rem;
        font-weight: 400;
        color: var(--text-dim);
        line-height: 1.4;
    }

    .switch {
        flex: none;
        width: 2.4rem;
        height: 1.35rem;
        padding: 0.15rem;
        border-radius: 999px;
        background: var(--bg-elev-2);
        border: 1px solid var(--border-strong);
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        transition: all 120ms;
    }

    .switch.on {
        background: var(--accent-dim);
        border-color: var(--accent);
        justify-content: flex-end;
    }

    .switch:disabled {
        opacity: 0.5;
    }

    .knob {
        width: 1rem;
        height: 1rem;
        border-radius: 50%;
        background: var(--text-muted);
        transition: background 120ms;
    }

    .switch.on .knob {
        background: var(--accent);
    }
</style>
