<script lang="ts">
    import AmountInput from './AmountInput.svelte';
    import ChainSelect from './ChainSelect.svelte';
    import RecipientRow, { type RecipientStatus } from './RecipientRow.svelte';
    import RouteSummary from './RouteSummary.svelte';
    import TransferProgress from './TransferProgress.svelte';
    import EvmBurnPreview from './EvmBurnPreview.svelte';
    import StellarBurnPreview from './StellarBurnPreview.svelte';
    import SolanaBurnPreview from './SolanaBurnPreview.svelte';
    import HookDataPreview from './HookDataPreview.svelte';
    import { parseUsdc } from '$lib/amounts';
    import { TransferError } from '$lib/errors/codes';
    import { createTransferEngine } from '$lib/engine/transfer.svelte';
    import type { FlowKind } from '$lib/engine/core';
    import { getChain, getRegistry, type TransferSpeed } from '$lib/registry';
    import { resolveCta } from '$lib/ui/cta';
    import { evmWallet, solanaWallet, stellarWallet } from '$lib/ui/wallets.svelte';
    import { shortAddr } from '$lib/utils';
    import { assets } from '$app/paths';
    import type { EvmChainId } from '$lib/config';

    let { onSettled }: { onSettled?: () => void } = $props();

    // Route state: Stellar is always one side; the other side is a registry id.
    let rightChain = $state(getRegistry().defaultChainId);
    let stellarIsSource = $state(true);
    let amount = $state('');
    let speed = $state<TransferSpeed>('standard');
    let forwarding = $state(false);
    let recipient = $state('');
    let recipientStatus = $state<RecipientStatus>({ kind: 'empty', problem: null });

    const engine = createTransferEngine('stellar', getRegistry().defaultChainId);

    let rightEntry = $derived(getChain(rightChain));
    let sourceId = $derived(stellarIsSource ? 'stellar' : rightChain);
    let destId = $derived(stellarIsSource ? rightChain : 'stellar');

    // Fewer knobs: when the wallet advertises EIP 5792 bundling, use it.
    let bundling = $derived(
        !stellarIsSource && rightEntry.family === 'evm' && evmWallet.state.cap.supported,
    );
    let flow = $derived<FlowKind>(
        stellarIsSource ? (forwarding ? 'forwarded' : 'direct') : bundling ? 'sendCalls' : 'direct',
    );

    $effect(() => {
        engine.configure(sourceId, destId, flow);
    });

    let fastAllowed = $derived(!stellarIsSource && rightEntry.fastSource);
    let effectiveSpeed = $derived<TransferSpeed>(fastAllowed ? speed : 'standard');

    // Source side wallet facts.
    let sourceFamily = $derived(stellarIsSource ? 'stellar' : rightEntry.family);
    let sourceConnected = $derived(
        sourceFamily === 'stellar'
            ? stellarWallet.state.address !== null
            : sourceFamily === 'evm'
              ? evmWallet.state.wallet !== null
              : solanaWallet.state.wallet !== null,
    );
    let wrongNetwork = $derived(
        (sourceFamily === 'evm' &&
            evmWallet.state.wallet !== null &&
            !evmWallet.onSelectedNetwork) ||
            (sourceFamily === 'stellar' && stellarWallet.wrongNetwork),
    );
    let connectLabel = $derived(
        sourceFamily === 'stellar'
            ? 'Connect Freighter'
            : sourceFamily === 'evm'
              ? 'Connect wallet'
              : 'Connect Phantom',
    );
    // On chains whose gas token IS USDC (Arc), a burn of the full balance
    // reverts on chain because gas comes out of the same pool. Hold back a
    // little from Max and from the send gate.
    let gasReserve6 = $derived(
        !stellarIsSource &&
            rightEntry.family === 'evm' &&
            rightEntry.chain.nativeCurrency.symbol === 'USDC'
            ? 50_000n
            : 0n,
    );
    let sourceBalance6 = $derived(
        sourceFamily === 'stellar'
            ? stellarWallet.balance6
            : sourceFamily === 'evm'
              ? evmWallet.state.balance6
              : solanaWallet.balance6,
    );
    let sourceAddress = $derived(
        sourceFamily === 'stellar'
            ? stellarWallet.state.address
            : sourceFamily === 'evm'
              ? (evmWallet.state.wallet?.address ?? null)
              : (solanaWallet.state.wallet?.address ?? null),
    );
    let sourceWalletError = $derived(
        sourceFamily === 'stellar'
            ? stellarWallet.state.error
            : sourceFamily === 'evm'
              ? evmWallet.state.error
              : solanaWallet.state.error,
    );

    // Destination side: the recipient defaults to that side's connected wallet.
    let destFamily = $derived(stellarIsSource ? rightEntry.family : 'stellar');
    let destAutoAddress = $derived(
        destFamily === 'stellar'
            ? stellarWallet.state.address
            : destFamily === 'evm'
              ? (evmWallet.state.wallet?.address ?? null)
              : (solanaWallet.state.wallet?.address ?? null),
    );

    let parsed = $derived.by(() => {
        const text = amount.trim();
        if (text === '') return { amount6: null, error: null };
        try {
            return { amount6: parseUsdc(text), error: null };
        } catch (err) {
            return {
                amount6: null,
                error: err instanceof TransferError ? err.userMessage : 'Enter a valid amount',
            };
        }
    });

    let busy = $derived(
        engine.state.phase !== 'idle' &&
            engine.state.phase !== 'done' &&
            engine.state.phase !== 'error',
    );

    let cta = $derived(
        resolveCta({
            busy,
            sourceConnected,
            connectLabel,
            wrongNetwork,
            amountText: amount,
            amountError: parsed.error,
            amount6: parsed.amount6,
            balance6: sourceBalance6,
            gasReserve6,
            recipientState: recipientStatus.kind,
            recipientProblem: recipientStatus.problem?.userMessage ?? null,
            destLabel: destFamily === 'stellar' ? 'Stellar' : rightEntry.label,
        }),
    );

    function connectSource() {
        if (sourceFamily === 'stellar') void stellarWallet.connect();
        else if (sourceFamily === 'evm') void evmWallet.startConnect();
        else void solanaWallet.connect();
    }

    function connectDest() {
        if (destFamily === 'stellar') void stellarWallet.connect();
        else if (destFamily === 'evm') void evmWallet.startConnect();
        else void solanaWallet.connect();
    }

    async function ctaClick() {
        if (cta.kind === 'connect-source') return connectSource();
        if (cta.kind === 'switch-network') {
            // EVM wallets can be switched programmatically; Freighter's
            // network lives in the extension, so a click just re reads it.
            if (sourceFamily === 'evm') return void evmWallet.switchNetwork();
            return void stellarWallet.connect();
        }
        if (cta.kind !== 'send') return;
        await engine.start({
            sourceId,
            destId,
            flow,
            amount: amount.trim(),
            speed: effectiveSpeed,
            recipient: recipient.trim(),
            wallets: {
                stellarAddress: stellarWallet.state.address ?? undefined,
                evm: evmWallet.state.wallet ?? undefined,
                solana: solanaWallet.state.wallet ?? undefined,
            },
        });
        void stellarWallet.refresh();
        void evmWallet.refresh();
        void solanaWallet.refresh();
        onSettled?.();
    }

    function swap() {
        stellarIsSource = !stellarIsSource;
    }

    function pickChain(id: string) {
        rightChain = id;
        const entry = getChain(id);
        if (entry.family === 'evm') void evmWallet.setChain(id as EvmChainId);
    }

    function reset() {
        engine.reset();
        amount = '';
        onSettled?.();
    }

    let showPreview = $derived(
        engine.state.phase === 'idle' && sourceAddress !== null && recipient.trim() !== '',
    );
