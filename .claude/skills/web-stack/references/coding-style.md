# Coding Style

## Formatting (Prettier does it — don't fight it)

`prettier.config.mjs` is the source of truth. Run `bunx prettier --write <files>` after
editing. Key results:

- No semicolons. Double quotes in TS (`"use server"`), **single quotes in JSX attributes**
  (`className='flex gap-4'`).
- `printWidth: 90`, `trailingComma: "none"`, `bracketSameLine: true`, LF line endings.
  Block comments may run wider (they are written to about 110 columns); Prettier leaves
  them alone.
- Tailwind classes are auto-sorted, including inside `cls(...)` and `clsx(...)`.
- Imports are auto-grouped, separated by a blank line, in this order:

1. Node built-ins (`node:fs`, `node:path`)
2. Third-party packages (`next/navigation`, `zod`)
3. `@/` aliases
4. Relative (`../utils`, `./validator.nuqs`)
5. CSS (side-effect imports)

```ts
import fs from "node:fs"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { MEDIA_FOLDER } from "@/constants"

import { useStudioQuery } from "../hooks/use-studio-query"
import { queryValidator } from "./validator.nuqs"

import "@/styles/globals.css"
```

Sorting is done by `@ianvs/prettier-plugin-sort-imports`; the groups come from
`importOrder` in `prettier.config.mjs`. Two behaviours to know:

- **Side-effect imports (`import "…css"`) are never moved**, and imports aren't sorted
  across them. Write CSS imports last yourself.
- Duplicate imports from the same module are merged into one statement.

## TypeScript

- `strict` + `verbatimModuleSyntax`: type-only imports **must** use `import type { X }` or
  `import { type X }`.
- No `any`. Use `unknown` and narrow, or infer from the source of truth:
  `z.infer<typeof schema>`, `InferSelectModel<typeof table>`,
  `Awaited<ReturnType<typeof queryValidator.parse>>`.
- No non-null `!`. `noUncheckedIndexedAccess` is off, so `list[0]` is typed as always
  there: when the list can be empty, say so in the code (`ids[0] ?? null`,
  `if (!first) return …`).
- Types live next to what produces them: Zod types in `validator.zod.ts`, DB types in
  `drizzle/types.ts`, view models next to the reader that returns them
  (`actions/jobs/read.ts` → `JobDetail`, `AssetView`).
- Domain unions shared by the app, the worker and the schema are **global namespaces** in
  `src/types/schema.d.ts`: `Media.JobKind`, `Media.JobParams`, `Engine.Status`,
  `Engine.Event`. Use them without importing. App-wide helper types are in
  `src/types/app.d.ts` (`Pagination<T>`, `NextSearchParams`).
- Props are typed inline and wrapped in `Readonly<{ … }>`:

```tsx
export function FieldRow({
  label,
  children
}: Readonly<{
  label: string
  children: React.ReactNode
}>) {
```

- Page/layout props use the global helpers: `NextSearchParams`,
  `NextParams<{ slug: string }>`. Route Handlers use `RouteContext<"/api/media/[id]">`.
- `type` over `interface`. A fixed set of values is an `as const` list in
  `constants/<domain>.ts` checked against its union
  (`[...] as const satisfies readonly Media.JobKind[]`).
- Numeric separators for readability: `4_000`, `3_600_000`.

## Naming

| Thing                     | Convention                          | Example                                      |
| ------------------------- | ----------------------------------- | -------------------------------------------- |
| Components                | PascalCase function                 | `JobCanvas`, `ReferencePicker`               |
| Page / layout components  | PascalCase, named after the route   | `Studio`, `Gallery`, `StudioLayout`          |
| Hooks                     | `useX`                              | `useEngine`, `useStudioQuery`                |
| Server Actions            | verb + noun, camelCase              | `createJob`, `readGallery`, `updateFavorite` |
| Zod schemas / their types | `xValidator` / `XValidator`         | `imageValidator` / `ImageValidator`          |
| nuqs caches / their types | `queryValidator` / `QueryValidator` |                                              |
| Constants                 | SCREAMING_SNAKE_CASE                | `REDIS_KEYS`, `IMAGE_SIZES`                  |
| Booleans                  | `is` / `has` / `should` prefix      | `isFast`, `hasCutouts`, `shouldSaveFrames`   |
| Event handlers            | `handleX`                           | `handleSubmit`, `handleReferencesChange`     |
| DB columns                | camelCase in TS, snake_case in SQL  | `isFavorite: boolean("is_favorite")`         |

