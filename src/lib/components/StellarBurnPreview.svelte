<script lang="ts">
    import { pad, toHex } from 'viem';
    import {
        EVM_CHAINS,
        SOLANA,
        STELLAR,
        STELLAR_MAX_FEE,
        type EvmChainId,
        type TransferSpeed,
    } from '$lib/config';
    import {
        fetchBurnFee,
        feeBpsFor,
        thresholdFor,
        computeMaxFee,
        fetchForwardFee,
        forwardedMaxFeeStellar,
    } from '$lib/circle/fees';
    import { CCTP_FORWARD_MAGIC, encodeCctpForwardHookData } from '$lib/stellar/cctp';
    import { solanaAtaToBytes32 } from '$lib/stellar/recipient';
    import { parseUsdcStellar, formatUsdc } from '$lib/stellar/usdc';
    import { shortAddr } from '$lib/utils';

    import ContractArg from '$lib/components/ui/ContractArg.svelte';

    // The outbound burn preview, reused for either destination. Pass EVM
    // fields for a Stellar→EVM burn, or `solanaRecipient` (a Solana owner
    // address) for a Stellar→Solana burn. The two are mutually exclusive.
    let {
        stellarAddress,
        evmRecipient,
        evmChainId,
        solanaRecipient,
        amount,
        forwarding,
        speed,
    }: {
        stellarAddress: string;
        evmRecipient?: `0x${string}`;
        evmChainId?: EvmChainId;
        solanaRecipient?: string;
        amount: string;
        forwarding: boolean;
        speed: TransferSpeed;
    } = $props();

    let toSolana = $derived(!!solanaRecipient);

    type Parsed = { ok: true; raw: bigint } | { ok: false };

    // parseUsdcStellar throws on invalid input; surface as a typed result so the
    // template can show a placeholder for empty/invalid values without rendering
    // an error.
    let parsedAmount = $derived<Parsed>(
        (() => {
            const trimmed = amount.trim();
            if (trimmed === '') return { ok: false };
            try {
                return { ok: true, raw: parseUsdcStellar(trimmed) };
            } catch {
                return { ok: false };
            }
        })(),
    );

    // EVM-only chain config, undefined for a Solana destination. Every read is
    // guarded by `toSolana` (template + deriveds) so it never indexes with undefined.
    let chain = $derived(toSolana ? undefined : EVM_CHAINS[evmChainId!]);

    // Destination domain: Solana (5) or the selected EVM chain's domain.
    let destDomain = $derived(toSolana ? SOLANA.domain : EVM_CHAINS[evmChainId!].domain);
    // Route-keyed fee promise, re-runs when the route changes, NOT per keystroke.
    let feePromise = $derived(fetchBurnFee(STELLAR.domain, destDomain));
    let threshold = $derived(thresholdFor(speed));

    let isForwarding = $derived(forwarding);

    const contractAddress = STELLAR.contracts.tokenMessengerMinter;
    const contractLabel = 'TokenMessengerMinter';
    let functionName = $derived(isForwarding ? 'deposit_for_burn_with_hook' : 'deposit_for_burn');

    // Forwarding maxFee comes from the ?forward=true quote (protocol fee +
    // forwarding service fee), keyed by route (works for the Solana dest too).
    let forwardFeePromise = $derived(fetchForwardFee(STELLAR.domain, destDomain));

    // The exact 32-byte hookData submitted on-chain, rendered as hex. The single
    // source of truth is the encoder in cctp.ts.
    const hookDataHex = toHex(encodeCctpForwardHookData());

    // mint_recipient (32 bytes): an EVM address left-padded to 32, OR (for a
    // Solana destination) the recipient's Solana USDC ATA (async; resolved via
    // {#await} in the template).
    let mintRecipientHex = $derived(evmRecipient ? pad(evmRecipient, { size: 32 }) : undefined);
    let solanaAtaPromise = $derived(solanaRecipient ? solanaAtaToBytes32(solanaRecipient) : null);

    // 32 zero bytes signals "open", so anyone can call receiveMessage on the
    // destination. Restricting it to a specific caller is a different mode we
    // don't expose in the demo.
    const ZERO_BYTES_32_HEX = `0x${'0'.repeat(64)}` as const;

    let amountArg = $derived.by(() => {
        if (parsedAmount.ok) {
            return {
                value: parsedAmount.raw.toString(),
                note: `${formatUsdc(parsedAmount.raw)} USDC (Stellar 7-decimal subunits)`,
            };
        } else {
            return {
                placeholder: 'Enter an amount above',
            };
        }
    });
    let mintRecipientNote = $derived(
        toSolana
            ? `Your Solana USDC ATA (owned by ${shortAddr(solanaRecipient ?? '')}).`
            : `Your address on ${chain?.label} (${evmRecipient}), left-padded to 32 bytes.`,
    );
    let mintRecipientValue = $derived.by(async () =>
        toSolana ? toHex(await solanaAtaPromise!) : mintRecipientHex,
    );
    let maxFeeArg = $derived.by(async () => {
        // Read every reactive dependency up front: anything read after an `await`
        // in an async $derived.by body is NOT tracked, so it would go stale.
        const forwarding = isForwarding;
        const currentSpeed = speed;
        const amount = parsedAmount.ok ? parsedAmount.raw : 0n;
        const forwardFees = forwardFeePromise;
        const burnFees = feePromise;

        try {
            if (forwarding) {
                const rows = await forwardFees;
                return {
                    value: forwardedMaxFeeStellar(rows, currentSpeed, amount).toString(),
                    note: "Protocol fee plus Circle's forwarding fee, both taken out of the minted USDC.",
                };
            }
            const bps = feeBpsFor(await burnFees, currentSpeed);
            return {
                value: computeMaxFee(amount, bps, STELLAR_MAX_FEE).toString(),
                note:
                    bps > 0
                        ? `${bps} bps fast fee on top of the floor.`
                        : 'Floor only (Standard speed carries no fee).',
            };
        } catch {
            return {
                value: STELLAR_MAX_FEE.toString(),
                note: `Floor only (the ${forwarding ? 'forwarding ' : ''}fee API didn't answer).`,
            };
        }
    });