</script>

<section class="card glass" aria-label="Transfer USDC">
    {#if engine.state.phase === 'idle'}
        <div class="side">
            <div class="side-head">
                <span class="side-label">From</span>
                {#if sourceConnected && sourceAddress}
                    <span class="wallet">
                        <code title={sourceAddress}>{shortAddr(sourceAddress)}</code>
                        {#if sourceFamily === 'stellar'}
                            <button
                                class="mini"
                                title="Ask Freighter for access again, e.g. after switching account or network"
                                onclick={() => void stellarWallet.connect()}
                            >
                                reconnect
                            </button>
                        {:else if sourceFamily === 'evm'}
                            <button class="mini" onclick={() => void evmWallet.disconnect()}>
                                disconnect
                            </button>
                        {:else if sourceFamily === 'solana'}
                            <button class="mini" onclick={() => solanaWallet.disconnect()}>
                                disconnect
                            </button>
                        {/if}
                    </span>
                {:else}
                    <button class="mini connect" onclick={connectSource}>{connectLabel}</button>
                {/if}
            </div>
            <div class="side-row">
                {#if stellarIsSource}
                    <span class="fixed-chain">
                        <img
                            class="coin"
                            src={`${assets}/chains/stellar.svg`}
                            alt=""
                            width="20"
                            height="20"
                        />
                        Stellar
                    </span>
                {:else}
                    <ChainSelect value={rightChain} onSelect={pickChain} disabled={busy} />
                {/if}
                <div class="grow">
                    <AmountInput
                        bind:amount
                        balance6={sourceBalance6}
                        maxReserve6={gasReserve6}
                        disabled={busy}
                    />
                </div>
            </div>
            {#if wrongNetwork && sourceFamily === 'evm'}
                <p class="inline-warn">
                    Your wallet is on a different network.
                    <button class="mini" onclick={() => void evmWallet.switchNetwork()}>
                        Switch to {rightEntry.label}
                    </button>
                </p>
            {:else if wrongNetwork && sourceFamily === 'stellar'}
                <p class="inline-warn">
                    Freighter is on a different Stellar network than this app. Switch the network
                    inside the Freighter extension, then
                    <button class="mini" onclick={() => void stellarWallet.connect()}>
                        reconnect
                    </button>
                </p>
            {/if}
            {#if sourceWalletError}
                <p class="inline-error">{sourceWalletError}</p>
            {/if}
        </div>

        <div class="swap-rail">
            <button class="swap" onclick={swap} disabled={busy} aria-label="Flip direction">
                ⇅
            </button>
        </div>

        <div class="side">
            <div class="side-head">
                <span class="side-label">To</span>
                {#if destAutoAddress === null}
                    <button class="mini connect" onclick={connectDest}>
                        Connect {destFamily === 'stellar'
                            ? 'Freighter'
                            : destFamily === 'evm'
                              ? 'wallet'
                              : 'Phantom'}
                    </button>
                {/if}
            </div>
            <div class="side-row">
                {#if stellarIsSource}
                    <ChainSelect value={rightChain} onSelect={pickChain} disabled={busy} />
                {:else}
                    <span class="fixed-chain">
                        <img
                            class="coin"
                            src={`${assets}/chains/stellar.svg`}
                            alt=""
                            width="20"
                            height="20"
                        />
                        Stellar
                    </span>
                {/if}
                <div class="grow">
                    <RecipientRow
                        bind:recipient
                        bind:status={recipientStatus}
                        {destId}
                        autoAddress={destAutoAddress}
                        amount6={parsed.amount6}
                        disabled={busy}
                    />
                </div>
            </div>
        </div>

        <RouteSummary
            {sourceId}
            {destId}
            bind:speed
            {fastAllowed}
            bind:forwarding
            {bundling}
            disabled={busy}
        />

        <button
            class="cta"
            class:ready={cta.kind === 'send'}
            disabled={!cta.enabled}
            onclick={ctaClick}
        >
            {cta.label}
        </button>

        {#if showPreview}
            <details class="signing">
                <summary>What you're signing</summary>
                <div class="signing-body">
                    {#if !stellarIsSource && rightEntry.family === 'evm' && evmWallet.state.wallet}
                        <EvmBurnPreview
                            evmAddress={evmWallet.state.wallet.address}
                            evmChainId={rightChain as EvmChainId}
                            stellarRecipient={recipient}
                            {amount}
                            inboundFlow={bundling ? 'send-calls' : 'two-tx'}
                            sendCallsCap={evmWallet.state.cap}
                            speed={effectiveSpeed}
                        />
                        <HookDataPreview mode="forwarder" stellarRecipient={recipient} />
                    {:else if !stellarIsSource && rightEntry.family === 'solana' && solanaWallet.state.wallet}
                        <SolanaBurnPreview
                            solanaAddress={solanaWallet.state.wallet.address}
                            stellarRecipient={recipient}
                            {amount}
                            speed={effectiveSpeed}
                        />
                        <HookDataPreview mode="forwarder" stellarRecipient={recipient} />
                    {:else if stellarIsSource && stellarWallet.state.address}
                        {#if rightEntry.family === 'evm'}
                            <StellarBurnPreview
                                stellarAddress={stellarWallet.state.address}
                                evmRecipient={recipient as `0x${string}`}
                                evmChainId={rightChain as EvmChainId}
                                {amount}
                                {forwarding}
                                speed={effectiveSpeed}
                            />
                        {:else}
                            <StellarBurnPreview
                                stellarAddress={stellarWallet.state.address}
                                solanaRecipient={recipient}
                                {amount}
                                {forwarding}
                                speed={effectiveSpeed}
                            />
                        {/if}
                        {#if forwarding}
                            <HookDataPreview mode="cctp-forward" />
                        {/if}
                    {/if}
                </div>
            </details>
        {/if}
    {:else}
        <TransferProgress transfer={engine.state} />
        {#if engine.state.phase === 'done' || engine.state.phase === 'error'}
            <button class="cta secondary" onclick={reset}>Start a new transfer</button>
        {/if}
    {/if}
</section>

{#if evmWallet.state.pickerProviders}
    <div class="picker-overlay" role="dialog" aria-label="Choose a wallet">
        <div class="picker-box">
            <span class="picker-title">Choose a wallet</span>
            {#each evmWallet.state.pickerProviders as info (info.uuid)}
                <button
                    type="button"
                    class="picker-item"
                    onclick={() => void evmWallet.connectWith(info)}
                >
                    <img class="picker-icon" src={info.icon} alt="" />
                    <span>{info.name}</span>
                </button>
            {/each}
            <button type="button" class="mini" onclick={() => evmWallet.cancelPicker()}>
                cancel
            </button>
        </div>
    </div>
{/if}

<style>
    .card {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        width: 100%;
        max-width: 30rem;
        margin: 0 auto;
        padding: 1.25rem;
        border-radius: var(--radius-lg);
    }

    .side {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .side-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        min-height: 1.6rem;
    }

    .side-label {
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-dim);
    }

    .wallet {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8rem;
        color: var(--text-muted);
    }

    .mini {
        background: none;
        border: none;
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 500;
        padding: 0.25rem 0.4rem;
        border-radius: 6px;
        white-space: nowrap;
    }

    .mini:hover:not(:disabled) {
        background: var(--accent-dim);
    }

    .mini.connect {
        border: 1px solid var(--border);
        background: var(--bg-elev-2);
        min-height: 32px;
    }

    .side-row {
        display: flex;
        gap: 0.6rem;
        align-items: flex-start;
    }

    .grow {
        flex: 1;
        min-width: 0;
    }

    .fixed-chain {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        min-height: 44px;
        padding: 0.45rem 0.75rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-weight: 500;
        white-space: nowrap;
    }

    .coin {
        width: 20px;
        height: 20px;
        padding: 2px;
        border-radius: 999px;
        background: #ffffff;
        border: 1px solid var(--border);
        object-fit: contain;
        flex: none;
    }

    .swap-rail {
        display: flex;
        justify-content: center;
        margin: -0.35rem 0;
    }

    .swap {
        width: 40px;
        height: 40px;
        border-radius: 999px;
        background: var(--bg-elev);
        border: 1px solid var(--border-strong);
        color: var(--text-muted);
        font-size: 1.05rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 140ms;
    }

    .swap:hover:not(:disabled) {
        color: var(--accent);
        border-color: var(--accent);
        transform: rotate(180deg);
    }

    .inline-warn {
        margin: 0;
        font-size: 0.8rem;
        color: var(--warning);
    }

    .inline-error {
        margin: 0;
        font-size: 0.8rem;
        color: var(--error);
        word-break: break-word;
    }

    .cta {
        min-height: 52px;
        border: none;
        border-radius: var(--radius);
        font-size: 1rem;
        font-weight: 600;
        background: var(--bg-elev-2);
        color: var(--text-dim);
        border: 1px solid var(--border);
        transition: all 140ms;
    }

    .cta.ready {
        background: var(--accent-strong);
        color: var(--accent-contrast);
        border-color: transparent;
    }

    .cta.ready:hover {
        background: var(--accent-hover);
    }

    .cta:not(.ready):not(:disabled) {
        background: var(--bg-elev-2);
        color: var(--text);
        border-color: var(--border-strong);
    }

    .cta:disabled {
        opacity: 0.9;
    }

    .cta.secondary {
        background: var(--bg-elev-2);
        color: var(--text);
        border: 1px solid var(--border-strong);
    }

    .signing > summary {
        cursor: pointer;
        color: var(--text-dim);
        font-size: 0.82rem;
        list-style: revert;
    }

    .signing[open] > summary {
        color: var(--text);
        margin-bottom: 0.6rem;
    }

    .signing-body {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
    }

    .picker-overlay {
        position: fixed;
        inset: 0;
        background: rgba(10, 5, 3, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 40;
    }

    .picker-box {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        width: min(20rem, calc(100vw - 2rem));
        padding: 1rem;
        background: var(--bg-elev);
        -webkit-backdrop-filter: var(--glass-blur);
        backdrop-filter: var(--glass-blur);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: var(--glass-edge), var(--shadow-pop);
    }

    .picker-title {
        font-size: 0.78rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-dim);
    }

    .picker-item {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        min-height: 44px;
        padding: 0.5rem 0.7rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        text-align: left;
    }

    .picker-item:hover {
        border-color: var(--accent);
    }

    .picker-icon {
        width: 20px;
        height: 20px;
        border-radius: 4px;
        object-fit: contain;
    }

    @media (max-width: 560px) {
        .side-row {
            flex-direction: column;
            align-items: stretch;
        }
    }
</style>
