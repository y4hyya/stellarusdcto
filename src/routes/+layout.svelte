<script lang="ts">
    import '@fontsource-variable/ibm-plex-sans';
    import '@fontsource/ibm-plex-mono/400.css';
    import '@fontsource/ibm-plex-mono/500.css';
    import '../app.css';
    import { onMount } from 'svelte';
    import { page } from '$app/state';
    import { resolve } from '$app/paths';
    import HistoryPanel from '$lib/components/HistoryPanel.svelte';
    import { detectAllWallets } from '$lib/ui/wallets.svelte';

    let { children } = $props();

    let history = $state<{ open: () => void } | undefined>();
    let theme = $state<'light' | 'dark' | null>(null);

    onMount(() => {
        detectAllWallets();
        const stored = document.documentElement.dataset.theme;
        theme = stored === 'light' || stored === 'dark' ? stored : null;
    });

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
    <header class="top glass">
        <a class="wordmark" href={resolve('/')}>
            <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
                <rect width="64" height="64" rx="14" fill="#2775CA" />
                <path
                    d="M32 13l4.6 14.4L51 32l-14.4 4.6L32 51l-4.6-14.4L13 32l14.4-4.6z"
                    fill="#fff"
                />
            </svg>
            stellarusdcto
        </a>
        <nav class="nav" aria-label="Main">
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
        <div class="top-right">
            <span class="net-badge">Testnet</span>
            <button class="theme" onclick={toggleTheme} aria-label="Switch color theme">
                <span class="theme-icon" aria-hidden="true">◐</span>
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

    .top {
        display: flex;
        align-items: center;
        gap: 1.25rem;
        padding: 0.85rem 1.25rem;
        border-left: none;
        border-right: none;
        border-top: none;
        position: sticky;
        top: 0;
        z-index: 20;
    }

    .wordmark {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        font-family: var(--mono);
        font-size: 0.98rem;
        font-weight: 500;
        color: var(--text);
        letter-spacing: -0.01em;
        white-space: nowrap;
    }

    .wordmark:hover {
        text-decoration: none;
        color: var(--text);
    }

    .mark {
        width: 22px;
        height: 22px;
        border-radius: 6px;
    }

    .nav {
        display: flex;
        gap: 0.25rem;
        margin-left: 0.25rem;
    }

    .nav-link {
        color: var(--text-muted);
        font-size: 0.88rem;
        font-weight: 500;
        padding: 0.4rem 0.7rem;
        border-radius: var(--radius);
        min-height: 36px;
        display: inline-flex;
        align-items: center;
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
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 0.6rem;
    }

    .net-badge {
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--warning);
        background: var(--warning-dim);
        border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
        padding: 0.22rem 0.55rem;
        border-radius: 999px;
    }

    .theme {
        width: 36px;
        height: 36px;
        border-radius: 999px;
        background: none;
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
            gap: 0.6rem;
            padding: 0.7rem 0.85rem;
            flex-wrap: wrap;
        }

        .nav {
            order: 3;
            width: 100%;
            justify-content: center;
        }
    }
</style>