</script>

<section class="burn-preview">
    <header class="head">
        <h4 class="title">Burn invocation preview</h4>
        <span class="sub">
            What you're about to sign in Freighter, decoded into human-readable args.
        </span>
    </header>

    <div class="meta">
        <div class="meta-row">
            <span class="meta-label">Contract</span>
            <code class="meta-value" title={contractAddress}>{shortAddr(contractAddress)}</code>
            <span class="meta-aside">{contractLabel}</span>
        </div>
        <div class="meta-row">
            <span class="meta-label">Function</span>
            <code class="meta-value">{functionName}</code>
        </div>
    </div>

    <p class="flow-note">
        A separate <code>usdc.approve(...)</code> goes first, and it's skipped when your existing allowance
        already covers the amount.
    </p>
    {#if isForwarding}
        <p class="flow-note">
            Forwarding is on, so the <code>hook_data</code> below tags this burn for Circle's forwarding
            relayer. The relayer mints on the destination for you and takes its fee out of the minted
            USDC, which means no destination gas out of your pocket.
        </p>
    {/if}

    <h5 class="section-title">Arguments</h5>
    <ul class="rows">
        <ContractArg name="caller" type="Address" value={stellarAddress} truncate>
            {#snippet note()}
                Your address, and the one the USDC is burned from. The contract calls
                <code>require_auth()</code> on it, which is what Freighter prompts you to sign.
            {/snippet}
        </ContractArg>

        <ContractArg name="amount" type="i128" {...amountArg} />

        <ContractArg
            name="destination_domain"
            type="u32"
            value={destDomain.toString()}
            note={toSolana ? 'Solana' : chain?.label}
        />

        {#await mintRecipientValue}
            <ContractArg
                name="mint_recipient"
                type="BytesN<32>"
                placeholder="Deriving your USDC ATA..."
            />
        {:then value}
            <ContractArg
                name="mint_recipient"
                type="BytesN<32>"
                {value}
                note={mintRecipientNote}
                hex
            />
        {:catch}
            <ContractArg
                name="mint_recipient"
                type="BytesN<32>"
                placeholder="Invalid Solana recipient."
            />
        {/await}

        <ContractArg
            name="burn_token"
            type="Address"
            value={STELLAR.contracts.usdc}
            note="Stellar USDC SAC."
            truncate
        />

        <ContractArg name="destination_caller" type="BytesN<32>" value={ZERO_BYTES_32_HEX} hex>
            {#snippet note()}
                All zeros leaves the mint open, so any address can call <code>receiveMessage</code>
                on the destination.
            {/snippet}
        </ContractArg>

        {#await maxFeeArg}
            <ContractArg name="max_fee" type="i128" placeholder="Calculating maximum fee..." />
        {:then { value, note }}
            <ContractArg name="max_fee" type="i128" {value} {note} />
        {/await}

        <ContractArg name="min_finality_threshold" type="u32" value={threshold.toString()}>
            {#snippet note()}
                Finalized. Stellar settles in seconds and always attests at {threshold} no matter what
                you pass here, so Fast Transfer (minting before finality) doesn't apply with Stellar as
                the source.
            {/snippet}
        </ContractArg>

        {#if isForwarding}
            <ContractArg name="hook_data" type="Bytes" value={hookDataHex} hex>
                {#snippet note()}
                    32 bytes: the ascii magic <code>{CCTP_FORWARD_MAGIC}</code> in bytes 0-23, a u32 version
                    of 0, and a u32 length of 0. That magic is what Circle's forwarding relayer watches
                    for. The full byte layout is broken out below.
                {/snippet}
            </ContractArg>
        {/if}
    </ul>
</section>

<style>
    .burn-preview {
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 0.85rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
    }

    .head {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }

    .title {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text);
    }

    .sub {
        font-size: 0.8rem;
        color: var(--text-muted);
        line-height: 1.4;
    }

    .meta {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding: 0.5rem 0.6rem;
        background: var(--bg);
        border-radius: var(--radius);
    }

    .meta-row {
        display: grid;
        grid-template-columns: max-content max-content minmax(0, 1fr);
        align-items: baseline;
        gap: 0.5rem;
    }

    .meta-label {
        font-size: 0.75rem;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .meta-value {
        font-family: var(--mono);
        font-size: 0.78rem;
        color: var(--text);
    }

    .meta-aside {
        font-size: 0.78rem;
        color: var(--text-muted);
        line-height: 1.4;
        overflow-wrap: anywhere;
    }

    .flow-note {
        margin: 0;
        font-size: 0.78rem;
        color: var(--text-muted);
        line-height: 1.4;
    }

    .flow-note code {
        font-family: var(--mono);
        font-size: 0.75rem;
        color: var(--text);
    }

    .section-title {
        margin: 0.2rem 0 0;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }
</style>
