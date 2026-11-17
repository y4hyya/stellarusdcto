// Scales and layout for the daily chart on /stats. Kept apart from the
// component so the arithmetic that decides what is drawn can be tested.

/** A 6 decimal USDC amount as a plain number, to the cent. For plotting only. */
export function usdc(amount6: string): number {
    if (!/^\d+$/.test(amount6)) return 0;
    return Number((BigInt(amount6) + 5_000n) / 10_000n) / 100;
}

/** The smallest of 1, 2 or 5 times a power of ten that is at or above `value`. */
export function niceCeil(value: number): number {
    // Infinity would never leave the loop below; NaN and nothing both mean
    // "no data".
    if (!Number.isFinite(value) || value <= 0) return 1;
    let base = 1;
    while (base * 10 <= value) base *= 10;
    while (base > value) base /= 10;
    const lead = value / base;
    const nice = lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10;
    return nice * base;
}

export function axisTicks(max: number): number[] {
    return [0, max / 2, max];
}

const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/**
 * A tick label. One style per axis: values in full while the axis stays under
 * ten thousand, compact (10K, 2.5M) once it reaches it.
 */
export function axisLabel(value: number, axisMax: number): string {
    if (value === 0) return '0';
    if (axisMax < 10_000) {
        const [whole, frac] = trim(value, 2).split('.');
        const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return frac ? `${grouped}.${frac}` : grouped;
    }
    if (value >= 1e9) return `${trim(value / 1e9, 1)}B`;
    if (value >= 1e6) return `${trim(value / 1e6, 1)}M`;
    return `${trim(value / 1e3, 1)}K`;
}

/**
 * Where each day's bar sits. Bars are thin on purpose: never wider than 24px
 * however few days there are, and always 2px of surface between neighbours.
 */
export function barLayout(
    count: number,
    plotWidth: number,
): { slot: number; width: number; x: (index: number) => number } {
    if (count <= 0 || plotWidth <= 0) return { slot: 0, width: 0, x: () => 0 };
    const slot = plotWidth / count;
    const width = Math.min(24, Math.max(1, slot - 2));
    return { slot, width, x: (index) => index * slot + (slot - width) / 2 };
}

/** Indices of the days that get a date under the axis: first, last, evenly between. */
export function pickDateTicks(count: number, maxLabels: number): number[] {
    if (count <= 0) return [];
    if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
    const picks = new Set<number>();
    for (let i = 0; i < maxLabels; i++) {
        picks.add(Math.round((i * (count - 1)) / (maxLabels - 1)));
    }
    return [...picks].sort((a, b) => a - b);
}
