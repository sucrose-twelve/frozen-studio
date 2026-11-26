---
name: web-stack
description:
  Project rules for Frozen, a local media studio (a web UI that generates images and voice
  lines through ComfyUI and a text-to-speech service). Load before writing, editing,
  reviewing, or formatting any .ts/.tsx/.css file, before running install or database
  commands, and before designing a feature — even when the request names no library (e.g.
  "add an audio mode", "add a setting to the image form", "show the queue"). Covers the
  stack (Next.js 16 with Cache Components, React 19, HeroUI v3, Tailwind v4, Keyline
  icons, Drizzle ORM + Postgres, Redis queue, Zod v4, nuqs, react-hook-form, zustand),
  folder layout, UI components, coding style, and the queue / worker / ComfyUI engine.
---

# Web Stack — Project Frozen

Frozen is a **local** media studio: forms on the left, the result on the right, every
result kept in a gallery. It generates with the models ComfyUI has installed on the same
machine. One user, one GPU, localhost only, no sign-in — but the app should still be built
as if it were real software.

Do not fall back on generic or older-version knowledge (Next.js 13–15 patterns,
`middleware.ts`, Zod v3, lodash, Drizzle `relations()` v0, HeroUI v2 / NextUI props,
`<HeroUIProvider>`). Every library here has breaking changes from what most training data
shows. When unsure about a Next.js API, read `node_modules/next/dist/docs/01-app/` first;
for a HeroUI component, read its docs through the `heroui-react` MCP tools or its styles
in `node_modules/@heroui/styles/dist/components/`.

## Mindset: Software Engineer, not Vibe Coder

- **Plan before typing.** Read the surrounding code and find the existing helper, hook,
  component, or validator before creating a new one. Reuse > duplicate.
- **Put code where it belongs.** Follow
  [project structure](references/project-structure.md) — no dumping logic into a page file
  because it was convenient.
- **No placeholder hacks.** No `any`, `// TODO`, `// TEMP`, commented-out code, or
  `console.log` left behind unless the user asked for a stub. If something is genuinely
  unfinished, say so in your reply.
- **Understand every fix.** If you can't explain why a change works, it isn't done.
- **Verify.** Run Prettier on what you touched, type-check, and try the change in the
  running app: a form that renders is not a job that finishes.

## Stack

| Layer        | Tool                                                                   | Notes                                                       |
| ------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Runtime / PM | bun                                                                    | `bun add`, `bun run`, `bunx` — never npm/yarn/pnpm          |
| Framework    | Next.js 16.4                                                           | App Router, `cacheComponents: true`, plain SSR              |
| UI runtime   | React 19.3                                                             | **No React Compiler** — memoize manually                    |
| Styling      | Tailwind CSS v4                                                        | CSS-first `@theme` in `src/styles/theme.css`, `cls()` merge |
| UI library   | HeroUI v3 (`@heroui/react`, `@heroui/styles`)                          | Compound components — see [ui](references/ui-components.md) |
| Icons        | Keyline (`@keyline-icons/react`)                                       | Outline by default, `/fill` for small solid marks           |
| Database     | Drizzle ORM 1.0 (rc) + `postgres` (js)                                 | Relational Queries v2 (`defineRelations`), `drizzle-kit`    |
| Queue        | Redis (`redis` v6)                                                     | List + pub/sub — see [engine](references/engine.md)         |
| Engine       | ComfyUI, driven by `src/worker/`                                       | The app never calls it — see [engine](references/engine.md) |
| Engine (2nd) | stable-diffusion.cpp in `sdcpp/` (`sd-cli`, one run per job)           | Image jobs with a GGUF text encoder                         |
| Voice        | VoxCPM2, Qwen3-TTS in `tts/` (Python 3.12, `tts/.venv-design`)         | Started by the worker — see [engine](references/engine.md)  |
| Caption      | Ministral 3 8B in `caption/` (Python 3.12, PyTorch, transformers 5)    | Started by the worker — see [engine](references/engine.md)  |
| Chat         | llama.cpp `llama-server` in `chat/`, GGUF models                       | Started by the worker — see [engine](references/engine.md)  |
| Validation   | Zod v4                                                                 | env, Server Action input, forms                             |
| URL state    | nuqs v2                                                                | `createSearchParamsCache` on the server                     |
| Forms        | react-hook-form v7 + `@hookform/resolvers`                             | Zod resolver, shares the action's validator                 |
| Client state | zustand v5                                                             | Store-per-request via React context                         |
| Utilities    | es-toolkit, date-fns v4                                                | es-toolkit replaces lodash                                  |
| Formatting   | Prettier 3.9 + `@ianvs/prettier-plugin-sort-imports` + tailwind plugin | `prettier.config.mjs` is the source of truth                |

## Reference files — read the one that matches the task

