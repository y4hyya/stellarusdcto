<script lang="ts">
    import {
        axisLabel,
        axisTicks,
        barLayout,
        niceCeil,
        pickDateTicks,
        usdc,
    } from '$lib/stats/chart';
    import { formatUsdc6 } from '$lib/stats/format';
    import type { Stats } from '$lib/stats/types';

    // One series, one axis: USDC volume per UTC day. The count of transfers
    // and of new wallets for a day ride along in the readout and the table
    // rather than on a second axis.
    let { daily }: { daily: Stats['daily'] } = $props();

    const PLOT_HEIGHT = 168;
    const TOP = 10;
    const AXIS_BAND = 24; // the date labels under the baseline
    const GUTTER = 46; // the value labels left of the plot
    const HEIGHT = TOP + PLOT_HEIGHT + AXIS_BAND;
    const BASELINE = TOP + PLOT_HEIGHT;

    let width = $state(0);
    let active = $state<number | null>(null);
    let showTable = $state(false);

    let values = $derived(daily.map((d) => usdc(d.volume)));
    let top = $derived(niceCeil(Math.max(0, ...values)));
    let ticks = $derived(axisTicks(top));
    let plotWidth = $derived(Math.max(0, width - GUTTER));
    let layout = $derived(barLayout(daily.length, plotWidth));
    let dateTicks = $derived(pickDateTicks(daily.length, plotWidth < 380 ? 2 : 4));

    const yOf = (value: number) => BASELINE - (value / top) * PLOT_HEIGHT;

    // A column: square on the baseline, 4px rounded at the data end. A day
    // with any volume is at least a sliver, so it never reads as empty.
    function column(index: number, value: number): string {
        if (!(value > 0) || layout.width === 0) return '';
        const height = Math.max(1.5, (value / top) * PLOT_HEIGHT);
        const x = GUTTER + layout.x(index);
        const w = layout.width;
        const r = Math.min(4, w / 2, height);
        const topY = BASELINE - height;
        return (
            `M${x},${BASELINE}V${topY + r}Q${x},${topY} ${x + r},${topY}` +
            `H${x + w - r}Q${x + w},${topY} ${x + w},${topY + r}V${BASELINE}Z`
        );
    }

    const shortDate = (iso: string) =>
        new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
        });
    const longDate = (iso: string) =>
        new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
        });
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const detail = (d: Stats['daily'][number]) =>
        `${plural(d.transfers, 'transfer', 'transfers')} · ${plural(d.newWallets, 'new wallet', 'new wallets')}`;

    let readout = $derived(active === null ? null : daily[active]);
    // The readout sits beside the active bar, on whichever side has more
    // room, so it never covers the bar being read or the pointer over it.
    let readoutWidth = $state(0);
    let readoutLeft = $derived.by(() => {
        if (active === null) return 0;
        const barLeft = GUTTER + layout.x(active);
        const barRight = barLeft + layout.width;
        const onRightHalf = barLeft + layout.width / 2 > GUTTER + plotWidth / 2;
        const wanted = onRightHalf ? barLeft - 8 - readoutWidth : barRight + 8;
        return Math.min(Math.max(wanted, 0), Math.max(0, width - readoutWidth));
    });

    const last = () => daily.length - 1;

    // The whole column of the plot is the target, not just the painted bar:
    // the pointer only has to be over a day, never on a thin mark.
    function onPointer(event: PointerEvent) {
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const x = event.clientX - box.left - GUTTER;
        if (layout.slot === 0 || x < 0 || x >= plotWidth) {
            active = null;
            return;
        }
        active = Math.min(last(), Math.floor(x / layout.slot));
    }
    function onKey(event: KeyboardEvent) {
        const at = active ?? last();
        const moves: Record<string, number> = {
            ArrowLeft: Math.max(0, at - 1),
            ArrowRight: Math.min(last(), at + 1),
            Home: 0,
            End: last(),
        };
        if (event.key in moves) {
            event.preventDefault();
            active = moves[event.key];
        } else if (event.key === 'Escape') {
            active = null;
        }
    }

    let spoken = $derived.by(() => {
        const d = daily[active ?? last()];
        return d ? `${longDate(d.date)}: ${formatUsdc6(d.volume)} USDC, ${detail(d)}` : '';
    });
</script>

