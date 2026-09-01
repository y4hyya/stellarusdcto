<script lang="ts">
    import '@fontsource-variable/ibm-plex-sans';
    import '@fontsource/ibm-plex-mono/400.css';
    import '@fontsource/ibm-plex-mono/500.css';
    import '../app.css';
    import { onMount } from 'svelte';
    import { page } from '$app/state';
    import { resolve } from '$app/paths';
    import HistoryPanel from '$lib/components/HistoryPanel.svelte';
    import { envPinnedByHost, getEnv, setEnv, SITE_URLS, type NetworkEnv } from '$lib/registry';
    import { detectAllWallets } from '$lib/ui/wallets.svelte';

    let { children } = $props();

    let history = $state<{ open: () => void } | undefined>();
    let env = $state<NetworkEnv>('testnet');
    let pinned = $state(true);

    onMount(() => {
        detectAllWallets();
        env = getEnv();
        pinned = envPinnedByHost();
    });

    let other = $derived<NetworkEnv>(env === 'testnet' ? 'mainnet' : 'testnet');

    function switchEnv() {
        // Local development only: deployed sites pin the environment by
        // domain, so there the badge links to the other site instead.
        setEnv(other);
        location.reload();
    }
</script>

<div class="wallpaper" aria-hidden="true"></div>

<div class="shell">
    <header class="top">
        <nav class="nav glass" aria-label="Main">
            <a class="nav-link" class:current={page.url.pathname === '/'} href={resolve('/')}
                >Transfer</a
            >
            <a
                class="nav-link"
                class:current={page.url.pathname.startsWith('/rescue')}
                href={resolve('/rescue')}
            >
                Rescue
            </a>
            <button class="nav-link as-button" onclick={() => history?.open()}>History</button>
        </nav>
        <div class="top-right glass">
            {#if pinned}
                <span class="net-badge {env}">{env === 'testnet' ? 'Testnet' : 'Mainnet'}</span>
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external absolute URL to the sibling site -->
                <a class="net-link" href={SITE_URLS[other]} title="Open the {other} site">
                    {other === 'testnet' ? 'Testnet' : 'Mainnet'} ↗
                </a>
            {:else}
                <button class="net-badge {env}" onclick={switchEnv} title="Switch to {other}">
                    {env === 'testnet' ? 'Testnet' : 'Mainnet'}
                </button>
            {/if}
        </div>
    </header>

    <main class="content">
        {@render children()}
    </main>

    <footer class="foot">
        <span
            >No fees · no accounts · no tracking. You pay network gas and Circle's protocol fee
            only.</span
        >
        <span class="foot-links">
            <a href="https://developers.circle.com/cctp" target="_blank" rel="noreferrer">
                Circle docs
            </a>
            ·
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">USDC faucet</a>
            ·
            <a href="https://github.com/y4hyya/stellarusdcto" target="_blank" rel="noreferrer">
                Source
            </a>
            ·
            <a
                href="https://github.com/ElliotFriend/stellar-cctp-demo"
                target="_blank"
                rel="noreferrer"
            >
                Built on Elliot Friend's demo
            </a>
        </span>
    </footer>
</div>

<HistoryPanel bind:this={history} />

<style>
    .shell {
        min-height: 100vh;
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
    }

    /* Transparent positioning row: the pills are the only chrome. */
    .top {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 0.6rem;
        padding: 0.9rem 1.25rem;
        position: sticky;
        top: 0;
        z-index: 20;
    }

    .nav {
        grid-column: 2;
        display: flex;
        gap: 0.2rem;
        padding: 0.3rem;
        border-radius: 999px;
    }

    .nav-link {
        color: var(--text-muted);
        font-size: 0.88rem;
        font-weight: 500;
        padding: 0.45rem 0.95rem;
        border-radius: 999px;
        min-height: 40px;
        display: inline-flex;
        align-items: center;
        white-space: nowrap;
    }

    .nav-link:hover {
        color: var(--text);
        background: var(--bg-elev-2);
        text-decoration: none;
    }

    .nav-link.current {
        color: var(--text);
        background: var(--bg-elev-2);
    }

    .as-button {
        background: none;
        border: none;
    }

    .top-right {
        grid-column: 3;
        justify-self: end;
        display: flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0.3rem 0.45rem;
        border-radius: 999px;
    }

    .net-badge {
        font-size: 0.68rem;
        font-weight: 600;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        white-space: nowrap;
        background: none;
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 0.25rem 0.55rem;
        min-height: 30px;
    }

    .net-badge.testnet {
        color: var(--warning);
    }

    .net-badge.mainnet {
        color: var(--success);
    }

    button.net-badge:hover {
        border-color: var(--border-strong);
    }

    .net-badge {
        display: inline-flex;
        align-items: center;
    }

    .net-link {
        font-size: 0.72rem;
        font-weight: 500;
        color: var(--text-dim);
        white-space: nowrap;
        padding: 0.25rem 0.55rem;
        min-height: 30px;
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
    }

    .net-link:hover {
        color: var(--text);
        background: var(--bg-elev-2);
        text-decoration: none;
    }

    .content {
        flex: 1;
        width: 100%;
        max-width: 44rem;
        margin: 0 auto;
        padding: 2.25rem 1.25rem 3rem;
    }

    .foot {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        align-items: center;
        text-align: center;
        padding: 1.5rem 1.25rem 2rem;
        color: var(--wall-text-dim);
        text-shadow: var(--wall-shadow);
        font-size: 0.8rem;
    }

    .foot :global(a) {
        color: var(--wall-text);
    }

    @media (max-width: 560px) {
        .top {
            grid-template-columns: 1fr;
            justify-items: center;
            row-gap: 0.5rem;
            padding: 0.7rem 0.85rem;
        }

        .nav {
            grid-column: 1;
        }

        .top-right {
            grid-column: 1;
            justify-self: center;
        }

        .content {
            padding: 1.5rem 0.9rem 2.5rem;
        }
    }
</style>