| Task                                                              | Read                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| Creating a route, action, component, hook, store, or any new file | [project-structure.md](references/project-structure.md) |
| Writing or reviewing any code (naming, comments, ordering, types) | [coding-style.md](references/coding-style.md)           |
| Pages, layouts, Server Actions, Route Handlers                    | [nextjs.md](references/nextjs.md)                       |
| Buttons, modals, forms, selects — any UI component, theme tokens  | [ui-components.md](references/ui-components.md)         |
| Zod, nuqs, react-hook-form, zustand, Tailwind, icons, utilities   | [libraries.md](references/libraries.md)                 |
| Tables, queries, migrations                                       | [database.md](references/database.md)                   |
| Jobs, the queue, the worker, ComfyUI workflows, media files       | [engine.md](references/engine.md)                       |

## Tools

- `bun run dev` — the app on `http://localhost:8190` and the worker, together.
  `bun run start:dev` / `bun run worker` run one of them. The worker has no watch mode:
  restart it after changing anything under `src/worker/` or `src/libs/comfy/`.
- `launcher/Frozen.ps1` — what the owner's Desktop shortcut runs: ComfyUI, the app and the
  worker in one go, with a tray icon. It serves the **production build** (`start:prod`),
  rebuilding first when the code is newer than `.next/BUILD_ID`, so an edit does not show
  in a running Frozen: restart it, or work against a dev server (`-Dev`, or
  `bun run dev`). If it is running (port 8190 answers and nobody started it in a
  terminal), stop it with
  `powershell -ExecutionPolicy Bypass -File launcher/Frozen.ps1 -Quit` before starting
  your own servers or a build, and tell the owner you did. Its output is in `logs/`.
- `bunx prettier --write <files>` — format what you touched.
- `bunx next typegen && bunx tsc --noEmit -p .` — quick type-check (typegen creates
  `RouteContext` etc.). After changing `src/types/*.d.ts`, delete `tsconfig.tsbuildinfo`
  first: the incremental cache has let a stale result through.
- `bun run build` — full production build. It deletes `.next` first, so stop the dev
  server before running it and start it again after.
- `bun run drizzle:generate` / `bun run drizzle:migrate` — see
  [database.md](references/database.md).
- `bun tests/status.spec.ts` — the worker's status, the Redis queue and the newest jobs.
- `bun tests/job.spec.ts "<prompt>"` — queue an image job without the UI.
- `bun tests/import-character.spec.ts <card.md>` — create a chat character from a Markdown
  card.
- `tts/.venv-design/Scripts/python.exe tts/server.py --models-root tts/models --output-root <folder>`
  — run the voice service by hand to try a request with `curl`. Python packages for it are
  installed with `uv pip install --python tts/.venv-design/Scripts/python.exe …`.
- `caption/.venv/Scripts/python.exe caption/server.py --models-root caption/models --image-root <folder>`
  — the same for the captioning service. `uv` may not be on the PATH: there is a copy in
  `caption/.venv/Scripts/uv.exe`.
- Ad-hoc scripting in Bash (bulk edits, quick data checks): if Python is easier for you,
  use it (`python -I`) instead of `bun -e`.

## Project notes

- **No automated tests.** Don't write unit/integration tests or add a test runner. The
  `tests/` folder is the **scripts** folder (it keeps that name): bun scripts like
  `tests/status.spec.ts`. See
  [project-structure.md](references/project-structure.md#repo-root).
- **The UI is in English**, dark-only, on a four-colour neutral palette. See
  [ui-components.md](references/ui-components.md#theme).
- **No sign-in and no accounts.** Don't add auth unless the owner asks.
- **Desktop only, 1280px wide and up.** A narrower window shows a notice instead of the
  app. Lay pages out for that width alone: no `sm:` / `md:` / `lg:` variants, no stacked
  phone layouts, and no checking at tablet or phone sizes. See
  [ui-components.md](references/ui-components.md#screen-size).
- **Test with neutral prompts.** What the models do with other subject matter is the
  owner's to try.
- **Downloads need the owner's go-ahead** (models, Python packages): say what, from where,
  and how big, then wait.
- **ComfyUI is a separate program.** The app and the worker don't start or stop it (only
  the launcher does, as a convenience), and read which models are installed from it. A
  mode whose models are missing is disabled with a note, never an error.

## Definition of done

1. Code lives in the right folder with the right file name.
2. Inputs are validated with Zod (actions) or nuqs (search params); env only via
   `@/constants/env`.
3. Pages use plain SSR (no Suspense or skeletons) with independent queries in
   `Promise.all`.
4. A new kind of job is wired end to end: validator, params type, workflow builder, worker
   branch, form, result view.
5. No `any`, no leftovers, comments follow the block style.
6. Prettier run; type-check passes; the change was tried in the running app. If you could
   not run it, say so.
