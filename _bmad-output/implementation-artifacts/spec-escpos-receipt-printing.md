---
title: 'ESC/POS direct thermal receipt printing with browser-print fallback'
type: 'bugfix'
created: '2026-08-21'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 'a1b4446dc8043edcb4fe2a42577d6c2bd56c487c'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** POS receipts print faint/blurry on thermal printers because `printReceipt()` sends a rasterized HTML page through `window.print()`; other POS software sends raw ESC/POS commands and prints crisp text on identical hardware.

**Approach:** Add a pure ESC/POS byte encoder beside the existing HTML receipt builder plus a WebUSB transport writing bytes straight to USB thermal printers. `printReceipt()` tries ESC/POS first (paired device, or grant within the click gesture) and falls back to the existing `window.print()` path whenever no ESC/POS-capable printer is available.

## Boundaries & Constraints

**Always:**
- Build ESC/POS output from the same `{ receipt, business, settings }` contract as `buildReceiptHtml()` — one source of truth for receipt content (business info, items, totals, payment method, footer).
- Fall back to the existing `window.print()` path when WebUSB is unsupported, the picker is cancelled/denied, or connection fails before any bytes are sent.
- Never open the browser dialog after a successful `transferOut()` — duplicate-receipt risk.
- Line width from `settings.receipt_width`: `'58'` → 32 chars, `'80'` → 48 chars.
- Feedback via existing `useToast` hook; failures logged with `console.error`.
- Both entry points keep working: post-sale "Print receipt" and "Reprint" from Recent Sales.

**Ask First:**
- Any npm dependency (plan adds none).
- Transports beyond WebUSB (Web Serial, Bluetooth, LAN port 9100).
- DB/settings changes (e.g., new `business_settings` print-mode column).

