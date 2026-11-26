# Project instructions

## This is NOT the Next.js you know

This project runs Next.js 16 — APIs, conventions, and file structure may differ from your
training data. Before writing Next.js code, read the relevant guide in the version-matched
docs bundled at `node_modules/next/dist/docs/` (`01-app/` for the App Router). Heed
deprecation notices.

## Stack & conventions

Load the project `web-stack` skill (`.claude/skills/web-stack/SKILL.md`) before writing,
editing, reviewing, or formatting any code, or running install or database commands. It
covers the stack, folder layout, coding style, HeroUI v3, Drizzle + Postgres, and the
queue / worker / ComfyUI engine, with one reference file per topic under `references/`.

## Project

Frozen is a local media studio: a web UI that generates images and voice lines with models
that run on this machine (text/image to image, background removal, Japanese text to
speech, image to text), and chats with characters. The Next.js app only reads and writes
Postgres and Redis; a separate worker process is the one client of the engines: ComfyUI,
stable-diffusion.cpp in `sdcpp/`, the text-to-speech service in `tts/`, the captioning
service in `caption/` and llama.cpp's server in `chat/`. There is no sign-in, and the app
listens on localhost only.

## Notes

- `agentRules: false` is set in `next.config.ts` so `next dev` no longer generates
  `AGENTS.md` / `CLAUDE.md` at the project root. Keep agent instructions in this file
  instead.
- The owner works in Thai: reply in Thai, plainly and briefly. Code, comments, UI text and
  docs stay in English.
- Test generation with neutral prompts only. What the models do with other subject matter
  is the owner's to try.
- Ask before downloading anything (models, Python packages): say what, from where, and how
  big.
