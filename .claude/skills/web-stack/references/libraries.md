# Libraries

Version-specific usage for everything except Next.js ([nextjs.md](nextjs.md)), Drizzle
([database.md](database.md)), and UI components ([ui-components.md](ui-components.md)).
Install with `bun add <pkg>`; ask before adding a dependency that duplicates one below.

## Zod v4

```ts
import { z } from "zod"

export const jobIdValidator = z.object({ id: z.uuid() })

export type JobIdValidator = z.infer<typeof jobIdValidator>
```

v4 differences from v3 (don't use the v3 forms):

| v3                               | v4                                                 |
| -------------------------------- | -------------------------------------------------- |
| `z.string().email()` / `.uuid()` | `z.email()`, `z.uuid()`, `z.url()` (top-level)     |
| `error.flatten()` / `.format()`  | `z.flattenError(error)`, `z.treeifyError(error)`   |
| `{ message: "…" }`               | `{ error: "…" }` (message still works, deprecated) |
| `z.nativeEnum(Enum)`             | `z.enum(Enum)`                                     |
| `.passthrough()` / `.strict()`   | `z.looseObject()` / `z.strictObject()`             |

- `safeParse` in Server Actions (return errors); `parse` for env and trusted internal data
  (throw).
- One schema serves both client (react-hook-form resolver) and server (action) — import
  the same validator. Job forms live in `actions/jobs/validator.zod.ts`: one validator per
  kind (`imageValidator`, `videoValidator`, `cutoutValidator`) and `jobValidator`, their
  discriminated union on `kind`, which is what `createJob` parses.
- Validators take their allowed values from `@/constants` (`z.enum(ASPECTS)`); they don't
  define lists.

## nuqs v2 — URL state

One `validator.nuqs.ts` per route exports the **parsers** and the server cache built from
them, so the page and its client hooks read the URL the same way:

```ts
import { createSearchParamsCache, parseAsString, parseAsStringLiteral } from "nuqs/server"

import { JOB_KINDS } from "@/constants"

export const studioParsers = {
  mode: parseAsStringLiteral(JOB_KINDS).withDefault("image"),
  job: parseAsString,
  asset: parseAsString
}

export const queryValidator = createSearchParamsCache(studioParsers)

export type QueryValidator = Awaited<ReturnType<typeof queryValidator.parse>>
```

```ts
"use client"

const [isPending, startTransition] = useTransition()
const [query, setQuery] = useQueryStates(studioParsers, {
  shallow: false,
  startTransition
})
```

- `shallow: false` when the server must re-render with the new params (the selected job,
  gallery filters, the page). Pass `{ shallow: true }` per call for a change only the
  client cares about (which form is showing).
- Wrap the route's `useQueryStates` in one hook with named setters (`useStudioQuery` →
  `setMode`, `showJob`) instead of calling `setQuery` from components.
- A filter change resets the page: `setQuery({ kind, page: null })`.
- `NuqsAdapter` is already mounted in `app/layout.tsx`.
- Use URL state for anything shareable or worth keeping across a reload (selected job,
  mode, filters). Use zustand for live state (engine status, progress).

## react-hook-form v7

```tsx
"use client"

const form = useForm<ImageValidator>({
  resolver: zodResolver(imageValidator),
  defaultValues: IMAGE_FORM_DEFAULTS
})
const [aspect, tier] = useWatch({ control: form.control, name: ["aspect", "tier"] })

const handleSubmit = useMemo(
  () =>
    form.handleSubmit(async (values) => {
      const result = await createJob(values)
      if (!result.ok) {
        toast.danger(result.message)
        return
      }

      void showJob(result.ids[0] ?? null)
    }),
  [form, showJob]
)
```

- Use `register` for native inputs (`TextArea`, `Input`). HeroUI's controlled components
  (toggle groups, switches, number fields, selects) are wired with `useWatch` for the
  value and `form.setValue` in a `useCallback` handler — no `Controller`.
