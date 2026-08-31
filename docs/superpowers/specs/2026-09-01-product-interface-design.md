# Product interface design

**Goal:** replace the developer console layout with a calm, trustworthy, mobile friendly product: one transfer card, honest fees and ETAs up front, live preflight instead of after the fact errors, a first class rescue page, history, light and dark themes, and real accessibility.

Approved direction: single transfer card ("teller window"), wordmark lowercase `stellarusdcto`, USDC blue accent on graphite neutrals, both themes.

## Visual language

Bank teller window, printed receipt. IBM Plex Sans (variable, self hosted via Fontsource, no CDNs) for UI, IBM Plex Mono for amounts, hashes, and the wordmark. One accent: USDC blue. Light theme reads as paper, dark as the after hours desk. Depth comes from hairline borders and one soft shadow level, never glass or gradients. Route facts render as a settlement slip: label, dotted leader, value. Motion is restrained (fades, small slides, one progress bar) and fully disabled under prefers reduced motion.

Theme tokens live in `app.css` on the existing custom property names (so surviving components keep working), defined once with `light-dark()`; `color-scheme` on `:root` plus a `data-theme` override make system default, light, and dark all work with zero token duplication. An inline script in `app.html` applies the stored choice before first paint.

## Structure

- `src/routes/+layout.svelte` — header (wordmark, Testnet badge, Rescue link, History button, theme toggle) and footer (Circle docs, faucet, GitHub, credit to the original demo). Fonts imported here.
- `src/routes/+page.svelte` — the transfer card plus the signing details disclosure.
- `src/routes/rescue/+page.svelte` — the rescue surface: hash box front and center, then the same timeline; accepts `?hash=` and runs it.
- `src/lib/ui/wallets.svelte.ts` — the three wallet connections as shared singletons (ported logic from the old panels: detect, connect, provider picker, network switch, balances, sendCalls capability), consumed by the card, the rescue page, and history.
- `src/lib/ui/cta.ts` — the smart button ladder as a pure, unit tested function: connect source → switch network → enter amount → fix amount → insufficient balance → recipient checks → checking → send. The button always names the actual next step and is never silently disabled.
- Components: `TransferCard` (owns route state and the engine), `ChainSelect` (button + native dialog with search, built for the full chain roster, colored monogram badges from a new registry `accent` field), `AmountInput` (balance, Max, inline validation), `RecipientRow` (defaults to the connected destination wallet, editable to any address, live debounced preflight through the adapters with green/amber status lines), `RouteSummary` (settlement slip: Circle fee from the live API, arrival ETA, destination gas note, speed control where Fast exists, the auto delivery toggle for Stellar sources), `Timeline` (restyled progress with an attestation progress bar against the per chain ETA, aria live regions, inline claim wallet connect on the mint step), `HistoryPanel` (journal entries in a dialog, resume links into the rescue page).

Flow simplification: the send calls picker disappears; when the wallet advertises EIP 5792 bundling the app uses it and says so in one line, otherwise approve + burn. Fewer knobs, same engine.

## Accessibility and mobile

Radio groups with roving tabindex for the speed control, aria live polite on the timeline and assertive on errors, error text associated to fields, visible focus rings, 4.5:1 minimum contrast in both themes, 44px touch targets, native dialogs (focus trapping and Escape for free), heading order sane, keyboard complete. One column layout that is mobile first; the chain selector dialog becomes a bottom sheet under 560px; wallet empty states explain the in app browser path on mobile.

## Out of scope

The chain roster expansion (the selector is ready for it), WalletConnect, deep rescue diagnosis states, the mainnet switch (the header badge is built to take it), i18n. The engine, adapters, registry data (except the accent field), and journal are unchanged.
