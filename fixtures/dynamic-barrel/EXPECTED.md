# fixtures/dynamic-barrel: expected facts

Captured with Next.js 16.4.6 (`__snapshots__/analyze/base/`). Future adapter and diff tests
should assert these facts. If a Next upgrade changes them, update this file in the same
commit as the regenerated snapshot and say so.

## Patterns (intentional, do not fix)

```
app/lazy/page.tsx                    [app-rsc]
→ components/LazyClient.tsx          ("use client" boundary)
  ├─ sync  → components/ui/index.ts  (barrel, ident suffix " <locals>")
  │            ├─ sync → ui/Badge.tsx    (used)
  │            └─ sync → ui/Unused.tsx   (re-exported only, tree-shaken)
  └─ async → components/ui/Heavy.tsx (next/dynamic entry)
               └─ sync → moment/moment.js
```

## Facts for `/lazy` (raw bytes)

| Fact | Value |
|---|---|
| `async` groups | 1, trigger `ui/Heavy.tsx [app-client] (ecmascript, next/dynamic entry)` |
| moment part | 61,346 B, only in the async group's chunk, so **lazy** |
| Client total, all `[client-fs]` parts (= `route-summaries.json`) | 635,263 |
| Lazy-only chunks | 61,657 |
| **First-load JS** (total minus lazy-only chunks) | **573,606** |
| First-load vs `/` (576,300) | −2,694 (`/` ships `next/link` client code; `/lazy` doesn't) |
| `ui/Unused.tsx` part | **11 B**: an edge exists, but the code was tree-shaken |
| `ui/Badge.tsx` part | 58 B |
| `ui/index.ts` (barrel) part | none |

## What a correct Bundle Mop must do here

- Report moment as **lazy**, not first-load. Don't flag `/lazy` as +61 KB first-load.
- Don't blame the barrel for `Unused.tsx`: it shipped 11 bytes.
- Keep chunks that belong to no group (for example the 112 KB framework chunk) in first-load.
