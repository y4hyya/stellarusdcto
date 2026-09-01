<script lang="ts">
    import TransferCard from '$lib/components/TransferCard.svelte';
</script>

<svelte:head>
    <title>stellarusdcto · move USDC between Stellar and every CCTP chain</title>
</svelte:head>

<div class="page">
    <header class="hero">
        <h1 class="headline">Move USDC to and from Stellar.</h1>
        <p class="sub">
            Native USDC over Circle's CCTP. No pools, no wrapped tokens, no fees from us, and every
            transfer can always be finished, even after a closed tab.
        </p>
    </header>

    <TransferCard />

    <section class="principles" aria-label="What this tool stands for">
        <article class="tile glass">
            <h2 class="tile-title">No fees. Ever.</h2>
            <p class="tile-body">
                You pay network gas and Circle's protocol fee, itemized on the slip before you sign.
                Nothing else. No token, no accounts, no tracking.
            </p>
        </article>
        <article class="tile glass">
            <h2 class="tile-title">Nothing gets stranded.</h2>
            <p class="tile-body">
                Trustline and account checks run before any burn. Transfers survive closed tabs, and
                any CCTP burn, even from another tool, can be finished from its hash.
            </p>
        </article>
        <article class="tile glass">
            <h2 class="tile-title">Open and auditable.</h2>
            <p class="tile-body">
                A static site over Circle's own contracts, nothing of ours in the middle. MIT
                licensed, byte level signing previews, built on Elliot Friend's demo.
            </p>
        </article>
    </section>
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        gap: 1.75rem;
        padding-bottom: 2rem;
    }

    .hero {
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
        text-align: center;
        padding: 2.25rem 0 0.75rem;
    }

    .headline {
        margin: 0;
        font-size: clamp(1.8rem, 4.5vw, 2.4rem);
        font-weight: 650;
        letter-spacing: -0.02em;
        color: var(--wall-text);
        text-shadow: var(--wall-shadow);
    }

    .sub {
        margin: 0 auto;
        max-width: 31rem;
        color: var(--wall-text-dim);
        text-shadow: var(--wall-shadow);
        font-size: 0.95rem;
        line-height: 1.55;
    }

    .principles {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.85rem;
        margin-top: 1.5rem;
    }

    .tile {
        border-radius: var(--radius-lg);
        padding: 1.1rem 1.15rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }

    .tile-title {
        margin: 0;
        font-size: 0.98rem;
        font-weight: 650;
        letter-spacing: -0.01em;
    }

    .tile-body {
        margin: 0;
        font-size: 0.83rem;
        line-height: 1.55;
        color: var(--text-muted);
    }

    @media (max-width: 700px) {
        .principles {
            grid-template-columns: 1fr;
        }
    }
</style>
