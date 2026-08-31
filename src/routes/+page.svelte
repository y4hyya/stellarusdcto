<script lang="ts">
    import { onMount } from 'svelte';
    import StellarPanel from '$lib/components/StellarPanel.svelte';
    import DestinationPanel from '$lib/components/DestinationPanel.svelte';
    import DirectionSwitcher from '$lib/components/DirectionSwitcher.svelte';
    import TransferForm from '$lib/components/TransferForm.svelte';
    import TransferProgress from '$lib/components/TransferProgress.svelte';
    import HookDataPreview from '$lib/components/HookDataPreview.svelte';
    import StellarBurnPreview from '$lib/components/StellarBurnPreview.svelte';
    import EvmBurnPreview from '$lib/components/EvmBurnPreview.svelte';
    import SolanaBurnPreview from '$lib/components/SolanaBurnPreview.svelte';
    import ResumeForm from '$lib/components/ResumeForm.svelte';
    import { createTransferEngine, type EngineWallets } from '$lib/engine/transfer.svelte';
    import type { FlowKind } from '$lib/engine/core';
    import { unfinishedTransfers, type TransferRecord } from '$lib/journal/journal';
    import { getChain } from '$lib/registry';
    import type { FreighterState } from '$lib/stellar/freighter';
    import type { EvmWallet } from '$lib/evm/wallet';
    import type { SolanaWallet } from '$lib/solana/wallet';
    import type { SendCallsCapability } from '$lib/evm/capabilities';
    import { shortAddr } from '$lib/utils';
    import {
        DEFAULT_EVM_CHAIN,
        DEFAULT_FORWARDING,
        DEFAULT_INBOUND_FLOW,
        DEFAULT_SPEED,
        type EvmChainId,
        type InboundFlow,
        type RightChain,
        type TransferSpeed,
    } from '$lib/config';

    let stellar = $state<FreighterState>({
        installed: false,
        address: null,
        networkPassphrase: null,
    });
    let evm = $state<EvmWallet | null>(null);
    let solana = $state<SolanaWallet | null>(null);
    let evmChainId = $state<EvmChainId>(DEFAULT_EVM_CHAIN);
    // The right-side selector value (an EVM chain id, or 'solana') + the
    // orientation flag together derive the route.
    let rightChain = $state<RightChain>(DEFAULT_EVM_CHAIN);
    let stellarIsSource = $state(true);
    let forwarding = $state<boolean>(DEFAULT_FORWARDING);
    let inboundFlow = $state<InboundFlow>(DEFAULT_INBOUND_FLOW);
    let sendCallsCap = $state<SendCallsCapability>({ supported: false, atomic: false });
    let amount = $state('');
    let speed = $state<TransferSpeed>(DEFAULT_SPEED);
    let unfinished = $state<TransferRecord[]>([]);

    // Component instance handles, populated by `bind:this`. Used to imperatively
    // refresh each panel's balance after a successful transfer.
    let stellarPanel = $state<{ refresh: () => Promise<void> } | undefined>();
    let destPanel = $state<{ refresh: () => Promise<void> } | undefined>();

    const transfer = createTransferEngine('stellar', DEFAULT_EVM_CHAIN);

    // The registry id of the non Stellar side ('solana' doubles as its id).
    let rightId = $derived(rightChain === 'solana' ? 'solana' : evmChainId);
    let sourceId = $derived(stellarIsSource ? 'stellar' : rightId);
    let destId = $derived(stellarIsSource ? rightId : 'stellar');
    let flow = $derived<FlowKind>(
        stellarIsSource
            ? forwarding
                ? 'forwarded'
                : 'direct'
            : rightChain !== 'solana' && inboundFlow === 'send-calls'
              ? 'sendCalls'
              : 'direct',
    );

    // Keep the idle step preview in sync with the pickers.
    $effect(() => {
        transfer.configure(sourceId, destId, flow);
    });

    let rightLabel = $derived(getChain(rightId).label);
    let rightConnected = $derived(rightChain === 'solana' ? !!solana : !!evm);
    let bothConnected = $derived(!!stellar.address && rightConnected);
    let busy = $derived(
        transfer.state.phase !== 'idle' &&
            transfer.state.phase !== 'done' &&
            transfer.state.phase !== 'error',
    );
    let canSubmit = $derived(bothConnected && amount.trim() !== '' && !busy);

    // Fast Transfer (mint-before-finality) applies when the SOURCE chain has a
    // real finality delay to mint into. Outbound from Stellar is always Standard.
    let fastAllowed = $derived(!stellarIsSource && getChain(rightId).fastSource);
    let effectiveSpeed = $derived<TransferSpeed>(fastAllowed ? speed : 'standard');

    let wallets = $derived<EngineWallets>({
        stellarAddress: stellar.address ?? undefined,
        evm: evm ?? undefined,
        solana: solana ?? undefined,
    });

    onMount(() => {
        unfinished = unfinishedTransfers();
    });

    async function send() {
        if (!stellar.address) return;
        const recipient = stellarIsSource
            ? rightChain === 'solana'
                ? solana?.address
                : evm?.address
            : stellar.address;
        if (!recipient) return;
        await transfer.start({
            sourceId,
            destId,
            flow,
            amount: amount.trim(),
            speed: effectiveSpeed,
            recipient,
            wallets,
        });
        unfinished = unfinishedTransfers();
        // Skip refetch on error, since the burn may not have landed, and a failed RPC
        // call here would clobber the error state shown to the user.
        if (transfer.state.phase === 'done') {
            await Promise.all([stellarPanel?.refresh(), destPanel?.refresh()]);
        }
    }

    async function resume(burnHash: string) {
        await transfer.resume({ burnHash, wallets });
        unfinished = unfinishedTransfers();
        if (transfer.state.phase === 'done') {
            await Promise.all([stellarPanel?.refresh(), destPanel?.refresh()]);
        }
    }

    function reset() {
        transfer.reset();
        amount = '';
        unfinished = unfinishedTransfers();
    }
