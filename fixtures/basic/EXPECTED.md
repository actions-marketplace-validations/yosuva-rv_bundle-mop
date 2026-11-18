# fixtures/basic: expected facts

Captured with Next.js 16.4.6 (`__snapshots__/analyze/base/`). If a Next upgrade changes these,
update this file in the same commit as the regenerated snapshot and say so.

## Pattern (intentional, do not fix)

```
app/dashboard/page.tsx               [app-rsc]
→ components/DashboardClient.tsx     ("use client" boundary: client reference proxy)
→ components/DatePicker.tsx          [app-client]
→ moment/moment.js                   [app-client]  (eager: no async groups on this route)
```

## Facts (raw bytes, `[client-fs]` parts)

| Fact | Value |
|---|---|
| `/` client total | 576,405 |
| `/dashboard` client total (no lazy chunks, so this is also first-load) | 630,550 |
| `/dashboard` vs `/` | +54,145 |
| moment part on `/dashboard` | 61,346 (compressed part 19,308) |
| `moment.js [app-client]` sync deps | none (the `[app-ssr]` copy pulls every locale) |

## What a correct Bundle Mop must do here

- Blame moment for the `/dashboard` growth, with the full chain above.
- Suggest a lighter date library or a scoped import, and point out the `"use client"` boundary.
