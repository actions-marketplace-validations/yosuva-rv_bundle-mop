# Bundle Mop on real apps

Before launch we ran `bundle-mop compare` on real pull requests in large open-source Next.js 16.4+ apps. The goal was
to find what breaks outside our fixtures. Every bug we found is fixed in 0.2.1 and 0.2.2.

| App | Size | PR tested | Result |
| --- | --- | --- | --- |
| [shadcn/ui](https://github.com/shadcn-ui/ui) (`apps/v4`) | 33 routes, ~24,000 modules, ~200 MB export | Next.js 16.4.2 → 16.4.5 | ✅ correct report, 0 false suggestions |
| [Dify](https://github.com/langgenius/dify) (`web`) | 92 routes, export over 512 MB | Lexical editor 0.47 → 0.53 | ✅ found a real +67 kB regression and why |

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

### Does the suggestion actually work?

We applied the suggestion to Dify and measured it with `bundle-mop compare --base HEAD`.

**The snippet was wrong; the idea was right.** Bundle Mop proposed `dynamic(() => import('./note-editor/context'))`.
Pasted as-is, that breaks the app: the file's default export is a React context, not a component, and the editor and
toolbar files next to it import Lexical too. We applied the intent instead: we lazy-loaded the whole note node at the
two places the workflow editor mounts it.

```tsx
import dynamic from 'next/dynamic'
// Lazy: notes pull in the Lexical editor, and most workflows have no notes.
const CustomNoteNode = dynamic(() => import('./note-node'))
```

| Routes | First-load JS |
| --- | --- |
| Workflow editor, pipeline and snippet editor (3 routes) | **−205 to −210 kB (−6%)**, e.g. 3.46 MB → 3.25 MB |
| 11 other routes (`/datasets`, `/agents/*`, `/app/[appId]/configuration`, …) | +12 to +26 kB (+0.3% to +1.9%) |
| The other 78 routes | under 1 kB |

The saving is 3.6× what the suggestion predicted (58 kB): Lexical, its plugins and the note editor all left the
first load. The growth elsewhere comes from Turbopack's chunking. No import on those routes changed. One new async
boundary changed how shared code is split into chunks, and some modules that used to load lazily now sit in chunks
that load up front.

What this taught us, and what we changed (after 0.2.1):

- **The snippet named the wrong file.** `lazy-load-candidate` named the file that imports the package. Now it looks for
  the deepest file that every static import of the package goes through, and lists every file that imports it. On
  this route there is no such file: 50 files import Lexical, including Dify's prompt editor. So Bundle Mop now says
  that, lists the files, and doesn't guess a snippet. On our moment fixture it names the component to wrap and
  estimates the saving (61.6 kB, exactly moment plus the component).
- **Why the measured saving was bigger.** By static imports alone, lazy-loading the note node removes almost nothing:
  Lexical is still needed elsewhere on the route. The 210 kB came from a duplicate copy of Lexical that Turbopack had
  placed in a second up-front chunk. A static estimate can't predict that, so Bundle Mop doesn't claim to.
- **Chunking isn't an import change.** On the 11 routes that grew, `lost-lazy-loading` said "a static import pulls
  it into first-load JS". Now it checks static reachability in both branches. If nothing changed, it says the
  bundler re-split chunks, as info. Packages that only grew from extra chunk copies (es-toolkit, @tanstack/hotkeys,
  foxact) are no longer flagged.

## What we learned

- **Big apps are big.** Exports range from 200 MB to more than 512 MB, and `next analyze` takes 10–15 minutes on a
  laptop. Caching the base matters: repeat runs drop to about a minute.
- **Framework upgrades need their own explanation.** Otherwise, every package looks like it changed.
- **Measure the fix, not just the problem.** On Dify, Bundle Mop's suggestion pointed at the right feature and
  saved 210 kB, but its code snippet needed rework, and the change moved a few kB onto other routes.
- **Advice must be checked against how the app really imports things.** "Many modules from one package" is not the
  same as "a barrel import".
- **Monorepos need setup.** Install flags and engine pins (Dify wants Node 24) go in `--install-command`. The Action
  and the CLI both accept one.
