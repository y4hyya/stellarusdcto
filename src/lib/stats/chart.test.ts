import { describe, expect, test } from 'vitest';
import { axisLabel, axisTicks, barLayout, niceCeil, pickDateTicks, usdc } from './chart';

describe('usdc: a 6 decimal amount as a plain number for plotting', () => {
    test('whole and fractional amounts', () => {
        expect(usdc('0')).toBe(0);
        expect(usdc('1000000')).toBe(1);
        expect(usdc('1234567890')).toBe(1234.57);
        expect(usdc('nonsense')).toBe(0);
    });
});

describe('the top of the value axis is a clean number at or above the data', () => {
    test('rounds up to 1, 2 or 5 times a power of ten', () => {
        expect(niceCeil(7)).toBe(10);
        expect(niceCeil(12)).toBe(20);
        expect(niceCeil(180)).toBe(200);
        expect(niceCeil(2300)).toBe(5000);
        expect(niceCeil(5000)).toBe(5000);
        expect(niceCeil(0.3)).toBe(0.5);
    });

    test('no data still gives an axis', () => {
        expect(niceCeil(0)).toBe(1);
        expect(niceCeil(-4)).toBe(1);
    });

    test('three ticks: zero, half way, top', () => {
        expect(axisTicks(200)).toEqual([0, 100, 200]);
        expect(axisTicks(5000)).toEqual([0, 2500, 5000]);
        expect(axisTicks(1)).toEqual([0, 0.5, 1]);
    });
});

describe('axis labels use one style per axis', () => {
    test('in full while the axis stays under ten thousand', () => {
        expect(axisLabel(0, 5000)).toBe('0');
        expect(axisLabel(2500, 5000)).toBe('2,500');
        expect(axisLabel(0.5, 1)).toBe('0.5');
    });

    test('compact once the axis reaches ten thousand', () => {
        expect(axisLabel(0, 20_000)).toBe('0');
        expect(axisLabel(10_000, 20_000)).toBe('10K');
        expect(axisLabel(2_500_000, 5_000_000)).toBe('2.5M');
        expect(axisLabel(1_000_000_000, 2_000_000_000)).toBe('1B');
    });
});

describe('bars are thin, capped, and separated by the surface', () => {
    test('a few days: bars stop at 24px and sit centred in their slot', () => {
        const layout = barLayout(5, 500);
        expect(layout.slot).toBe(100);
        expect(layout.width).toBe(24);
        expect(layout.x(0)).toBe(38);
        expect(layout.x(4)).toBe(438);
    });

    test('many days: bars shrink but always leave a 2px gap', () => {
        const layout = barLayout(90, 540);
        expect(layout.slot).toBe(6);
        expect(layout.width).toBe(4);
        expect(layout.x(1) - layout.x(0)).toBe(6);
    });

    test('more days than pixels: bars never drop below one pixel', () => {
        expect(barLayout(400, 300).width).toBe(1);
    });

    test('no days or no room gives nothing to draw', () => {
        expect(barLayout(0, 500).width).toBe(0);
        expect(barLayout(10, 0).width).toBe(0);
    });
});

describe('which dates get a label under the axis', () => {
    test('a handful of evenly spread positions, always the first and the last', () => {
        expect(pickDateTicks(1, 4)).toEqual([0]);
        expect(pickDateTicks(2, 4)).toEqual([0, 1]);
        expect(pickDateTicks(90, 4)).toEqual([0, 30, 59, 89]);
        expect(pickDateTicks(3, 4)).toEqual([0, 1, 2]);
    });

    test('a narrow chart asks for fewer', () => {
        expect(pickDateTicks(90, 2)).toEqual([0, 89]);
    });
});
