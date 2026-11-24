# Bundle Mop on real apps

Before launch we ran `bundle-mop compare` on real pull requests in large open-source Next.js 16.4+ apps. The goal was
to find what breaks outside our fixtures. Every bug we found is fixed in 0.2.1.

| App | Size | PR tested | Result |
| --- | --- | --- | --- |
| [shadcn/ui](https://github.com/shadcn-ui/ui) (`apps/v4`) | 33 routes, ~24,000 modules, ~200 MB export | Next.js 16.4.2 → 16.4.5 | ✅ correct report, 0 false suggestions |
| [Dify](https://github.com/langgenius/dify) (`web`) | 92 routes, export over 512 MB | Lexical editor 0.47 → 0.53 | ✅ found a real +67 kB regression and why |
| [Cal.com](https://github.com/calcom/cal.com) (`apps/web`) | the largest of the three | Next.js 16.4.3 → main | ⚠️ PR side analyzed fine; the base install failed on our test machine |

## shadcn/ui: a Next.js patch upgrade

- **Headline:** `/docs/[[...slug]]` first-load JS +30.4 kB.
- **The report says why:** "This PR changes Next.js 16.4.2 → 16.4.5." A new compiler re-minifies every package
  slightly, so packages that only drifted in size are not blamed.
- **Sanity check:** the live `ui.shadcn.com/docs` page loads about 14 MB of decoded JS. Bundle Mop's ~9 MB of
  first-load JS for that route is realistic.

Bugs this run found:

- **Crash:** API routes (`route.ts`) have no `entry_kind`, and one of them stopped the whole run.
- **Fonts and CSS counted as JS:** about 0.5 MB per route was wrongly counted.
- **Fake changes:** hashed Next/Turbopack file names appeared as "removed + added" pairs on every build.
- **Wrong headline:** the report led with a Next-internal route (`/_global-error`).
- **False suggestions:** compiler drift after the upgrade triggered suggestions.
- **Slow diff:** 1 min 28 s, now 5.5 s (16× faster) with an index for import chains.

## Dify: a dependency upgrade that grew the editor

- **Headline:** the workflow editor (`/app/[appId]/workflow` and two sibling routes) +66.9 kB first-load JS. About 20
  chat and app routes grew by +35.1 kB.
- **Why:** Lexical 0.53 resolves to its `.prod.js` builds instead of `.prod.mjs`, and those are bigger. For example,
  `lexical/dist/Lexical.prod.js` is +384 kB and `Lexical.prod.mjs` −326 kB on the same route.
- **Import chain:** each change comes with the path through Dify's code:
  `workflow/page.tsx → workflow-app/index.tsx ("use client") → workflow/index.tsx → note-node/index.tsx → note-editor/context.tsx → lexical`.
- **Suggestion:** lazy-load `note-editor/context.tsx` with `next/dynamic` to keep Lexical (58 kB) out of the
  editor's first load.

Bugs this run found:

- **Crash on huge exports:** Dify's analysis is larger than the longest string Node can hold (~512 MB). Exports are
  now read line by line from bytes.
- **Wrong advice:** Bundle Mop suggested `optimizePackageImports` for `@lexical/react`, which Dify already imports by
  subpath. The rule now fires only for real barrel imports.

Timing: a first run took 12 min 45 s (two production builds). The next run reused the cached base analysis and took
1 min 15 s, about 45 s of which was `next analyze` on the branch.

## Cal.com

The branch side (`next analyze` on main, 9.6 min) parsed without errors. The base checkout's `yarn install` was
interrupted on our Windows test machine, which ran out of resources. That is not a Bundle Mop issue, but it means we
have no full Cal.com report yet.

Setup notes for anyone who tries it: Cal.com needs placeholder env vars at build time (`NEXTAUTH_SECRET`,
`CALENDSO_ENCRYPTION_KEY`, `NEXTAUTH_URL`, `NEXT_PUBLIC_WEBSITE_URL`, `EMAIL_FROM`) and a generated Prisma client:

```sh
bundle-mop compare --base <ref> --install-command "yarn install --immutable --mode=skip-build && yarn workspace @calcom/prisma prisma generate"
```

## What we learned

- **Big apps are big.** Exports range from 200 MB to more than 512 MB, and `next analyze` takes 10–15 minutes on a
  laptop. Caching the base matters: repeat runs drop to about a minute.
- **Framework upgrades need their own explanation.** Otherwise, every package looks like it changed.
- **Advice must be checked against how the app really imports things.** "Many modules from one package" is not the
  same as "a barrel import".
- **Monorepos need setup.** Env vars, code generators (Prisma) and engine pins (Dify wants Node 24) all appear in
  `--install-command`. The Action and the CLI accept one.
