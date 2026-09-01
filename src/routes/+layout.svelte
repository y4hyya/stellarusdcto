<script lang="ts">
    import '@fontsource-variable/ibm-plex-sans';
    import '@fontsource/ibm-plex-mono/400.css';
    import '@fontsource/ibm-plex-mono/500.css';
    import '../app.css';
    import { onMount } from 'svelte';
    import { page } from '$app/state';
    import { resolve } from '$app/paths';
    import HistoryPanel from '$lib/components/HistoryPanel.svelte';
    import { getEnv, setEnv, type NetworkEnv } from '$lib/registry';
    import { detectAllWallets } from '$lib/ui/wallets.svelte';

    let { children } = $props();

    let history = $state<{ open: () => void } | undefined>();
    let theme = $state<'light' | 'dark' | null>(null);
    let env = $state<NetworkEnv>('testnet');

    onMount(() => {
        detectAllWallets();
        const stored = document.documentElement.dataset.theme;
        theme = stored === 'light' || stored === 'dark' ? stored : null;
        env = getEnv();
    });

    function switchEnv() {
        // Everything downstream is built per environment at load time, so a
        // switch is a persisted choice plus a clean reload.
        setEnv(env === 'testnet' ? 'mainnet' : 'testnet');
        location.reload();
    }

    function toggleTheme() {
        const effective =
            theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const next = effective === 'dark' ? 'light' : 'dark';
        theme = next;
        document.documentElement.dataset.theme = next;
        try {
            localStorage.setItem('stellarusdcto.theme', next);
        } catch {
            // Private mode: the choice just does not persist.
        }
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
            <button
                class="net-badge {env}"
                onclick={switchEnv}
                title={env === 'testnet' ? 'Switch to Mainnet' : 'Switch to Testnet'}
            >
                {env === 'testnet' ? 'Testnet' : 'Mainnet'}
            </button>
            <button class="theme" onclick={toggleTheme} aria-label="Switch color theme">
                <span aria-hidden="true">◐</span>
            </button>
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
        padding: 0.3rem 0.3rem 0.3rem 0.7rem;
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

    .net-badge:hover {
        border-color: var(--border-strong);
    }

    .theme {
        width: 34px;
        height: 34px;
        border-radius: 999px;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        color: var(--text-muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
    }

    .theme:hover {
        border-color: var(--border-strong);
        color: var(--text);
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
