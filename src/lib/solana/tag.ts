import { address, type Instruction } from '@solana/kit';
import { SOLANA_MEMO_PROGRAM, TAG } from '../attribution/tag';

// The public usage tag on Solana: a memo instruction next to the burn. It
// passes no accounts, so the memo program asks for no extra signature; it
// only checks the text is valid UTF-8 and logs it. RPC nodes return a
// transaction's memo alongside its signature, which is what lets the counting
// script find tagged burns without fetching every transaction.
//
// Burns only. The mint transaction is already at Solana's size limit, so it
// has no room for the extra program key.
export function tagMemoInstruction(): Instruction {
    return {
        programAddress: address(SOLANA_MEMO_PROGRAM),
        data: new TextEncoder().encode(TAG),
    };
}