## Exports

- Named exports for everything shared (`export function JobCanvas`).
- `export default` only where Next.js requires it (`page`, `layout`, `error`, `not-found`,
  route config).

## Comments

Never write one-line JSDoc comments. Use the multi-line block form, even for a single
sentence:

```ts
/**
 * Jobs the worker still has to finish.
 */
```

Or a line comment:

```ts
// BRPOP holds its connection for the whole wait, so the queue gets one of its own
```

Not:

```ts
/** Jobs the worker still has to finish. */
```

- Comment the **why** (constraints, trade-offs, non-obvious behaviour), not the what.
  Things learned the hard way about a model belong here, next to the code they explain
  ("edits sample with `euler`: `er_sde` gave burnt results").
- Public helpers in `libs/` and `actions/` get JSDoc with `@param`, `@returns`, and an
  `@example` when usage isn't obvious.
- No commented-out code and no `TODO` in finished work.

## Component and hook body order

Order inside a component or hook, unless there's a reason to deviate:

1. **State** — props destructuring, store selectors, `useState`, `useRef`, derived values
   (`useMemo`), other hooks (`useStudioQuery`, `useForm`).
2. **Functions** — handlers and callbacks (`useCallback`), then effects (`useEffect`).
3. **Render / return** — early returns first (`if (!asset) return …`), then JSX.

## React rules

- Server Components by default. Add `"use client"` only to the leaf that needs state,
  effects, or browser APIs — never to a page or layout.
- **No React Compiler.** Memoize manually: `useCallback` for handlers passed to children
  or used in effects, `useMemo` for derived objects/arrays and for objects returned from
  hooks (see `useStudioQuery`).
- Dependency arrays must be complete. A missing dependency is a stale-closure bug, not a
  style choice.
- Clean up every effect: listeners, intervals, timeouts, `EventSource`, object URLs.
- Don't use `useEffect` to derive state from props — compute it during render or with
  `useMemo`.
- State that belongs to one item resets by **key**, not by effect: the canvas is rendered
  as `<JobCanvas key={job.id} …>`.
- Keys are stable IDs from the DB, never array indexes for dynamic lists.
- Context is rendered as `<StoreContext value={…}>` (React 19), not
  `<StoreContext.Provider>`.

## Styling

- Tailwind utilities in JSX; merge conditional classes with `cls()` from `@/libs/utils`
  (clsx + tailwind-merge).
- Colours come from HeroUI's tokens, which `src/styles/theme.css` maps onto the palette:
  `bg-background`, `bg-surface`, `bg-surface-secondary`, `text-foreground`, `text-muted`,
  `border-border`, `border-separator`, `bg-accent text-accent-foreground`, `text-danger`.
  The raw palette is there too (`bg-night`, `text-frost`, `border-glacier`) for the few
  places a token doesn't fit. Never hard-code a hex value in a component.
- Other tokens (container widths, animations, keyframes) go under `@theme` in `theme.css`.
- Reusable multi-utility patterns go in `src/styles/custom.css` under `@layer components`
  with a `use-` prefix (`.use-panel`, `.use-checkerboard`, `.use-dot-grid`). Overrides of
  a HeroUI component's own CSS variables go there too.
- The app is dark-only (`<html class='dark' data-theme='dark'>`).
- Use `svh`/`dvh` units for full-height layouts (`min-h-svh`).

## Errors

- Expected failures in Server Actions are **returned**, not thrown:
  `return { ok: false as const, message: "…" }`, with
  `errors: z.flattenError(error).fieldErrors` when a form can show them per field. The
  caller shows `message` in a toast (`toast.danger`).
- A failed job is data, not an exception: the worker stores the reason in `jobs.error` and
  the canvas shows it.
- Unexpected errors bubble to `app/error.tsx`.
- Logging on the server and in the worker uses `logger()` from `@/libs/logger`, never bare
  `console.log`. Scripts in `tests/` may print with `console`.

## Environment variables

Read env only through `@/constants/env` (`ENV`, `DB`, `REDIS`, `COMFY`, `DATABASE_URL`),
which are parsed by Zod in `constants/env/validator.zod.ts`. When adding a variable: add
it to `.env.example`, add it to the Zod schema with a sensible default, export it from
`constants/env/index.ts`. Never import `@/constants/env` from a Client Component — only
`NEXT_PUBLIC_*` values are allowed on the client.
