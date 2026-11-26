# UI components — HeroUI v3 + Keyline icons

HeroUI v3 (`@heroui/react` for components, `@heroui/styles` for their CSS) on Tailwind v4.
It is built on React Aria Components and is **not** the HeroUI v2 / NextUI most examples
show: there is no `<HeroUIProvider>`, no `color='primary'` / `onClick` / `isLoading`
props, and most components are compound (`Select.Trigger`, `Modal.Dialog`).

## How to look a component up

Don't write a component from memory. In order of preference:

1. The `heroui-react` MCP tools: `get_component_docs` (API and examples),
   `get_component_source_styles` (its CSS).
2. `node_modules/@heroui/styles/dist/components/<name>.css` — the class names, the
   `data-*` states it styles, and the CSS variables it exposes.
3. An existing use in `src/` — the table below says where.

## Rules

- **Compound components need `"use client"`.** `Select.Trigger` and friends are properties
  of a client reference, which a Server Component can't read. Any file that writes a
  dotted HeroUI component starts with `"use client"`; a plain `<Button>` or `<Chip>` is
  fine on the server.
- Events are React Aria's: `onPress` (not `onClick`), `isDisabled`, `isPending`,
  `isSelected` + `onChange(isSelected)`, `selectedKeys` + `onSelectionChange(keys)`.
