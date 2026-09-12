// Complete a CCTP transfer whose destination is Solana from the burn
// transaction hash alone, signing with a local keypair instead of a browser
// wallet. Any transfer with a zero destinationCaller can be completed by
// anyone, so this also works for a burn someone else made.
//
// The accounts and the instruction come from src/lib/solana/mintPlan, the same
// code the app runs, so this cannot drift from what the UI would have sent.
//
// Run with: pnpm exec tsx scripts/experiments/rescue-solana-mint.ts <burnHash> [--mainnet] [--send]
// Without --send it stops after simulation and changes nothing.
// Needs SOL_DEVNET_PRIVATE_KEY (or SOL_PRIVATE_KEY for mainnet) in .env, as a
// base58 secret key or a JSON byte array.

import { readFileSync } from 'node:fs';
import {
    address,
    appendTransactionMessageInstructions,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createTransactionMessage,
    fetchEncodedAccount,
    getAddressDecoder,
    getBase58Encoder,
    getBase64EncodedWireTransaction,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type Instruction,
    type Signature,
} from '@solana/kit';
import {
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { hexToBytes, type Hex } from 'viem';
import {
    buildReceiveMessageInstruction,
    planSolanaMint,
    type SolanaCctpConfig,
} from '../../src/lib/solana/mintPlan';
import { fetchTokenMessenger } from '../../src/lib/solana/generated/token-messenger-minter';
import { MAINNET, TESTNET } from '../../src/lib/registry/index';
import type { SolanaChainEntry } from '../../src/lib/registry/types';

const argv = process.argv.slice(2);
const burnHash = argv.find((a) => !a.startsWith('--'));
const registry = argv.includes('--mainnet') ? MAINNET : TESTNET;
const doSend = argv.includes('--send');
if (!burnHash) {
    console.error(
        'usage: tsx scripts/experiments/rescue-solana-mint.ts <burnHash> [--mainnet] [--send]',
    );
    process.exit(2);
}

const solana = registry.chains.find((c): c is SolanaChainEntry => c.family === 'solana');
if (!solana) throw new Error(`no solana chain in the ${registry.env} registry`);

const config: SolanaCctpConfig = {
    domain: solana.domain,
    messageTransmitter: solana.messageTransmitter,
    tokenMessengerMinter: solana.tokenMessengerMinter,
    usdcMint: solana.usdcMint,
};
const mint = address(solana.usdcMint);
const rpc = createSolanaRpc(solana.rpcUrls[0]);

// ── the signer ───────────────────────────────────────────────────────
const keyName = registry.env === 'mainnet' ? 'SOL_PRIVATE_KEY' : 'SOL_DEVNET_PRIVATE_KEY';
const envLine = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith(`${keyName}=`));
if (!envLine) throw new Error(`${keyName} not found in .env`);
const rawKey = envLine
    .slice(envLine.indexOf('=') + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
const secret = rawKey.startsWith('[')
    ? Uint8Array.from(JSON.parse(rawKey) as number[])
    : new Uint8Array(getBase58Encoder().encode(rawKey));
if (secret.length !== 64) throw new Error(`expected a 64 byte secret key, got ${secret.length}`);
const signer = await createKeyPairSignerFromBytes(secret);
const balance = await rpc.getBalance(signer.address).send();
console.log(`signer:            ${signer.address}`);
console.log(`signer SOL:        ${Number(balance.value) / 1e9}`);

// ── the attested message ─────────────────────────────────────────────
type IrisMessage = { message: Hex; attestation: Hex; status: string; eventNonce: string };
let found: IrisMessage | undefined;
for (const domain of [...new Set(registry.chains.map((c) => c.domain))]) {
    const res = await fetch(
        `${registry.irisBase}/v2/messages/${domain}?transactionHash=${burnHash}`,
    );
    if (!res.ok) continue;
    const body = (await res.json()) as { messages?: IrisMessage[] };
    if (body.messages?.[0]?.message) {
        found = body.messages[0];
        break;
    }
}
if (!found)
    throw new Error('Iris has no message for that burn hash on any domain in this registry');
if (found.status !== 'complete') throw new Error(`attestation is not ready yet: ${found.status}`);

const rawMessage = new Uint8Array(hexToBytes(found.message));
const attestation = new Uint8Array(hexToBytes(found.attestation));
const plan = await planSolanaMint(rawMessage, config);
const { message } = plan;

const sourceLabel =
    registry.chains.find((c) => c.domain === message.sourceDomain)?.label ??
    (message.sourceDomain === registry.stellar.domain
        ? 'Stellar'
        : `domain ${message.sourceDomain}`);
console.log(`route:             ${sourceLabel} -> ${solana.label}`);
console.log(`amount:            ${(Number(message.amount) / 1e6).toFixed(6)} USDC`);
console.log(`recipient account: ${plan.recipientTokenAccount}`);
console.log(`nonce:             ${found.eventNonce}`);

if (message.destinationCaller.some((b) => b !== 0)) {
    const caller = getAddressDecoder().decode(message.destinationCaller);
    if (caller !== signer.address) {
        throw new Error(
            `only ${caller} can complete this mint, it was set as the destinationCaller`,
        );
    }
}

// Circle has to have registered the source chain and its USDC on this cluster,
// otherwise the CPI fails on an uninitialized account and retrying never helps.
for (const [label, account] of [
    ['remote_token_messenger', plan.remoteTokenMessenger],
    ['token_pair', plan.tokenPair],
] as const) {
    const info = await fetchEncodedAccount(rpc, account);
    console.log(`${label.padEnd(18)} ${account} ${info.exists ? 'ok' : 'MISSING'}`);
    if (!info.exists) {
        throw new Error(
            `Circle has not registered ${label} for domain ${message.sourceDomain} on ${solana.label}`,
        );
    }
}

if ((await fetchEncodedAccount(rpc, plan.usedNonce)).exists) {
    console.log('used_nonce exists: this transfer was already minted. Nothing to do.');
    process.exit(0);
}

// ── send ─────────────────────────────────────────────────────────────
// Solana error payloads carry bigints, which plain JSON.stringify refuses to
// serialize. A rescue tool must not die while reporting why it failed.
const describe = (err: unknown) =>
    JSON.stringify(err, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

async function submit(instructions: Instruction[], label: string): Promise<string | null> {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const tx = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(signer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const wire = getBase64EncodedWireTransaction(await signTransactionMessageWithSigners(tx));

    const sim = await rpc
        .simulateTransaction(wire, {
            encoding: 'base64',
            replaceRecentBlockhash: true,
            sigVerify: false,
        })
        .send();
    console.log(`${label}: simulated, ${sim.value.unitsConsumed ?? '?'} compute units`);
    if (sim.value.err) {
        console.error(sim.value.logs?.join('\n'));
        throw new Error(`${label} simulation failed: ${describe(sim.value.err)}`);
    }
    if (!doSend) {
        console.log(`${label}: simulation only, pass --send to broadcast`);
        return null;
    }

    const signature = await rpc
        .sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' })
        .send();
    for (let i = 0; i < 40; i++) {
        const { value } = await rpc.getSignatureStatuses([signature as Signature]).send();
        const status = value[0];
        if (status?.err) throw new Error(`${label} failed: ${describe(status.err)}`);
        if (
            status?.confirmationStatus === 'confirmed' ||
            status?.confirmationStatus === 'finalized'
        ) {
            console.log(`${label} confirmed: ${signature}`);
            return signature;
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`timed out confirming ${label}`);
}

// The mint lands in the token account the burn named, which has to exist
// first. Creating it is only possible when it is the associated token account
// of an owner we know, and it needs its own transaction: bundling it with
// receiveMessage overflows Solana's 1232 byte limit.
const [ownAta] = await findAssociatedTokenPda({
    owner: signer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
});
if (ownAta !== plan.recipientTokenAccount) {
    console.log(
        `NOTE: the USDC lands in ${plan.recipientTokenAccount}, not this signer's account.`,
    );
}
if (!(await fetchEncodedAccount(rpc, plan.recipientTokenAccount)).exists) {
    if (ownAta !== plan.recipientTokenAccount) {
        throw new Error(
            `${plan.recipientTokenAccount} does not exist and is not this signer's USDC account, so only its owner can create it`,
        );
    }
    console.log('recipient token account missing, creating it first');
    await submit(
        [
            await getCreateAssociatedTokenIdempotentInstructionAsync({
                payer: signer,
                owner: signer.address,
                mint,
            }),
        ],
        'create token account',
    );
}

const tokenMessenger = await fetchTokenMessenger(rpc, plan.tokenMessenger);
const [feeRecipientTokenAccount] = await findAssociatedTokenPda({
    owner: tokenMessenger.data.feeRecipient,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
});

const signature = await submit(
    [
        await buildReceiveMessageInstruction({
            plan,
            rawMessage,
            attestation,
            payer: signer,
            feeRecipientTokenAccount,
            config,
        }),
    ],
    'mint',
);

if (signature) {
    const held = await rpc.getTokenAccountBalance(plan.recipientTokenAccount).send();
    console.log(`USDC in ${plan.recipientTokenAccount}: ${held.value.uiAmountString}`);
    console.log(`${solana.explorer}/tx/${signature}${solana.explorerSuffix ?? ''}`);
}