**Never:**
- Electron/Capacitor/Cordova shell; service worker changes.
- Changes to `consultationPrint.js` or `Demand.jsx` print paths.
- TypeScript, new UI libraries.
- Staff login issue (deferred separately in `deferred-work.md`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Paired printer, Chromium, click "Print receipt" | Bytes sent via `transferOut`; paper cut; success toast; no dialog | N/A |
| UNSUPPORTED_BROWSER | `navigator.usb` undefined (Firefox/Safari/iOS) | Legacy `window.print()` flow exactly as today | N/A |
| PICKER_CANCELLED | User dismisses device picker | Legacy dialog opens; info toast; no error toast | `NotFoundError` = fallback trigger, not failure |
| TRANSFER_FAILS_MIDWAY | Interface claimed, `transferOut` rejects | Error toast; console.error; browser dialog must NOT open | Error toast, no reprint |
| WIDTH_58MM | `receipt_width === '58'` | All printable lines ≤ 32 columns | N/A |
| LONG_ITEM_NAME | Name exceeds column budget | Wraps onto continuation lines; price stays aligned | N/A |
| NON_ASCII_TEXT | Accented/CJK chars in names | Folded to base ASCII (é→e) else `'?'`; never mangled bytes | N/A |
| OFFLINE_REPRINT | Reprint of offline-queued sale | Same ESC/POS path from rebuilt receipt object | Standard fallback rules |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/modules/pos/POS.jsx` -- `printReceipt()` L424–429 (window.open + document.write + print); call sites L524 (post-sale), L601–621 (reprint rebuilds receipt from sale row); settings load L124–130
- `apps/carehub/src/modules/pos/receiptPrint.js` -- pure `buildReceiptHtml({ receipt, business, settings })` L29; `computeTax` L11; width selection L33. Content-parity reference — do not modify
- `apps/carehub/src/modules/pos/receiptPrint.test.js` -- Vitest style to mirror
- `apps/carehub/src/modules/pos/receiptEscpos.js` -- NEW pure encoder → Uint8Array
- `apps/carehub/src/modules/pos/escposUsb.js` -- NEW WebUSB transport, injectable usb dependency
- `apps/carehub/src/hooks/useToast.js` -- `show(message, { type, duration })`; import via `../../components/ui`
- `apps/carehub/src/lib/utils.js` -- `fmt`, `nowStr` for formatting parity
- `knowledge/modules/point-of-sale.md` -- docs target (stale paths today; new section uses real ones)

## Tasks & Acceptance

**Execution:**
- [ ] `apps/carehub/src/modules/pos/receiptEscpos.js` -- Create pure `buildReceiptEscpos({ receipt, business, settings })` → Uint8Array: `ESC @` init; centered bold double-size business name; address/phone/header lines; txn id/date/client; item rows (name wrapped, qty × price right-aligned); subtotal/discount/total; display-only tax lines via `computeTax`; payment block (cash given/change, credit paid/balance, split entries >0); refund policy + footer; feeds + `GS V` partial cut. ASCII-folding helper; 32/48-column layout from `receipt_width` -- single testable source of command construction
- [ ] `apps/carehub/src/modules/pos/escposUsb.js` -- Create transport: `isEscposUsbSupported()`; `getPairedPrinters()` filtering `navigator.usb.getDevices()` to interface class 7; `requestPrinter()` wrapping `requestDevice({ filters: [{ classCode: 7 }] })`, returns null on `NotFoundError`; `printEscpos(bytes, device)` doing `open()` → `selectConfiguration(1)` → `claimInterface()` → first OUT endpoint → `transferOut()`. Injectable usb-like object (default `navigator.usb`) for hardware-free tests
- [ ] `apps/carehub/src/modules/pos/POS.jsx` -- Rework `printReceipt(r)` async per the I/O matrix: paired → encode+send with loading/success toasts; supported-but-unpaired → `requestPrinter()` inside click gesture, grant → send, cancel → legacy `window.open`/`buildReceiptHtml`/`window.print()` path; unsupported → legacy immediately; pre-transfer failure → console.error + warning toast + legacy fallback; after successful `transferOut` never fall back; disable print buttons while sending -- zero regression for non-Chromium users
- [ ] `apps/carehub/src/modules/pos/receiptEscpos.test.js` -- Tests mirroring `receiptPrint.test.js`: init/header sequence, 32 vs 48 columns, long-name wrap, cash/credit/split/tax variants, non-ASCII folding, cut bytes present -- proves encoder without hardware
- [ ] `apps/carehub/src/modules/pos/escposUsb.test.js` -- Mock-device tests: happy-path bytes reach `transferOut`; unsupported env → false; cancelled picker → null; `transferOut` rejection propagates -- locks transport contract
- [ ] `knowledge/modules/point-of-sale.md` -- Add "Receipt Printing" section: ESC/POS-first flow, fallback rules, Chromium-only note, pairing behavior, correct current paths

**Acceptance Criteria:**
- Given a paired ESC/POS USB printer in Chrome/Edge, when "Print receipt" is clicked, then raw commands reach the printer producing sharp dark text with auto-cut and no browser dialog appears
- Given `navigator.usb` is unavailable, when printing from either entry point, then behavior is identical to today's `window.print()` flow
- Given the user cancels the device picker, when the gesture completes, then the legacy dialog opens exactly once and no error toast shows
- Given `transferOut` succeeded, when any later step fails, then the browser dialog must NOT also open
- Given `receipt_width` `'58'` (default/unset `'80'`), when encoding, then all printable lines fit 32 (or 48) columns
- Given `npm test` in `apps/carehub`, when the suite runs, then all tests pass with no regressions

## Spec Change Log

## Design Notes

Transport rationale: CareHub is a plain HTTPS web app (Vercel), no native shell. Raw TCP 9100 is impossible from the sandbox; Web Bluetooth cannot reach Bluetooth-Classic/SPP printers (most thermal units); WebUSB reaches USB class-7 printers needing only Chromium + HTTPS + user gesture — printing is button-driven, satisfying the gesture requirement. Pairing persists per-origin via `navigator.usb.getDevices()`, so only the first print shows the picker.

Command sketch:

```
1B 40              ESC @   init
1B 61 01           center
1D 21 11           double size (business name)
1B 45 01 / 00      bold on/off
1B 61 00           left align body
...items, totals, payment...
0A 0A              feed
1D 56 42 00        GS V partial cut
```

Encoding: fold Latin-1 accents to base ASCII (é→e); unmappable → `?`. CP437-safe output avoids garbage glyphs across firmware. Endpoint discovery: scan claimed interface alternate for `direction === 'out'`; claim failures count as pre-transfer failure (fallback allowed).

## Verification

**Commands:**
- `npm test` (in `apps/carehub`) -- expected: all suites green including new `receiptEscpos`/`escposUsb` tests
- `npm run build` (in `apps/carehub`) -- expected: production build succeeds

**Manual checks (if no CLI):**
- Real 80mm USB thermal printer in Chrome: first print shows picker; later prints skip it; output darker/sharper than `window.print()` baseline; auto-cut fires
- Firefox: print dialog opens exactly as before
