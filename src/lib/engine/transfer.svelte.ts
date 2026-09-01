import { hexToBytes, type Hex } from 'viem';
import { getChainAdapter, getStellarAdapter } from '$lib/adapters';
import type { MintTarget } from '$lib/adapters/types';
import { parseUsdc, toStellarSubunits } from '$lib/amounts';
import { TransferError } from '$lib/errors/codes';
import { translateError } from '$lib/errors/translate';
import { saveTransfer, updateTransfer } from '$lib/journal/journal';
import {
    chainByDomain,
    getChain,
    getRegistry,
    stellarConfig,
    type ChainEntry,
    type EvmChainEntry,
    type SolanaChainEntry,
    type TransferSpeed,
} from '$lib/registry';
import {
    computeMaxFee,
    feeBpsFor,
    fetchBurnFee,
    fetchForwardFee,
    forwardedMaxFeeStellar,
    thresholdFor,
} from '$lib/circle/fees';
import { fetchAttestation, pollAttestation, type IrisMessage } from '$lib/circle/iris';
import { mintAndForward, stellarDepositForBurn } from '$lib/stellar/cctp';
import { approveUsdc, getUsdcAllowance } from '$lib/stellar/usdc';
import {
    evmBurnToTarget,
    evmSendCallsBurnToTarget,
    findEvmReceipt,
    receiveMessageOnEvm,
} from '$lib/evm/cctp';
import { approveEvmUsdc, getEvmUsdcAllowance, getEvmUsdcBalance } from '$lib/evm/usdc';
import { solanaBurnToTarget } from '$lib/solana/cctp';
import { receiveMessageOnSolana } from '$lib/solana/mint';
import { getUsdcBalance as getSolanaUsdcBalance } from '$lib/solana/usdc';
import type { EvmWallet } from '$lib/evm/wallet';
import type { SolanaWallet } from '$lib/solana/wallet';
import { sleep } from '$lib/utils';
import {
    buildSteps,
    candidateDomains,
    classifyHash,
    needsApprove,
    sideFamily,
    type FlowKind,
    type RouteSide,
    type Step,
} from './core';
// Compat constants live with the old config until every consumer migrates.
import { EVM_MAX_FEE, SOLANA_MAX_FEE, STELLAR_MAX_FEE, type EvmChainId } from '$lib/config';

// The one transfer engine. Every route runs the same sequence:
//   preflight -> approve if needed -> burn -> attest -> nonce check -> mint
// parameterized by (source, dest, flow), with the destination adapter owning
// the burn slots. Every step transition is journaled so a refresh mid
// transfer is recoverable, and every failure goes through translateError.

export type Phase =
    'idle' | 'preflight' | 'approving' | 'burning' | 'attesting' | 'minting' | 'done' | 'error';

export type EngineWallets = {
    stellarAddress?: string;
    evm?: EvmWallet;
    solana?: SolanaWallet;
};

export type EngineState = {
    sourceId: string;
    destId: string;
    flow: FlowKind;
    phase: Phase;
    speed: TransferSpeed;
    amount: string;
    steps: Step[];
    error: TransferError | null;
    attestation: IrisMessage | null;
    burnTxId: string | null;
};

const stellarTxUrl = (hash: string) => `${stellarConfig().explorer}/tx/${hash}`;

function chainTxUrl(entry: ChainEntry, hash: string): string {
    if (entry.family === 'solana') return `${entry.explorer}/tx/${hash}${entry.explorerSuffix}`;
    return `${entry.explorer}/tx/${hash}`;
}

function sideTxUrl(side: RouteSide, hash: string): string {
    return side === 'stellar' ? stellarTxUrl(hash) : chainTxUrl(side, hash);
}

function resolveSide(id: string): RouteSide {
    return id === 'stellar' ? 'stellar' : getChain(id);
}