- Don't `watch()` the whole form — subscribe to the fields the render needs with
  `useWatch({ name: [...] })`.
- Defaults live in the route's `utils.ts` (`IMAGE_FORM_DEFAULTS`), so "reuse settings" can
  reset onto them: `form.reset({ ...IMAGE_FORM_DEFAULTS, ...fromJob })`.
- All of a route's forms stay mounted and the inactive ones are hidden (`hidden`), so
  switching modes never loses what was typed.

## zustand v5 — client state

Store-per-request through context (never a module-level global store — it would leak
between requests on the server). Follow `src/stores/studio/`:

- `state.ts`: `State` and `Actions` types, `createXStore(initialState)` with
  `createStore<XState>()(…)`.
- `index.tsx`: `"use client"`, context, `XStoreProvider` holding the store in `useRef`,
  `useXStore(selector)`. `@/hooks` re-exports it as `useStore`.
- Always select the smallest slice: `useStore((state) => state.jobs[id]?.status)`.
  Selecting the whole state re-renders on every progress event. For multiple fields use
  `useShallow` from `zustand/react/shallow`.
- The store holds what the **event stream** says (engine status, live job status and
  progress) plus one-shot requests between components (`prefill`). Data the server
  rendered stays in props; when both exist, the live value wins.

## Tailwind CSS v4

- CSS-first config — there is no `tailwind.config.js`. `globals.css` imports
  `tailwindcss`, then `@heroui/styles`, then `theme.css` and `custom.css`.
- v4 syntax: `bg-(--my-var)`, `max-sm:`, `not-*:`, `starting:`. Opacity via slash:
  `bg-night/70`.
- Size images with their real `width`/`height` and let CSS scale them, so layout is
  reserved before they load.
- Colour tokens are HeroUI's; see [ui-components.md](ui-components.md#theme).

## Keyline icons

```tsx
import { ImageSparkles, Scissors } from "@keyline-icons/react"
import { Play, Star } from "@keyline-icons/react/fill"

;<Scissors size={15} strokeWidth={1.75} />
```

- Outline icons come from the package root; solid ones from `/fill` (small marks on top of
  an image: play, star). Import by name — never the whole set.
- Sizes in use: 15 in small buttons and chips, 17–18 in form controls, 36–40 for the
  canvas's empty and error states. `strokeWidth` 1.75 for small icons, 1.25–1.5 for large.
- Icon-only buttons need `aria-label`.
- Check a name exists before using it:
  `grep -o "\bName\b" node_modules/@keyline-icons/react/dist/index.d.ts`.

## es-toolkit (replaces lodash)

```ts
import { groupBy, pick } from "es-toolkit"
```

- Never add `lodash`. Prefer native first (`Array.prototype.toSorted`,
  `Object.fromEntries`, `structuredClone`); reach for es-toolkit when native is missing or
  awkward (`groupBy`, `pick`, `omit`, `debounce`).

## date-fns v4

- Format dates with date-fns, not hand-rolled math. Timestamps in the DB are
  `timestamptz`; the app TZ is `ENV.TZ`.
- Short run times on the canvas use `formatElapsed(ms)` from `@/libs/utils` (`"1:26"`).

## redis (node-redis v6)

- Never create a client in a component, action or route: use `@/libs/redis`. `redis()`
  returns the one shared client (kept on `globalThis` so dev reloads don't leak
  connections); `redisDedicated()` opens a separate connection for commands that hold one
  (`subscribe`, `BRPOP`).
- Key and channel names are in `REDIS_KEYS` (`@/constants`), all prefixed `frozen:` since
  the Redis server is shared with other projects.
- App code goes through `@/libs/queue` (`enqueueJobs`, `dequeueJobs`, `requestCancel`,
  `publishEvent`, `readEngineStatus`) rather than calling Redis commands itself. See
  [engine.md](engine.md).