- A form control without a visible `<Label>` needs `aria-label`.
- Style with `className` (Tailwind utilities win over HeroUI's component layer). To change
  a component's own colours everywhere, override its CSS variables in
  `src/styles/custom.css`, as done for `.toggle-button`.
- Links that look like buttons are `next/link` with utilities, not a `Button` wrapping an
  anchor.

## Components in use

| Component              | Shape                                                                                                                                              | See                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `Button`               | `variant` primary · secondary · tertiary · outline · ghost · danger · danger-soft; `size`; `fullWidth`; `isIconOnly`; `isPending`; `type='submit'` | `result-actions.tsx`    |
| `ToggleButtonGroup`    | `selectionMode='single'`, `selectedKeys`, `onSelectionChange(Set)`, `disallowEmptySelection`, `isDetached`; children `ToggleButton id='…'`         | `option-group.tsx`      |
| `ToggleButton` (alone) | `isSelected`, `onChange`                                                                                                                           | `gallery-filters.tsx`   |
| `Switch`               | `<Switch><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>label</Switch.Content><Description /></Switch>`                          | `form-parts.tsx`        |
| `TextArea`, `Input`    | Native props + `fullWidth`, `variant='secondary'`; works with `form.register`                                                                      | `image-form.tsx`        |
| `NumberField`          | `value`, `onChange(number \| undefined)`, `minValue`, `maxValue`, `step`; `NumberField.Group` > `DecrementButton`, `Input`, `IncrementButton`      | `image-form.tsx`        |
| `Select`               | `value`, `onChange(key)`; `Select.Trigger` > `Select.Value` + `Select.Indicator`; `Select.Popover` > `ListBox` > `ListBox.Item id textValue`       | `image-form.tsx`        |
| `Separator`            | A 1px rule; `className='h-0.5'` for the thick one between form zones                                                                               | `form-parts.tsx`        |
| `Modal`                | `<Modal>` > trigger `Button` + `Modal.Backdrop` > `Modal.Container size` > `Modal.Dialog` > `CloseTrigger`, `Header` > `Heading`, `Body`           | `job-result.tsx`        |
| `AlertDialog`          | Controlled: `useOverlayState()` + `<AlertDialog.Backdrop isOpen onOpenChange>` > `Container` > `Dialog` > `Header`, `Body`, `Footer`               | `delete-job-button.tsx` |
| `Tooltip`              | `<Tooltip delay>` > `Tooltip.Trigger` + `Tooltip.Content placement`                                                                                | `memory-status.tsx`     |
| `Popover`              | `<Popover>` > `Popover.Trigger` (styled as the chip) + `Popover.Content placement` > `Popover.Dialog` > `Popover.Heading`                          | `engine-status.tsx`     |
| `ProgressBar`          | `value`, `isIndeterminate`; `ProgressBar.Track` > `ProgressBar.Fill`                                                                               | `job-progress.tsx`      |
| `Chip`                 | `variant='soft'`, `size='sm'`                                                                                                                      | `job-result.tsx`        |
| `Spinner`              | `size`, `color='current'`                                                                                                                          | `recent-strip.tsx`      |
| `Kbd`                  | `<Kbd><Kbd.Abbr keyValue='ctrl' /><Kbd.Content>↵</Kbd.Content></Kbd>`                                                                              | `submit-bar.tsx`        |
| `Toast`                | `<Toast.Provider placement='bottom end' />` once (`components/toaster.tsx`); then `toast.danger("…")` from anywhere on the client                  | `toaster.tsx`           |

A component that isn't in the table yet: read its docs first, then add a row here.

Sound is the browser's own `<audio controls preload='metadata'>`: it follows the dark
colour scheme set on `<html>`, and `/api/media` answers its range requests so it can seek.

## Patterns

### Forms

The studio's forms are built from four pieces in `(studio)/components/form-parts.tsx` and
two controls beside them. Use them; don't restyle per form.

- `FormSection` — a titled block, with an optional note on the right of the title.
- `FieldRow` — a small label above a control.
- `SwitchField` — an on/off setting with a one-line explanation.
- `FormDivider` — the thick (2px) rule between zones.
- `OptionGroup` — a typed row of buttons where exactly one is chosen. Use it for any short
  fixed set (quality, size, length); a `Select` is for a list that can grow (models).
- `KindSwitch` — the switch between kinds of media, used by the studio (its modes) and the
  gallery (its filter): the kinds that are made as named buttons in one group, and Cutout
  beside them as an icon-only button, with one choice across both groups. On/off settings
  can join the icon group as `toggles` (the gallery's Favorites).
- `ModelSelect` — the first thing in a form whose kind has models to choose from: a
  `Select` over what the engine reports, shown with a single model too and disabled
  without any. Pair it with `useDefaultModel`, which keeps the form on an installed one.
- `SubmitBar` — the sticky foot of a form: a summary of what will run, or the reason it
  can't (`blocker`), and the submit button.

Buttons that act on one result live in `asset-buttons.tsx` (`DownloadButton`,
`FavoriteButton`); `ResultActions` is the row under a result, and `DeleteJobButton` the
delete with its confirmation. `VoiceClip` is one voice clip as a row (its line, a player,
its buttons), shared by the studio's voice result and the gallery's voice list. A
caption's result is text (`caption-result.tsx`): each piece has a copy button, and its
prompts go to the Image form as a `Prefill` with `prompt`, which changes the form's text
and nothing else. Send a `Prefill` with `usePrefill`, not the store's `requestPrefill`: it
also goes to the page the form is on.

**Every setting is visible.** Don't tuck settings into a `Disclosure`, accordion or
"Advanced" toggle: the owner asked for them to be shown outright, with the less-used ones
in their own zone under a `FormDivider` and an "Advanced" `FormSection`.

A control that can't apply right now stays on screen, disabled, with its description
saying why ("Needs a background removal model in ComfyUI."), rather than disappearing. The
one exception is the Image form's **Reference images**: the owner asked for it to be
hidden for a model that can't edit (`canEditImages`: Turbo, Iris, MOSS-Image, Sakura), and
references already picked are removed with a toast saying why.

One-line fields are all **36px** tall: `.input` and `.select__trigger` are set to `h-9` in
`custom.css` (HeroUI's padding made them 38px); `NumberField` is 36px already.

### Status and jobs

The header keeps the two apart:

- `EngineStatus` is the chip: **Online** while the worker reports, **Offline** when it
  doesn't, with an amber light when something it needs is down or another program holds
  VRAM. Pressing it opens a `Popover` listing the worker and every `Engine.Service` the
  worker reported (ComfyUI, Postgres, Redis, the Python services). A Python service that
  isn't running is "Starts when needed", not offline.
- `MemoryStatus` sits beside it: RAM and VRAM as used/total, the used figure amber past
  75% and red past 90%, and used and free in a `Tooltip`. The worker reads them each beat
  (`worker/memory.ts`: `os` for RAM, `nvidia-smi` for VRAM) into `Engine.Status.memory`;
  the chip is hidden while the worker isn't running.
- `JobToasts` shows each queued or running job as a toast in the shared stack (`toast()`
  from `@heroui/react`): kept open with its progress and a Cancel button, then updated in
  place to Done (with Open), Failed or Canceled for a few seconds. The stack is always
  expanded (`isExpanded` on the `Toaster`, up to 5 at once). A page names a job from the
  `brief` on its queued event, or from `readActiveJobs` for jobs already active when it
  rendered. A brief carries the job's kind and up to four lines of settings (`jobDetails`
  in `@/libs/job`: model, size, sampling, seed), never the prompt, which can run long.

### Chat

The Chat page (`app/(studio)/chat/`) has three panels: characters with their chats, the
thread, and the chat's portrait, model, sampling and the user's persona. A message's
actions (`*…*`) show as muted italics (`messageParts`). A reply being written comes from
the store (`replies`, fed by `chat` events) and wins over the server's text while its job
is active. Sampling saves as it changes. The character editor (`/chat/characters/[id]`,
`new` for a new one) reuses `ReferencePicker` with `max={1}` for the avatar and the
portrait, and has the voice under them (`character-voice.tsx`): model, spoken language,
description and the sample, saved by "Make a sample" apart from the card's Save. A message
of a character with a voice has a Speak button (`Volume`); its clip plays by itself once
ready, with the spoken words under the player (`message-speech.tsx`).

### Destructive actions

Deleting asks first, in an `AlertDialog` that says what is lost and that it can't be
undone. The confirming button is `variant='danger'` with `isPending` while the action
runs.

- An **image** is deleted on its own (`DeleteAssetButton` → `deleteAsset` in
  `actions/assets/delete.ts`), so a bad picture in a set goes and the good ones stay. It
  takes its cutout (same job, same position) along, and the job goes too when it was the
  last result (`isLastResultOf`). The canvas or the gallery's viewer then moves to the
  next image of the job.
- A **job** without an image on screen (voice clips, captions, a failed job) is deleted
  whole (`DeleteJobButton` → `deleteJob`).

### Server Actions from a button

```tsx
const [pending, setPending] = useState<"reroll" | "cutout" | null>(null)

const handleReroll = useCallback(async () => {
  setPending("reroll")
  const result = await rerollJob({ id: job.id })
  setPending(null)

  if (result.ok) void showJob(result.id)
  else toast.danger(result.message)
}, [job.id, showJob])

<Button variant='secondary' size='sm' isPending={pending === "reroll"} onPress={handleReroll}>
```

### Images

- Thumbnails (recent strip, gallery, picker) use `next/image` with real `width`/`height`,
  a `sizes` hint and `quality={75}`; the optimizer resizes them from `/api/media/<id>`.
- The canvas shows the file itself in a plain `<img>`: a result must be seen at full
  quality, not as a resized copy.
- An image with transparency sits on `.use-checkerboard`.

### Controls on top of a tile

A button doesn't go inside a link. A tile that is a link and also has a button (the
gallery's delete) is a `group relative` wrapper holding the link and, beside it, the
button positioned over a corner. The button shows on hover or keyboard focus
(`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`) and always on touch
(`pointer-coarse:opacity-100`).

## Screen size

Frozen runs in a desktop browser window at least **1280px** wide (Tailwind's `xl`), and
nothing smaller is supported. Below that width the root layout shows `NarrowWindowNotice`
("Frozen needs a wider window") and a rule at the end of `custom.css` hides every other
child of `body`, dialogs and toasts included.

- Write each layout once, for 1280px and wider: fixed columns like the studio's
  `grid-cols-[30rem_minmax(0,1fr)]`, without breakpoint variants. A wide screen gets more
  room through `max-w-9xl` and flexible columns, not another layout.
- Don't add `sm:` / `md:` / `lg:` classes, mobile stacking or touch-only layouts. Where a
  HeroUI example uses `sm:` (a dialog's `sm:max-w-…`), drop the prefix.
- Check changes at desktop sizes only (the browser pane at 1280px or wider).

## Theme

`src/styles/theme.css` is the whole theme. The app is dark-only and built on four colours:

| Name    | Hex       | Role                                                        |
| ------- | --------- | ----------------------------------------------------------- |
| night   | `#0a0a0a` | Page background; text on accent                             |
| steel   | `#404040` | Mixed into night for surfaces, borders, default buttons     |
| glacier | `#a3a3a3` | Focus rings, muted text, the **selected** option in a group |
| frost   | `#fafafa` | Page text; accent: the primary button, links, current item  |

They are mapped onto HeroUI's tokens (`--background`, `--surface`, `--default`,
`--accent`, `--muted`, `--border`, `--focus`, …), and HeroUI derives hover and soft
variants from those. So:

- Use the tokens as utilities: `bg-surface`, `bg-surface-secondary`, `bg-field`,
  `text-muted`, `border-border`, `border-separator`, `bg-accent text-accent-foreground`,
  `text-danger`, `text-warning`, `bg-success`.
- Surfaces step up from the page: `background` → `surface` (panels) → `surface-secondary`
  (tiles inside a panel) → `surface-tertiary`. A panel is `.use-panel`.
- Frost is for the **one** primary action on screen and for marking the current item.
  Selection inside a control is glacier. Status colours (`success`, `warning`, `danger`)
  are only for status.
- To change the look, change `theme.css`, not the components.

## Icons

Keyline (`@keyline-icons/react`), covered in [libraries.md](libraries.md#keyline-icons).
Each mode has its icon, used wherever the mode is named: `ImageSparkles` (image),
`Scissors` (cutout), `Mic` (voice), `ScanText` (caption, which is a page in the header
rather than a mode of the studio), `MessageSquare` (chat, also a page of its own). A voice
clip, which has no picture, is shown as `AudioLines`.
