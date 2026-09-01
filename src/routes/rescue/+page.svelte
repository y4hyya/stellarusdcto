<script lang="ts">
    import { onMount } from 'svelte';
    import { page } from '$app/state';
    import TransferProgress from '$lib/components/TransferProgress.svelte';
    import { classifyHash } from '$lib/engine/core';
    import { createTransferEngine } from '$lib/engine/transfer.svelte';
    import { getRegistry } from '$lib/registry';
    import { evmWallet, solanaWallet, stellarWallet } from '$lib/ui/wallets.svelte';
    import { shortAddr } from '$lib/utils';

    const engine = createTransferEngine('stellar', getRegistry().defaultChainId);

    let burnHash = $state('');
    let trimmed = $derived(burnHash.trim());
    let classified = $derived(trimmed === '' ? null : classifyHash(trimmed));
    let formatError = $derived(
        trimmed !== '' && classified === null
            ? 'That does not look like a transaction hash from a supported chain.'
            : null,
    );
    let busy = $derived(
        engine.state.phase !== 'idle' &&
            engine.state.phase !== 'done' &&
            engine.state.phase !== 'error',
    );
    let canResume = $derived(classified !== null && !busy);

    async function run(hash: string) {
        await engine.resume({
            burnHash: hash,
            wallets: {
                stellarAddress: stellarWallet.state.address ?? undefined,
                evm: evmWallet.state.wallet ?? undefined,
                solana: solanaWallet.state.wallet ?? undefined,
            },
        });
        void stellarWallet.refresh();
        void evmWallet.refresh();
        void solanaWallet.refresh();
    }

    function submit() {
        if (!canResume) return;
        void run(trimmed);
    }

    function reset() {
        engine.reset();
    }

    onMount(() => {
        const fromQuery = page.url.searchParams.get('hash');
        if (fromQuery && classifyHash(fromQuery)) {
            burnHash = fromQuery;
            void run(fromQuery.trim());
        }
    });
</script>

<svelte:head>
    <title>Rescue a transfer · stellarusdcto</title>
</svelte:head>

<div class="page">
    <header class="hero">
        <h1 class="headline">Rescue a transfer.</h1>
        <p class="sub">
            Paste the burn transaction hash of any interrupted CCTP transfer, from this site or any
            other tool. The source chain is detected automatically, the attestation is fetched from
            Circle, and the mint can be completed by any connected wallet, because delivery is
            permissionless.
        </p>
    </header>

    <section class="box glass" aria-label="Rescue by burn hash">
        <label class="hash-label" for="burn-hash">Burn transaction hash</label>
        <div class="hash-row">
            <input
                id="burn-hash"
                class="hash-input"
                type="text"
                placeholder="0x…, 64 hex characters, or a base58 signature"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                aria-describedby="hash-help"
                bind:value={burnHash}
                disabled={busy}
            />
            <button class="go" onclick={submit} disabled={!canResume}>
                {busy ? 'Working…' : 'Find it'}
            </button>
        </div>
        <p id="hash-help" class="help" class:error={formatError !== null}>
            {formatError ??
                'Works for standard CCTP V2 burns. Nothing is submitted until the state is shown.'}
        </p>

        <div class="wallets">
            <span class="wallets-label">Wallets for claiming</span>
            <div class="chips">
                {#if stellarWallet.state.address}
                    <span class="chip on" title={stellarWallet.state.address}>
                        Stellar · {shortAddr(stellarWallet.state.address)}
                    </span>
                {:else}
                    <button class="chip" onclick={() => void stellarWallet.connect()}>
                        Connect Freighter
                    </button>
                {/if}
                {#if evmWallet.state.wallet}
                    <span class="chip on" title={evmWallet.state.wallet.address}>
                        EVM · {shortAddr(evmWallet.state.wallet.address)}
                    </span>
                {:else}
                    <button class="chip" onclick={() => void evmWallet.startConnect()}>
                        Connect EVM wallet
                    </button>
                {/if}
                {#if solanaWallet.state.wallet}
                    <span class="chip on" title={solanaWallet.state.wallet.address}>
                        Solana · {shortAddr(solanaWallet.state.wallet.address)}
                    </span>
                {:else}
                    <button class="chip" onclick={() => void solanaWallet.connect()}>
                        Connect Phantom
                    </button>
                {/if}
            </div>
        </div>
    </section>

    {#if engine.state.phase !== 'idle'}
        <TransferProgress transfer={engine.state} />
        {#if engine.state.phase === 'done' || engine.state.phase === 'error'}
            <button class="again" onclick={reset}>Rescue another</button>
        {/if}
    {/if}
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        max-width: 34rem;
        margin: 0 auto;
    }

    .hero {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        text-align: center;
    }

    .headline {
        margin: 0;
        font-size: 1.7rem;
        font-weight: 650;
        letter-spacing: -0.02em;
        color: var(--wall-text);
        text-shadow: var(--wall-shadow);
    }

    .sub {
        margin: 0;
        color: var(--wall-text-dim);
        text-shadow: var(--wall-shadow);
        font-size: 0.92rem;
        line-height: 1.55;
    }

    .box {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        padding: 1.25rem;
        border-radius: var(--radius-lg);
    }

    .hash-label {
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-dim);
    }

    .hash-row {
        display: flex;
        gap: 0.5rem;
    }

    @media (max-width: 560px) {
        .hash-input {
            font-size: 16px;
        }
    }

    .hash-input {
        flex: 1;
        min-width: 0;
        min-height: 48px;
        padding: 0.5rem 0.8rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-family: var(--mono);
        font-size: 0.85rem;
        outline: none;
    }

    .hash-input:focus-visible {
        border-color: var(--accent);
        box-shadow: var(--ring);
    }

    .go {
        min-height: 48px;
        padding: 0 1.1rem;
        background: var(--accent-strong);
        color: var(--accent-contrast);
        border: none;
        border-radius: var(--radius);
        font-weight: 600;
    }

    .go:hover:not(:disabled) {
        background: var(--accent-hover);
    }

    .go:disabled {
        background: var(--bg-elev-2);
        color: var(--text-dim);
        border: 1px solid var(--border);
    }

    .help {
        margin: 0;
        font-size: 0.78rem;
        color: var(--text-dim);
    }

    .help.error {
        color: var(--error);
    }

    .wallets {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        margin-top: 0.4rem;
        padding-top: 0.75rem;
        border-top: 1px dotted var(--border-strong);
    }

    .wallets-label {
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-dim);
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
    }

    .chip {
        display: inline-flex;
        align-items: center;
        min-height: 36px;
        padding: 0.3rem 0.7rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: 999px;
        font-size: 0.78rem;
        color: var(--text-muted);
    }

    .chip:hover:not(.on) {
        border-color: var(--accent);
        color: var(--text);
    }

    .chip.on {
        color: var(--success);
        border-color: color-mix(in srgb, var(--success) 40%, transparent);
        background: var(--success-dim);
        font-family: var(--mono);
    }

    @media (max-width: 560px) {
        .hash-row {
            flex-direction: column;
        }

        .go {
            width: 100%;
        }
    }

    .again {
        align-self: center;
        -webkit-backdrop-filter: var(--glass-blur);
        backdrop-filter: var(--glass-blur);
        min-height: 44px;
        padding: 0 1.2rem;
        background: var(--bg-elev-2);
        color: var(--text);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius);
        font-weight: 500;
    }
</style>