// The Solana balance helper returns a display string; the relayer watch
// needs comparable 6 decimal units.
async function solanaBalance6(owner: string): Promise<bigint> {
    const text = await getSolanaUsdcBalance(owner);
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole + fraction.padEnd(6, '0').slice(0, 6));
}

function sideDomain(side: RouteSide): number {
    return side === 'stellar' ? stellarConfig().domain : side.domain;
}

export function createTransferEngine(initialSourceId: string, initialDestId: string) {
    const state = $state<EngineState>({
        sourceId: initialSourceId,
        destId: initialDestId,
        flow: 'direct',
        phase: 'idle',
        speed: 'standard',
        amount: '',
        steps: buildSteps(resolveSide(initialSourceId), resolveSide(initialDestId), 'direct'),
        error: null,
        attestation: null,
        burnTxId: null,
    });

    /** Update the idle route preview (pickers changed, nothing running). */
    function configure(sourceId: string, destId: string, flow: FlowKind) {
        state.sourceId = sourceId;
        state.destId = destId;
        state.flow = flow;
        if (state.phase === 'idle') {
            state.steps = buildSteps(resolveSide(sourceId), resolveSide(destId), flow);
        }
    }

    function reset() {
        state.phase = 'idle';
        state.amount = '';
        state.error = null;
        state.attestation = null;
        state.burnTxId = null;
        state.steps = buildSteps(
            resolveSide(state.sourceId),
            resolveSide(state.destId),
            state.flow,
        );
    }

    function patchStep(key: Step['key'], patch: Partial<Step>) {
        state.steps = state.steps.map((s) => (s.key === key ? { ...s, ...patch } : s));
    }

    function fail(error: TransferError) {
        state.phase = 'error';
        state.error = error;
        state.steps = state.steps.map((s) =>
            s.status === 'active' ? { ...s, status: 'error', endedAt: Date.now() } : s,
        );
        if (state.burnTxId) {
            updateTransfer(state.burnTxId, { phase: 'error', error: error.code });
        }
    }

    async function performStep<T>(
        phase: Phase,
        key: Step['key'],
        family: 'evm' | 'solana' | 'stellar',
        op: () => Promise<{ result: T; patch?: Partial<Step> }>,
    ): Promise<T | null> {
        state.phase = phase;
        patchStep(key, { status: 'active', startedAt: Date.now() });
        try {
            const { result, patch } = await op();
            patchStep(key, { status: 'done', endedAt: Date.now(), ...patch });
            return result;
        } catch (err) {
            fail(translateError(err, { family, phase }));
            return null;
        }
    }

    function requireWallet<T>(value: T | undefined, hint: string): T {
        if (value === undefined) {
            throw new TransferError('WALLET_REQUIRED', { raw: hint });
        }
        return value;
    }

    async function start(args: {
        sourceId: string;
        destId: string;
        flow: FlowKind;
        amount: string;
        speed: TransferSpeed;
        recipient: string;
        wallets: EngineWallets;
    }) {
        const source = resolveSide(args.sourceId);
        const dest = resolveSide(args.destId);
        if ((source === 'stellar') === (dest === 'stellar')) {
            fail(new TransferError('CONFIG_MISSING', { raw: 'exactly one side must be stellar' }));
            return;
        }

        state.sourceId = args.sourceId;
        state.destId = args.destId;
        state.flow = args.flow;
        state.speed = args.speed;
        state.error = null;
        state.attestation = null;
        state.burnTxId = null;
        state.amount = args.amount;
        state.steps = buildSteps(source, dest, args.flow);

        let amount6: bigint;
        try {
            amount6 = parseUsdc(args.amount);
        } catch (err) {
            fail(translateError(err, {}));
            return;
        }

        // Hard preflight gate: a burn is not allowed while the destination
        // cannot receive the funds. This is what keeps the trustline footgun
        // from ever burning first and failing later.
        state.phase = 'preflight';
        const destAdapter = dest === 'stellar' ? getStellarAdapter() : getChainAdapter(dest);
        const problems = await destAdapter.checkDestination(args.recipient, amount6);
        if (problems.length > 0) {
            fail(problems[0]);
            return;
        }

        let target: MintTarget;
        try {
            target = await destAdapter.mintTarget(args.recipient);
        } catch (err) {
            fail(translateError(err, { family: sideFamily(dest) }));
            return;
        }

        const sourceFamily = sideFamily(source);
        const destDomain = sideDomain(dest);
        const sourceDomain = sideDomain(source);
        const amount7 = toStellarSubunits(amount6);

        // Approve, when the flow needs a separate allowance transaction.
        if (needsApprove(sourceFamily, args.flow)) {
            const approved = await performStep('approving', 'approve', sourceFamily, async () => {
                if (source === 'stellar') {
                    const caller = requireWallet(args.wallets.stellarAddress, 'stellar wallet');
                    const spender = stellarConfig().contracts.tokenMessengerMinter;
                    const existing = await getUsdcAllowance({ from: caller, spender });
                    if (existing >= amount7) {
                        return {
                            result: true,
                            patch: { detail: 'sufficient allowance already set' },
                        };
                    }
                    const hash = await approveUsdc({ from: caller, spender, amount: amount7 });
                    return {
                        result: true,
                        patch: { hash, hashUrl: stellarTxUrl(hash), detail: 'allowance set' },
                    };
                }
                const entry = source as EvmChainEntry;
                const wallet = requireWallet(args.wallets.evm, 'evm wallet');
                const chainId = entry.id as EvmChainId;
                const allowance = await getEvmUsdcAllowance(
                    chainId,
                    wallet.address,
                    entry.tokenMessenger,
                );
                if (allowance >= amount6) {
                    return { result: true, patch: { detail: 'sufficient allowance already set' } };
                }
                const hash = await approveEvmUsdc({
                    chainId,
                    wallet,
                    spender: entry.tokenMessenger,
                    amount: amount6,
                });
                return {
                    result: true,
                    patch: { hash, hashUrl: chainTxUrl(entry, hash), detail: 'allowance set' },
                };
            });
            if (approved === null) return;
        }

        // Forwarded transfers watch the destination balance for the relayer
        // mint, so the baseline must be read before the burn.
        let forwardedBaseline = 0n;
        if (args.flow === 'forwarded' && dest !== 'stellar') {
            try {
                forwardedBaseline =
                    dest.family === 'evm'
                        ? await getEvmUsdcBalance(
                              dest.id as EvmChainId,
                              args.recipient as `0x${string}`,
                          )
                        : await solanaBalance6(args.recipient);
            } catch (err) {
                fail(translateError(err, { family: dest.family }));
                return;
            }
        }

        // Burn on the source chain.
        const burnHash = await performStep('burning', 'burn', sourceFamily, async () => {
            if (source === 'stellar') {
                const caller = requireWallet(args.wallets.stellarAddress, 'stellar wallet');
                const forwarded = args.flow === 'forwarded';
                const maxFee = forwarded
                    ? forwardedMaxFeeStellar(
                          await fetchForwardFee(sourceDomain, destDomain),
                          args.speed,
                          amount7,
                      )
                    : computeMaxFee(
                          amount7,
                          feeBpsFor(await fetchBurnFee(sourceDomain, destDomain), args.speed),
                          STELLAR_MAX_FEE,
                      );
                const r = await stellarDepositForBurn({
                    caller,
                    amount: amount7,
                    destinationDomain: destDomain,
                    target,
                    maxFee,
                    finalityThreshold: thresholdFor(args.speed),
                    forwarded,
                });
                return {
                    result: r.hash,
                    patch: { hash: r.hash, hashUrl: stellarTxUrl(r.hash) },
                };
            }
            if (source.family === 'evm') {
                const wallet = requireWallet(args.wallets.evm, 'evm wallet');
                const maxFee = computeMaxFee(
                    amount6,
                    feeBpsFor(await fetchBurnFee(sourceDomain, destDomain), args.speed),
                    EVM_MAX_FEE,
                );
                const burnArgs = {
                    chainId: source.id as EvmChainId,
                    wallet,
                    amount: amount6,
                    destinationDomain: destDomain,
                    target,
                    maxFee,
                    finalityThreshold: thresholdFor(args.speed),
                };
                const hash =
                    args.flow === 'sendCalls'
                        ? await evmSendCallsBurnToTarget(burnArgs)
                        : await evmBurnToTarget(burnArgs);
                return {
                    result: hash as string,
                    patch: { hash, hashUrl: chainTxUrl(source, hash) },
                };
            }
            const wallet = requireWallet(args.wallets.solana, 'solana wallet');
            const maxFee = computeMaxFee(
                amount6,
                feeBpsFor(await fetchBurnFee(sourceDomain, destDomain), args.speed),
                SOLANA_MAX_FEE,
            );
            const { signature } = await solanaBurnToTarget({
                wallet,
                amount: amount6,
                destinationDomain: destDomain,
                target,
                maxFee,
                minFinalityThreshold: thresholdFor(args.speed),
            });
            return {
                result: signature,
                patch: { hash: signature, hashUrl: chainTxUrl(source, signature) },
            };
        });
        if (burnHash === null) return;

        state.burnTxId = burnHash;
        saveTransfer({
            id: burnHash,
            env: getRegistry().env,
            sourceId: args.sourceId,
            destId: args.destId,
            amount6: amount6.toString(),
            recipient: args.recipient,
            speed: args.speed,
            flow: args.flow,
            phase: 'attesting',
            burnTxId: burnHash,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        await runTail({
            source,
            dest,
            burnHash,
            recipient: args.recipient,
            wallets: args.wallets,
            forwarded: args.flow === 'forwarded',
            forwardedBaseline,
        });
    }

    // Attest, guard against an already used nonce, then mint (or watch the
    // relayer do it for forwarded transfers). Shared by start and resume.
    async function runTail(args: {
        source: RouteSide;
        dest: RouteSide;
        burnHash: string;
        recipient: string;
        wallets: EngineWallets;
        forwarded: boolean;
        forwardedBaseline: bigint;
        preAttested?: IrisMessage;
    }) {
        const { source, dest, burnHash } = args;
        const sourceDomain = sideDomain(source);
        const destFamily = sideFamily(dest);

        const attest = await performStep<IrisMessage>(
            'attesting',
            'attest',
            destFamily,
            async () => {
                if (args.preAttested) {
                    return { result: args.preAttested, patch: { detail: 'attested' } };
                }
                const r = await pollAttestation(sourceDomain, burnHash, {
                    onProgress: ({ elapsedMs, status }) => {
                        patchStep('attest', {
                            detail: `${Math.round(elapsedMs / 1000)}s · ${status}`,
                        });
                    },
                });
                return { result: r, patch: { detail: 'attested' } };
            },
        );
        if (attest === null) return;
        state.attestation = attest;
        updateTransfer(burnHash, { nonce: attest.eventNonce, phase: 'minting' });

        // Forwarded transfers: Circle's relayer submits the destination mint,
        // so watch the recipient balance instead of sending a transaction.
        // destinationCaller stayed zero, so a manual mint remains possible if
        // the relayer never shows up.
        if (args.forwarded && dest !== 'stellar') {
            const minted = await performStep('minting', 'mint', destFamily, async () => {
                const startTime = Date.now();
                const timeout = 3 * 60_000;
                while (Date.now() - startTime < timeout) {
                    const balance =
                        dest.family === 'evm'
                            ? await getEvmUsdcBalance(
                                  dest.id as EvmChainId,
                                  args.recipient as `0x${string}`,
                              )
                            : await solanaBalance6(args.recipient);
                    if (balance > args.forwardedBaseline) {
                        return {
                            result: balance,
                            patch: {
                                detail: `relayer minted +${balance - args.forwardedBaseline} (no user tx)`,
                            },
                        };
                    }
                    patchStep('mint', {
                        detail: `awaiting Circle relayer… ${Math.round((Date.now() - startTime) / 1000)}s`,
                    });
                    await sleep(5_000);
                }
                throw new TransferError('ATTESTATION_PENDING', {
                    userMessage:
                        'The relayer has not minted yet. Your burn is attested and completable any time.',
                    action: 'Use the resume box with the burn hash to mint manually.',
                });
            });
            if (minted === null) return;
            try {
                const finalMsg = await fetchAttestation(sourceDomain, burnHash);
                if (finalMsg) state.attestation = finalMsg;
            } catch {
                // Keep the attestation time message; the mint already landed.
            }
            state.phase = 'done';
            updateTransfer(burnHash, { phase: 'done' });
            return;
        }

        // Never submit a doomed mint: if the nonce was consumed, the transfer
        // is already complete and the only correct outcome is to say so.
        const nonce = attest.eventNonce as `0x${string}` | undefined;
        if (nonce) {
            const destAdapter = dest === 'stellar' ? getStellarAdapter() : getChainAdapter(dest);
            const used =
                dest === 'stellar'
                    ? await getStellarAdapter().isNonceUsed(nonce, args.wallets.stellarAddress)
                    : await destAdapter.isNonceUsed(nonce);
            if (used === true) {
                patchStep('mint', {
                    status: 'done',
                    endedAt: Date.now(),
                    detail: 'already completed earlier',
                });
                state.phase = 'done';
                updateTransfer(burnHash, { phase: 'done' });
                return;
            }
        }

        const mintHash = await performStep('minting', 'mint', destFamily, async () => {
            if (dest === 'stellar') {
                const caller = requireWallet(args.wallets.stellarAddress, 'stellar wallet');
                const r = await mintAndForward({
                    caller,
                    message: hexToBytes(attest.message as Hex),
                    attestation: hexToBytes(attest.attestation as Hex),
                });
                return { result: r.hash, patch: { hash: r.hash, hashUrl: stellarTxUrl(r.hash) } };
            }
            if (dest.family === 'evm') {
                const wallet = requireWallet(args.wallets.evm, 'evm wallet');
                const hash = await receiveMessageOnEvm({
                    chainId: dest.id as EvmChainId,
                    wallet,
                    message: attest.message,
                    attestation: attest.attestation,
                });
                return { result: hash as string, patch: { hash, hashUrl: chainTxUrl(dest, hash) } };
            }
            const wallet = requireWallet(args.wallets.solana, 'solana wallet');
            const { signature } = await receiveMessageOnSolana({
                wallet,
                recipientOwner: args.recipient || wallet.address,
                message: attest.message as Hex,
                attestation: attest.attestation as Hex,
            });
            return {
                result: signature,
                patch: { hash: signature, hashUrl: chainTxUrl(dest, signature) },
            };
        });
        if (mintHash === null) return;

        state.phase = 'done';
        updateTransfer(burnHash, { phase: 'done', mintTxId: String(mintHash) });
    }

    /**
     * Complete a transfer from just its burn hash: classify the hash shape,
     * probe candidate source domains on Iris, derive the route from the
     * response, then run the shared tail with only the wallet the mint needs.
     * Works for transfers started in other tools too.
     */
    async function resume(args: { burnHash: string; wallets: EngineWallets; recipient?: string }) {
        state.error = null;
        state.attestation = null;
        state.amount = '';
        state.speed = 'standard';
        state.flow = 'direct';

        const classified = classifyHash(args.burnHash);
        if (!classified) {
            fail(new TransferError('HASH_INVALID', { raw: args.burnHash }));
            return;
        }

        // Probe Iris across the candidate source domains. Sequential keeps
        // this far under Circle's rate limit; the shape filter usually leaves
        // one to four candidates.
        state.phase = 'attesting';
        let found: { domain: number; message: IrisMessage } | null = null;
        for (const domain of candidateDomains(classified.kind, getRegistry())) {
            try {
                const message = await fetchAttestation(domain, classified.normalized);
                if (message) {
                    found = { domain, message };
                    break;
                }
            } catch (err) {
                fail(translateError(err, {}));
                return;
            }
        }
        if (!found) {
            // Circle knows nothing. For an EVM shaped hash, look for the raw
            // transaction itself: a reverted receipt means nothing was ever
            // burned, and that honest answer beats a shrug.
            if (classified.kind === 'evm') {
                const receipt = await findEvmReceipt(
                    classified.normalized as `0x${string}`,
                    getRegistry().chains.filter((c) => c.family === 'evm'),
                ).catch(() => null);
                if (receipt?.reverted) {
                    fail(
                        new TransferError('BURN_REVERTED', {
                            userMessage: `This transaction ran on ${receipt.label} but failed on chain. Nothing was burned, the USDC never left the sending wallet.`,
                            raw: args.burnHash,
                        }),
                    );
                    return;
                }
                if (receipt) {
                    fail(
                        new TransferError('TX_NOT_A_BURN', {
                            userMessage: `This transaction exists on ${receipt.label}, but Circle has no burn recorded for it.`,
                            raw: args.burnHash,
                        }),
                    );
                    return;
                }
            }
            fail(
                new TransferError('HASH_INVALID', {
                    userMessage: 'Circle has no record of this burn yet on any supported chain.',
                    action: 'Check the hash, or wait a moment if the burn just happened and try again.',
                    raw: args.burnHash,
                }),
            );
            return;
        }

        const destDomainRaw = found.message.decodedMessage?.destinationDomain as
            string | number | undefined;
        const destDomain = Number(destDomainRaw ?? found.message.destinationDomain ?? NaN);
        const destSide = Number.isNaN(destDomain) ? undefined : chainByDomain(destDomain);
        const sourceSide = chainByDomain(found.domain);
        if (!destSide || !sourceSide) {
            fail(
                new TransferError('CONFIG_MISSING', {
                    userMessage: 'This transfer involves a chain this build does not support yet.',
                    raw: `source domain ${found.domain}, destination domain ${destDomain}`,
                }),
            );
            return;
        }

        state.sourceId = sourceSide === 'stellar' ? 'stellar' : sourceSide.id;
        state.destId = destSide === 'stellar' ? 'stellar' : destSide.id;
        state.steps = buildSteps(sourceSide, destSide, 'direct').map((s) => {
            if (s.key === 'approve')
                return { ...s, status: 'done' as const, detail: 'skipped (resumed)' };
            if (s.key === 'burn') {
                return {
                    ...s,
                    status: 'done' as const,
                    detail: 'skipped (resumed)',
                    hash: classified.normalized,
                    hashUrl: sideTxUrl(sourceSide, classified.normalized),
                };
            }
            return s;
        });
        state.burnTxId = classified.normalized;

        const recipient =
            args.recipient ??
            (destSide !== 'stellar' && (destSide as ChainEntry).family === 'solana'
                ? (args.wallets.solana?.address ?? '')
                : '');

        await runTail({
            source: sourceSide,
            dest: destSide,
            burnHash: classified.normalized,
            recipient,
            wallets: args.wallets,
            forwarded: false,
            forwardedBaseline: 0n,
            preAttested: found.message.status === 'complete' ? found.message : undefined,
        });
    }

    return {
        get state() {
            return state;
        },
        configure,
        reset,
        start,
        resume,
    };
}

export type TransferEngine = ReturnType<typeof createTransferEngine>;
export type { FlowKind, Step, StepStatus } from './core';
export type { SolanaChainEntry };
