# fixtures/basic-before: expected facts

The **base** state for diff tests. `fixtures/basic` is the **PR** state: the same app, but
`components/DatePicker.tsx` swaps native `Intl` for `moment`. Captured with Next.js 16.4.6.
If a Next upgrade changes these numbers, regenerate both snapshots in one commit and update this file.

## Diff `basic-before` → `basic`

| Fact | Value |
|---|---|
| Routes | 1 changed (`/dashboard`), 3 unchanged |
| `/dashboard` first-load | 569,297 → 630,550 (**+61,253**) |
| `pkg:moment/moment.js` | **added**, +61,346 first-load |
| `app:components/DatePicker.tsx` | changed, −64 (moment call vs Intl) |
| `app:components/DashboardClient.tsx` | changed, −29: **minifier noise**, the source is identical |
| Package rollup | `pkg:moment` added, +61,346 |
| `/`, `/_not-found`, `/_global-error` | unchanged, no module changes |

## What a correct Bundle Mop must do here

- Put moment at the top of `/dashboard`'s changes, marked as added.
- Not report anything for the untouched routes.
- (Report layer) Hide tiny changes like the −29 B in unchanged source behind a noise threshold.
