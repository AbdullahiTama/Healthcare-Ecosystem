# Motion

## Philosophy

Per Design Principle 8: **motion explains state, it doesn't perform.** Every animation in this system must answer "what would the user be confused about if this happened instantly instead?" If the honest answer is "nothing," the animation shouldn't exist. This is the single biggest lever against the "over-animated, AI-generated" feeling the brief explicitly warns against — restraint here is not a stylistic preference, it's a hard requirement.

## Timing scale

| Token | Duration | Usage |
|---|---|---|
| `motion-instant` | 0ms | State changes that should feel immediate (checkbox toggle visual, button press) |
| `motion-fast` | 120–150ms | Micro-interactions — hover states, toggle switches, small color/opacity transitions |
| `motion-base` | 200ms | Default transition — dropdown open/close, tab switch, accordion expand |
| `motion-slow` | 280–320ms | Modal/drawer enter-exit, larger layout shifts |

**Nothing in this system exceeds ~320ms.** Enterprise software (Stripe, Linear) consistently uses fast, snappy transitions specifically because slower animation reads as sluggish to a repeat user performing the same action for the hundredth time (Principle 13). A 600ms "delightful" animation on day one becomes an obstacle by week two.

## Easing

- **Default:** `ease-out` (fast start, gentle finish) for anything entering the screen (modals opening, dropdowns appearing, toasts sliding in) — matches how physical objects settle, feels natural without calling attention to itself.
- **Exit:** `ease-in` (gentle start, fast finish) for anything leaving the screen.
- **Never** a bounce, spring-overshoot, or elastic easing curve anywhere in this system — these read as playful/consumer, wrong register for both a professional tool and a trust-building healthcare discovery product.

## What gets animated

| Interaction | Motion |
|---|---|
| Modal/drawer open | Fade backdrop (`motion-base`) + slide/scale content (`motion-slow`) |
| Dropdown/popover open | Fade + slight scale (`motion-fast`) |
| Toast appear/dismiss | Slide + fade (`motion-base`) |
| Tab switch | Content crossfade only if content genuinely differs in a way worth signaling (`motion-fast`); prefer instant switch for simple text-tab content |
| Toggle switch | Thumb slide (`motion-fast`) — already implemented this way in the existing `Toggle` component, correct as-is |
| Button hover/press | Background color transition only (`motion-fast`), no scale/transform |
| Page-to-page navigation | No transition — instant. Page transitions are a common over-animation trap; both products are tools, not narrative experiences |
| Loading states | See below |
| Data updating in a table/list | No animation — new/changed data appears immediately. Animating every data refresh in a frequently-polled dashboard becomes visual noise fast |

## Loading motion specifically

- **Skeleton screens**, not spinners, for initial content load of a known-shape layout (a table about to show rows, a card about to show data) — a skeleton communicates *what's coming* and roughly *how much*, a spinner communicates only "wait."
- **Spinners** are acceptable for: button-level loading (a "Save" button showing a small inline spinner while a request is in flight), and genuinely indeterminate short waits.
- **Skeleton shimmer**, if used, is a slow, subtle opacity pulse (1.5–2s cycle) — never a fast, attention-grabbing shimmer sweep.

## What this system explicitly avoids

- **No animation on page load** beyond content simply appearing (no staggered fade-ins of dashboard cards one after another, no "reveal" animations for stat numbers counting up from zero).
- **No decorative motion with no state to explain** — floating background shapes, parallax scroll effects, animated gradients. None of this belongs in either product.
- **No animation that blocks interaction.** A user should never have to wait for an animation to finish before they can act — if a transition takes 300ms, the underlying control should already be interactive during that window, not gated behind the animation completing.
- **Respect `prefers-reduced-motion`.** Every animation in this system must have a reduced-motion fallback that either removes the transition or reduces it to an opacity-only change — this is an accessibility requirement (`ACCESSIBILITY.md`), not optional polish.