</script>

<main class="page">
    <header class="header">
        <h1 class="title">CCTP Demo</h1>
        <p class="subtitle">
            Move USDC between Stellar and any CCTP-supported chain using Circle's Cross-Chain
            Transfer Protocol V2.
        </p>
    </header>

    <div class="wallets">
        <StellarPanel
            bind:this={stellarPanel}
            bind:freighter={stellar}
            bind:forwarding
            {stellarIsSource}
            disabled={busy}
        />
        <DestinationPanel
            bind:this={destPanel}
            bind:chain={rightChain}
            bind:evmWallet={evm}
            bind:evmChainId
            bind:solanaWallet={solana}
            bind:inboundFlow
            bind:sendCallsCap
            {stellarIsSource}
            disabled={busy}
        />
    </div>

    {#if unfinished.length > 0 && transfer.state.phase === 'idle'}
        <aside class="unfinished">
            <strong>You have {unfinished.length === 1 ? 'a transfer' : 'transfers'} waiting.</strong
            >
            <span class="unfinished-sub">
                A burn happened but the mint has not landed yet. Nothing is lost, pick it back up:
            </span>
            {#each unfinished.slice(0, 3) as record (record.id)}
                <button class="unfinished-row" onclick={() => resume(record.burnTxId ?? record.id)}>
                    <code>{shortAddr(record.burnTxId ?? record.id)}</code>
                    <span>{record.sourceId} → {record.destId}</span>
                    <span class="unfinished-action">Resume</span>
                </button>
            {/each}
        </aside>
    {/if}

    <section class="action">
        <DirectionSwitcher bind:stellarIsSource otherLabel={rightLabel} disabled={busy} />
        <TransferForm
            otherLabel={rightLabel}
            {stellarIsSource}
            {fastAllowed}
            bind:amount
            bind:speed
            disabled={busy}
            {busy}
            {canSubmit}
            onsubmit={send}
        />
        {#if !bothConnected}
            <p class="hint">Connect both wallets to enable transfers.</p>
        {/if}
        {#if transfer.state.phase === 'idle'}
            <ResumeForm disabled={busy} onResume={resume} />
        {/if}
        {#if !stellarIsSource && rightChain !== 'solana' && stellar.address && evm && transfer.state.phase === 'idle'}
            <EvmBurnPreview
                evmAddress={evm.address}
                {evmChainId}
                stellarRecipient={stellar.address}
                {amount}
                {inboundFlow}
                {sendCallsCap}
                {speed}
            />
            <HookDataPreview mode="forwarder" stellarRecipient={stellar.address} />
        {/if}
        {#if stellarIsSource && rightChain !== 'solana' && stellar.address && evm && transfer.state.phase === 'idle'}
            <StellarBurnPreview
                stellarAddress={stellar.address}
                evmRecipient={evm.address}
                {evmChainId}
                {amount}
                {forwarding}
                speed={effectiveSpeed}
            />
            {#if forwarding}
                <HookDataPreview mode="cctp-forward" />
            {/if}
        {/if}
        {#if !stellarIsSource && rightChain === 'solana' && stellar.address && solana && transfer.state.phase === 'idle'}
            <SolanaBurnPreview
                solanaAddress={solana.address}
                stellarRecipient={stellar.address}
                {amount}
                speed={effectiveSpeed}
            />
            <HookDataPreview mode="forwarder" stellarRecipient={stellar.address} />
        {/if}
        {#if stellarIsSource && rightChain === 'solana' && stellar.address && solana && transfer.state.phase === 'idle'}
            <StellarBurnPreview
                stellarAddress={stellar.address}
                solanaRecipient={solana.address}
                {amount}
                {forwarding}
                speed={effectiveSpeed}
            />
            {#if forwarding}
                <HookDataPreview mode="cctp-forward" />
            {/if}
        {/if}
    </section>

    {#if transfer.state.phase !== 'idle'}
        <TransferProgress transfer={transfer.state} />
        {#if transfer.state.phase === 'done' || transfer.state.phase === 'error'}
            <button class="reset" onclick={reset}>Start a new transfer</button>
        {/if}
    {/if}

    <footer class="footer">
        <a
            href="https://developers.circle.com/cctp/references/stellar"
            target="_blank"
            rel="noreferrer">Circle Docs</a
        >
        ·
        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">USDC faucet</a>
        ·
        <a href="https://github.com/ElliotFriend/stellar-cctp-demo" target="_blank" rel="noreferrer"
            >Built on Elliot Friend's stellar-cctp-demo</a
        >
    </footer>
</main>

<style>
    .page {
        max-width: 720px;
        margin: 0 auto;
        padding: 3rem 1.25rem 4rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .header {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        text-align: center;
    }

    .title {
        margin: 0;
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: -0.01em;
    }

    .subtitle {
        margin: 0;
        color: var(--text-muted);
        max-width: 32rem;
        margin-inline: auto;
    }

    .wallets {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
    }

    @media (max-width: 560px) {
        .wallets {
            grid-template-columns: 1fr;
        }
    }

    .unfinished {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.85rem 1rem;
        background: color-mix(in srgb, var(--warning) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
        border-radius: var(--radius-lg);
        font-size: 0.9rem;
    }

    .unfinished strong {
        color: var(--warning);
    }

    .unfinished-sub {
        color: var(--text-muted);
        font-size: 0.85rem;
    }

    .unfinished-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 0.5rem 0.75rem;
        color: var(--text);
        font-size: 0.85rem;
        text-align: left;
    }

    .unfinished-row:hover {
        border-color: var(--accent);
    }

    .unfinished-row code {
        font-family: var(--mono);
        color: var(--text-muted);
    }

    .unfinished-action {
        margin-left: auto;
        color: var(--accent);
        font-weight: 600;
    }

    .action {
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    .hint {
        margin: 0;
        text-align: center;
        color: var(--text-dim);
        font-size: 0.85rem;
    }

    .reset {
        align-self: flex-end;
        background: var(--bg-elev-2);
        color: var(--text);
        border: 1px solid var(--border-strong);
        padding: 0.5rem 1rem;
        border-radius: var(--radius);
        font-size: 0.9rem;
    }

    .reset:hover {
        background: var(--accent-dim);
        border-color: var(--accent);
    }

    .footer {
        text-align: center;
        color: var(--text-dim);
        font-size: 0.85rem;
        padding-top: 1rem;
    }
</style>
