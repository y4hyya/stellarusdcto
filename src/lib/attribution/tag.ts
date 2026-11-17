// ─────────────────────────────────────────────────────────────────────
//  The public usage tag
// ─────────────────────────────────────────────────────────────────────
//
// This site has no server and collects nothing, so the only way to know how
// much it is used is to read it back off the chains. A transfer made here is
// otherwise indistinguishable from any other CCTP transfer, so every
// transaction the app sends carries a small public tag, and a script in
// scripts/stats counts the transactions that carry it.
//
// The tag never touches a fund critical field (amounts, recipients, the
// destination caller, the finality threshold, hook data), and every family
// sends the untagged transaction whenever the tag cannot be proven harmless
// before signing. See src/lib/evm/tag.ts, src/lib/solana/signer.ts and
// src/lib/stellar/tx.ts for the three fail open paths.
//
// This module is imported by the app AND by scripts/stats, so it must stay
// free of $lib and $app imports.

type Hex = `0x${string}`;

/** The tag text. The app will be renamed to this later; the tag already is. */
export const TAG = 'stablehops';

// EVM: bytes appended after the ABI encoded arguments, which Solidity's
// decoder ignores. The layout is ERC-8021 schema 0, read from the end:
// a 16 byte marker, a schema byte (0), a length byte, then that many bytes of
// comma delimited ascii codes.
const ERC_8021_MARKER = '80218021802180218021802180218021';

export function encodeEvmSuffix(codes: string[]): Hex {
    if (codes.length === 0) throw new Error('at least one code is required');
    for (const code of codes) {
        if (code.length === 0) throw new Error('a code cannot be empty');
        if (code.includes(',')) throw new Error(`a code cannot contain a comma: ${code}`);
        for (let i = 0; i < code.length; i++) {
            const c = code.charCodeAt(i);
            if (c < 0x21 || c > 0x7e) throw new Error(`a code must be printable ascii: ${code}`);
        }
    }
    const joined = codes.join(',');
    if (joined.length > 255) throw new Error('the codes do not fit the one byte length');
    let hex = '';
    for (let i = 0; i < joined.length; i++) {
        hex += joined.charCodeAt(i).toString(16).padStart(2, '0');
    }
    const length = joined.length.toString(16).padStart(2, '0');
    return `0x${hex}${length}00${ERC_8021_MARKER}`;
}

export const EVM_TAG_SUFFIX: Hex = encodeEvmSuffix([TAG]);

// Solana: an SPL Memo instruction next to the burn. Version 3 of the memo
// program, because it is immutable; the newer one still has an upgrade
// authority, which has no business next to a burn.
export const SOLANA_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

// Stellar: contract transactions reject any memo outright, so the tag is the
// transaction's "valid after" time bound instead. A time in the past is
// always satisfied, so it changes nothing about when the transaction can
// land. The value is the ascii bytes of "hops" (0x686f7073), 2025-07-10.
export const STELLAR_TAG_MIN_TIME = 1752133747;

// ─── where the tag is on ─────────────────────────────────────────────

// Only the official sites tag, so forks, previews and local runs never add to
// the numbers. The mainnet site joins this list once one real transfer per
// chain family has been checked on the testnet site.
export const TAGGED_HOSTS: readonly string[] = ['testnet.stablehops.com'];

/** Local development can switch the tag on to test it: set this key to "on". */
export const TAG_DEV_FLAG_KEY = 'stellarusdcto.tag';

function isLocalHostname(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}

/** Whether a hostname sends tagged transactions. Exported for tests. */
export function isTagHost(hostname: string | undefined, devFlag: string | null): boolean {
    if (!hostname) return false;
    const h = hostname.toLowerCase();
    if (isLocalHostname(h)) return devFlag === 'on';
    return TAGGED_HOSTS.includes(h);
}

export function tagEnabled(): boolean {
    if (typeof location === 'undefined') return false;
    let devFlag: string | null = null;
    try {
        if (typeof localStorage !== 'undefined') devFlag = localStorage.getItem(TAG_DEV_FLAG_KEY);
    } catch {
        // Private mode or storage denied: the flag simply is not set.
    }
    return isTagHost(location.hostname, devFlag);
}

// ─── recognising the tag afterwards ──────────────────────────────────

/**
 * Whether transaction input carries the suffix. It is searched for anywhere,
 * not just at the tail: a wallet that batches the burn (EIP-7702, smart
 * accounts) wraps our call data inside its own, which leaves the suffix in the
 * middle of the outer input.
 */
export function inputHasTag(input: string, suffix: string = EVM_TAG_SUFFIX): boolean {
    const haystack = input.toLowerCase().replace(/^0x/, '');
    const needle = suffix.toLowerCase().replace(/^0x/, '');
    if (needle.length === 0) return false;
    let at = haystack.indexOf(needle);
    while (at !== -1) {
        // Only whole byte offsets count; a match across nibbles is not our bytes.
        if (at % 2 === 0) return true;
        at = haystack.indexOf(needle, at + 1);
    }
    return false;
}

/**
 * Whether a Solana RPC memo field carries the tag. The RPC reports memos as
 * "[length] text", joined by "; " when a transaction has several.
 */
export function memoHasTag(memo: string | null | undefined): boolean {
    if (!memo) return false;
    return memo
        .split(';')
        .map((part) => part.trim().replace(/^\[\d+\]\s*/, ''))
        .some((text) => text === TAG);
}

/** Whether a Stellar transaction's lower time bound is the tag value. */
export function minTimeIsTag(minTime: string | number | bigint | null | undefined): boolean {
    if (minTime === null || minTime === undefined) return false;
    try {
        return BigInt(minTime) === BigInt(STELLAR_TAG_MIN_TIME);
    } catch {
        return false;
    }
}