<figure class="chart">
    <figcaption class="head">
        <div>
            <h2 class="title">Volume per day</h2>
            <p class="caption">
                USDC · {daily.length === 1 ? '1 day' : `${daily.length} days`} to {longDate(
                    daily[daily.length - 1].date,
                )}
            </p>
        </div>
        <button
            class="toggle"
            aria-pressed={showTable}
            onclick={() => {
                showTable = !showTable;
                active = null;
            }}
        >
            {showTable ? 'Show chart' : 'Show table'}
        </button>
    </figcaption>

    {#if showTable}
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th scope="col">Day</th>
                        <th scope="col" class="num">Transfers</th>
                        <th scope="col" class="num">Volume, USDC</th>
                        <th scope="col" class="num">New wallets</th>
                    </tr>
                </thead>
                <tbody>
                    {#each [...daily].reverse() as d, i (i)}
                        <tr>
                            <th scope="row">{longDate(d.date)}</th>
                            <td class="num">{d.transfers}</td>
                            <td class="num">{formatUsdc6(d.volume)}</td>
                            <td class="num">{d.newWallets}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {:else}
        <div
            class="plot"
            bind:clientWidth={width}
            role="slider"
            tabindex="0"
            aria-label="Day. Use the left and right arrow keys to read each day."
            aria-valuemin={0}
            aria-valuemax={Math.max(0, last())}
            aria-valuenow={active ?? last()}
            aria-valuetext={spoken}
            onkeydown={onKey}
            onfocus={() => (active = active ?? last())}
            onblur={() => (active = null)}
            onpointermove={onPointer}
            onpointerleave={() => (active = null)}
        >
            {#if width > 0}
                <svg {width} height={HEIGHT} aria-hidden="true">
                    {#each ticks as tick, i (i)}
                        <line
                            class="grid"
                            class:base={tick === 0}
                            x1={GUTTER}
                            x2={width}
                            y1={yOf(tick)}
                            y2={yOf(tick)}
                        />
                        <text class="tick" x={GUTTER - 8} y={yOf(tick)} dy="0.32em">
                            {axisLabel(tick, top)}
                        </text>
                    {/each}

                    {#each values as value, i (i)}
                        <path class="bar" class:on={i === active} d={column(i, value)} />
                    {/each}

                    {#each dateTicks as i (i)}
                        <text
                            class="date"
                            x={GUTTER + layout.x(i) + layout.width / 2}
                            y={BASELINE + 16}
                            text-anchor={daily.length === 1
                                ? 'middle'
                                : i === 0
                                  ? 'start'
                                  : i === last()
                                    ? 'end'
                                    : 'middle'}
                        >
                            {shortDate(daily[i].date)}
                        </text>
                    {/each}
                </svg>

                {#if readout}
                    <div
                        class="readout"
                        bind:clientWidth={readoutWidth}
                        style:left="{readoutLeft}px"
                    >
                        <strong>{formatUsdc6(readout.volume)} USDC</strong>
                        <span>{detail(readout)}</span>
                        <span class="when">{longDate(readout.date)}</span>
                    </div>
                {/if}
            {/if}
        </div>
    {/if}
</figure>

<style>
    .chart {
        /* USDC blue for the marks: checked for lightness, chroma and contrast
           against this surface. The lighter site accent is too pale for a mark. */
        --mark: #2775ca;
        --mark-on: #4f97e6;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
    }

    .title {
        margin: 0;
        font-size: 0.98rem;
        font-weight: 650;
        letter-spacing: -0.01em;
    }

    .caption {
        margin: 0.1rem 0 0;
        font-size: 0.78rem;
        color: var(--text-dim);
    }

    .toggle {
        flex: none;
        min-height: 32px;
        padding: 0 0.7rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: 999px;
        font-size: 0.76rem;
        color: var(--text-muted);
    }

    .toggle:hover {
        border-color: var(--accent);
        color: var(--text);
    }

    .plot {
        position: relative;
        min-height: 202px;
        touch-action: pan-y;
    }

    svg {
        display: block;
        overflow: visible;
    }

    .grid {
        stroke: var(--border);
        stroke-width: 1;
        shape-rendering: crispEdges;
    }

    .grid.base {
        stroke: var(--border-strong);
    }

    .tick,
    .date {
        fill: var(--text-dim);
        font-family: var(--mono);
        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
    }

    .tick {
        text-anchor: end;
    }

    .bar {
        fill: var(--mark);
    }

    .bar.on {
        fill: var(--mark-on);
    }

    .readout {
        position: absolute;
        top: 0;
        display: flex;
        flex-direction: column;
        gap: 0.05rem;
        width: max-content;
        white-space: nowrap;
        padding: 0.4rem 0.6rem;
        background: #1f1613;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius);
        box-shadow: var(--shadow-pop);
        font-size: 0.74rem;
        line-height: 1.4;
        color: var(--text-muted);
        pointer-events: none;
    }

    .readout strong {
        font-size: 0.86rem;
        font-weight: 650;
        color: var(--text);
    }

    .readout .when {
        color: var(--text-dim);
    }

    .table-wrap {
        max-height: 240px;
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: var(--radius);
    }

    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8rem;
    }

    th,
    td {
        padding: 0.4rem 0.7rem;
        text-align: left;
        border-bottom: 1px solid var(--border);
        white-space: nowrap;
    }

    thead th {
        position: sticky;
        top: 0;
        background: #1f1613;
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-dim);
    }

    tbody th {
        font-weight: 400;
        color: var(--text-muted);
    }

    tbody tr:last-child th,
    tbody tr:last-child td {
        border-bottom: none;
    }

    .num {
        text-align: right;
        font-family: var(--mono);
        font-variant-numeric: tabular-nums;
    }
</style>
