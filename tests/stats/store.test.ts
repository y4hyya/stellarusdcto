import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
    appendUnique,
    readJson,
    readJsonl,
    writeJson,
    writeJsonl,
} from '../../scripts/stats/store';

const dir = () => mkdtempSync(join(tmpdir(), 'usage-stats-'));

describe('appendUnique', () => {
    test('keeps one record per id and preserves the order of arrival', () => {
        const merged = appendUnique(
            [
                { id: 'a', n: 1 },
                { id: 'b', n: 2 },
            ],
            [
                { id: 'b', n: 99 },
                { id: 'c', n: 3 },
                { id: 'c', n: 4 },
            ],
        );
        expect(merged).toEqual([
            { id: 'a', n: 1 },
            { id: 'b', n: 2 },
            { id: 'c', n: 3 },
        ]);
    });

    test('scanning the same range twice adds nothing', () => {
        const first = appendUnique([], [{ id: 'base:0x1:0' }, { id: 'base:0x2:0' }]);
        const second = appendUnique(first, [{ id: 'base:0x1:0' }, { id: 'base:0x2:0' }]);
        expect(second).toEqual(first);
    });
});

describe('ledger files', () => {
    test('a missing ledger reads as empty', () => {
        expect(readJsonl(join(dir(), 'nope.jsonl'))).toEqual([]);
    });

    test('rows survive a write and a read, one JSON object per line', () => {
        const path = join(dir(), 'transfers.jsonl');
        const rows = [
            { id: 'a', amount: '1000000' },
            { id: 'b', amount: '2500000' },
        ];
        writeJsonl(path, rows);
        expect(readFileSync(path, 'utf8')).toBe(
            '{"id":"a","amount":"1000000"}\n{"id":"b","amount":"2500000"}\n',
        );
        expect(readJsonl(path)).toEqual(rows);
    });

    test('an empty ledger is an empty file and reads back empty', () => {
        const path = join(dir(), 'transfers.jsonl');
        writeJsonl(path, []);
        expect(readFileSync(path, 'utf8')).toBe('');
        expect(readJsonl(path)).toEqual([]);
    });

    test('a corrupt line stops the run instead of silently dropping records', () => {
        const path = join(dir(), 'transfers.jsonl');
        writeFileSync(path, '{"id":"a"}\n{"id":"b"\n{"id":"c"}\n');
        expect(() => readJsonl(path)).toThrow(/line 2/);
    });

    test('a missing state file reads as the fallback, a present one as its content', () => {
        const path = join(dir(), 'checkpoints.json');
        expect(readJson(path, { evm: {} })).toEqual({ evm: {} });
        writeJson(path, { evm: { base: 12 } });
        expect(readJson(path, { evm: {} })).toEqual({ evm: { base: 12 } });
        expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true);
    });
});
