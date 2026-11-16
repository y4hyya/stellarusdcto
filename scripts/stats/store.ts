// Files the counting script keeps between runs: two append only ledgers (one
// JSON object per line, so a git diff shows exactly which transfers a run
// added) and a small state file. Writes go to a temporary file first and are
// renamed into place, so a run killed half way never leaves a truncated
// ledger behind.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

function writeAtomic(path: string, content: string): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, content);
    renameSync(tmp, path);
}

export function readJsonl<T>(path: string): T[] {
    if (!existsSync(path)) return [];
    const rows: T[] = [];
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
        if (line.trim() === '') return;
        try {
            rows.push(JSON.parse(line) as T);
        } catch {
            // Dropping the line would silently shrink the totals on the next
            // write, so a damaged ledger stops the run instead.
            throw new Error(`${path}: line ${index + 1} is not valid JSON`);
        }
    });
    return rows;
}

export function writeJsonl<T>(path: string, rows: T[]): void {
    writeAtomic(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
}

export function readJson<T>(path: string, fallback: T): T {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeJson(path: string, value: unknown): void {
    writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Add the records not already present, by id. This is what makes scanning a
 * range twice harmless: a rerun after a crash, or a manual run on top of the
 * scheduled one, can only ever add what is missing.
 */
export function appendUnique<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
    const seen = new Set(existing.map((row) => row.id));
    const merged = [...existing];
    for (const row of incoming) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        merged.push(row);
    }
    return merged;
}
