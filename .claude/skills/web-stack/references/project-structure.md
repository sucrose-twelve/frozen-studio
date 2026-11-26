# Project Structure

Path alias: `@/*` → `./src/*`. Always import across folders with `@/`; use relative
imports only inside the same feature folder (e.g. a page importing its own
`./validator.nuqs`).

## Repo root

| Folder      | Purpose                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`      | The app and the worker (below)                                                                                                                                    |
| `tts/`      | The text-to-speech service (Python): `server.py`, `requirements.txt`, `download_model.py`. Its `.venv-design/` and `models/` are not committed                    |
| `chat/`     | llama.cpp's server in `bin/llama/` and the chat models (GGUF) in `models/`. Neither is committed                                                                  |
| `caption/`  | The captioning service (Python), laid out the same way                                                                                                            |
| `tests/`    | **Scripts**, not tests. The project has no automated tests; `tests/` plays the role of a `scripts/` folder (keep the name `tests`)                                |
| `launcher/` | `Frozen.ps1`, the one-click start (ComfyUI + app + worker, tray icon). Windows PowerShell 5.1, plain ASCII. Its `logs/` output and `frozen.ico` are not committed |
| `notes/`    | The owner's notes and plans                                                                                                                                       |
| `public/`   | Static files only. Never media                                                                                                                                    |

`tests/` holds scripts run with bun from the repo root: the worker's entry
(`tests/worker.spec.ts`, behind `bun run worker`), queue debugging
(`tests/status.spec.ts`), and quick experiments. Name them `<topic>.spec.ts`; a script too
big for one file keeps its entry there and its parts in `tests/<topic>s/`. They may import
from `@/…`, and must end their connections (`db.$client.end()`, `client.destroy()` for
Redis) so the process exits. **Don't write unit/integration tests** or add a test runner
unless the owner asks.

Generated media is not in the repo at all: it lives in ComfyUI's input and output
directories, under a `frozen/` subfolder (see [engine.md](engine.md#media-on-disk)).

## Top level of `src/`

```
src/
├── actions/              Shared Server Actions + readers, grouped by domain
│   ├── jobs/             create.ts, read.ts, update.ts, delete.ts, validator.zod.ts
│   ├── assets/           update.ts, validator.zod.ts
│   └── engine/           read.ts
├── app/
│   ├── (studio)/         The app's one route group: / (studio), /caption, /chat (and /chat/characters/[id]) and /gallery
│   ├── api/              Route Handlers for non-UI responses: events (SSE), media/[id], uploads
│   └── error.tsx, not-found.tsx, layout.tsx
├── components/           Shared UI used by 2+ routes or by the layout (site-header, engine-status, job-events, job-toasts)
├── constants/            Value lists + labels (media.ts), Redis keys and engine settings (engine.ts), metadata, fonts; env/
├── drizzle/              db client, schema/*.schema.ts, relations, types, table-columns, migrations, utils
├── hooks/                Shared client hooks, re-exported from hooks/index.ts
├── libs/                 Framework-agnostic helpers: queue, redis, media, job, image-model, upload, logger, utils
│   └── comfy/            ComfyUI HTTP client, model discovery, graphs/ (one workflow builder per job kind)
├── stores/<name>/        zustand store: state.ts (createXStore) + index.tsx (Provider + hook)
├── styles/               globals.css, theme.css (palette + HeroUI tokens), custom.css (@layer components)
├── types/                app.d.ts (helper types), schema.d.ts (the Media and Engine namespaces)
└── worker/               The queue worker: index.ts (loop), process.ts (one job), service.ts (the engine services), voice.ts, caption.ts, llama.ts + chat.ts (chat replies), engine.ts, comfy-socket.ts, gpu.ts
```

`src/worker/` is not part of the Next.js bundle: it is a bun process started by
`tests/worker.spec.ts`. It shares `libs/`, `constants/`, `drizzle/` and `types/` with the
app, which is the point of keeping it in the same tree. Nothing under `app/`,
`components/` or `actions/` may import from `worker/`, and the worker never imports React
or `next/*`.

## Route folder layout

Every page folder follows the same shape. Create only the files you need, but use these
names:

```
app/(studio)/gallery/
├── page.tsx              Server Component (plain SSR). Parses params, loads data with Promise.all, composes
├── layout.tsx            (optional) shared chrome for nested segments
├── actions/              Route-local Server Actions and readers (read.ts, create.ts, update.ts, delete.ts)
├── components/           Route-local components (kebab-case files, named exports)
├── hooks/                Route-local hooks
├── utils.ts              Route-local pure helpers (form defaults, labels, parsing)
├── validator.nuqs.ts     Search params: parsers + createSearchParamsCache → queryValidator / QueryValidator
└── validator.zod.ts      Form / action input schema
```

The studio page keeps the item it shows in search params rather than in a segment:
`/?mode=image&job=<id>&asset=<id>`.

## Local vs shared — where does it go?

| Used by…                        | Action / reader                   | Component                   | Hook / util              |
| ------------------------------- | --------------------------------- | --------------------------- | ------------------------ |
| One route                       | `app/…/<route>/actions/<crud>.ts` | `app/…/<route>/components/` | `app/…/<route>/utils.ts` |
| Two or more routes              | `@/actions/<domain>/<crud>.ts`    | `@/components/`             | `@/hooks/` or `@/libs/`  |
| Not tied to React / Next at all | —                                 | —                           | `@/libs/`                |

Start local. Promote to the shared folder the moment a second route needs it — move it,
don't copy it. Anything the **worker** also needs is shared by definition and goes in
`@/libs` or `@/constants`.

**Exception: value lists and their labels.** A fixed set of values (`JOB_KINDS`,
`ASPECTS`, `IMAGE_COUNTS`) and everything keyed by it (`JOB_KIND_LABELS`, `IMAGE_SIZES`)
live together in `constants/<domain>.ts` and are imported from `@/constants`, even when
one route uses them. Validators import the list; they don't define it. Icon maps and
option lists built for one control stay with the component that renders them.

Shared actions are grouped by domain and split into the four CRUD files: `read.ts`,
`create.ts`, `update.ts`, `delete.ts`.

## Domains

| Domain   | Tables (drizzle/schema)                            | What it covers                                                                                                           |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `jobs`   | `jobs`, `job_inputs`                               | Queueing, rerolling, canceling, deleting, the gallery                                                                    |
| `assets` | `assets`                                           | Files on disk: uploads and results; favorites                                                                            |
| `engine` | — (Redis)                                          | The worker's status and installed models                                                                                 |
| `chats`  | `characters`, `personas`, `chats`, `chat_messages` | Characters, conversations and messages. Its actions are local to `app/(studio)/chat/actions/`, since one route uses them |

## File naming

| Kind              | Convention                    | Example                                 |
| ----------------- | ----------------------------- | --------------------------------------- |
| Files and folders | kebab-case                    | `job-canvas.tsx`, `image-model.ts`      |
| Hook files        | kebab-case with `use-` prefix | `use-engine.ts`, `use-studio-query.ts`  |
| Validators        | `validator.<lib>.ts`          | `validator.zod.ts`, `validator.nuqs.ts` |
| Drizzle schema    | `<domain>.schema.ts`          | `jobs.schema.ts`                        |
| Scripts           | `tests/<topic>.spec.ts`       | `tests/status.spec.ts`                  |
| Global types      | `src/types/*.d.ts`            | `Media.JobKind`, `NextSearchParams`     |

**Every file and folder name is kebab-case**: components, hooks, stores, utils, and
scripts alike. The only exceptions are names the framework fixes (`page.tsx`,
`layout.tsx`, `route.ts`, `next.config.ts`, …) and the dotted suffixes in the table above
(`.zod`, `.nuqs`, `.schema`, `.spec`). This is about file names only: exported identifiers
stay camelCase / PascalCase.

## Barrels

Only `hooks/index.ts` and `constants/index.ts` are barrels. Don't add `index.ts`
re-exports elsewhere — they blur the server/client boundary and hurt tree-shaking.
`constants/env` is deliberately **not** re-exported from the barrel: it is server-only.
