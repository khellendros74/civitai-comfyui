# CivitAI → ComfyUI

A Firefox extension that injects a send button directly into CivitAI image pages, letting you fire prompts straight into your local (or remote) ComfyUI instance with a single click — no copy-pasting.

[![Mozilla Add-ons](https://img.shields.io/amo/v/civitai-comfyui?label=Firefox%20Add-on&logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/civitai-comfyui/)

---

## What it does

- **Injects a ComfyUI button** next to the copy icon in the Prompt section of every CivitAI image metadata panel (popovers, static cards, and individual image pages).
- **One click** extracts the prompt and sends it to ComfyUI's `/prompt` API endpoint.
- **Right-click** opens a workflow picker context menu to send to a specific saved workflow, a tag group, or all workflows at once.
- **Tag buttons** on individual image pages get a matching send button that grabs all visible tags as a prompt.

### Workflow features

- Save multiple named workflows, each with its own custom suffix, banned tags, and JSON template.
- **Modes**: Static (always use a specific workflow), Random (pick one at random), Sequential (cycle through in order), All (send to all at once).
- **Banned tags**: strip unwanted tags from the CivitAI prompt before sending — per-workflow and globally. Supports exact match (`hair`) and wildcard (`hair*`).
- **Replay mode**: when no workflow is selected, the button replays the last sent action (named workflow, tag group, or batch) instead of always falling back to Default. Button turns amber to signal replay mode is active.
- **Seed control**: use the workflow's seed, generate a new random seed per run, or generate one shared seed per click across all workflows.
- **Model override**: use the workflow's checkpoint, always inject a specific model, or pick one at random from a selection.

### Server status indicators

The injected button reflects server and configuration state:

| Color | Meaning |
|---|---|
| Gray | No ComfyUI URL configured |
| Red | ComfyUI unreachable |
| Amber | No workflow selected (replay/default mode) |
| Normal blue | Ready |

The toolbar badge mirrors this: `?` gray, `!` red, amber dot, green `✓`.

---

## Installation

### From Firefox Add-ons (recommended)

👉 **[Install from AMO](https://addons.mozilla.org/en-US/firefox/addon/civitai-comfyui/)**

### Manual / development install

1. Download or clone this repository.
2. Open Firefox and navigate to `about:debugging`.
3. Click **This Firefox** → **Load Temporary Add-on**.
4. Select the `manifest.json` file from the extension folder.

> The extension will be active until Firefox is restarted. For a persistent install, use the AMO version.

---

## Setup

1. Click the extension icon in the toolbar to open **Settings**.
2. Enter your ComfyUI URL (default: `http://localhost:8188`).
3. Paste a workflow in **API format** (in ComfyUI: enable Dev Mode → Save (API Format)).
4. Optionally set a name and save it as a named workflow.
5. Select the workflow(s) you want the blue button to use.
6. Click **Save Settings**.

The button will appear automatically on CivitAI image pages next to the prompt copy icon.

---

## Requirements

- Firefox 140+ (desktop), Firefox for Android 142+
- A running [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance accessible from your browser

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save your settings and workflows locally |
| `activeTab` | Inject the button into CivitAI pages |
| `civitai.com`, `civitai.red` | Scope the content script to CivitAI only |

No data is ever sent anywhere except your own ComfyUI instance. No analytics, no ads, no external services.

---

## Version

Current: **v1.5.1**

### v1.5.1
- Fixed the native right-click send unconditionally overwriting the workflow's own sampler/scheduler/steps/CFG with whatever the source CivitAI image was made with — a saved workflow set to `euler_ancestral` could silently get sent as `dpmpp_2m` if the source image used DPM++ 2M. Added a Sampler setting (Workflow / Source image) so this is opt-in; default keeps the workflow's own values.
- `Schedule type:` (CivitAI's newer format, separate from `Sampler:`) is now parsed and mapped — previously ignored, so scheduler overrides only ever worked off the old combined "DPM++ 2M Karras"-style labels.

### v1.5.0
- Export/import now also carries seed mode, model mode, selected models, and static model — including in the auto-backup file written before an import. Restoring a config with a non-default model mode re-fetches the checkpoint list from the currently configured server so the restored selection renders correctly.
- Content script (and its toast/replay logic) now runs on all of `civitai.com`/`civitai.red`, not just `/images`, `/posts`, and `/collections` — fixes the native right-click "Send to ComfyUI" menu not showing a confirmation toast on pages outside that narrower set (e.g. model pages, the plain feed).
- Banned tags now support a `*` anywhere in a rule, not just trailing (e.g. `point*ears*`), matched as a substring pattern.
- Saving a workflow (Settings or a named pair) now validates the JSON and warns — with a chance to cancel — if no `CLIPTextEncode` or `CheckpointLoaderSimple` node is found.
- Added a duplicate button next to delete in the saved workflow list, cloning a pair under an auto-numbered "name copy" / "name copy 2" name.
- The amber (replay) button's tooltip, and the native right-click menu's top-level item, now show what will actually fire (e.g. "Next in rotation", a pair name, or "All workflows") instead of a generic replay message — refreshed live via storage change events.

### v1.4.1
- Fixed a wildcard banned-tag bug: a rule like `ears *` (space before the `*`) baked that trailing space into the match, so it silently never matched a tag ending exactly in "ears" (e.g. "long pointy ears"). The wildcard base is now re-trimmed after stripping the `*`, so it matches regardless of a stray space.

### v1.4.0
- Added a native right-click ("Send prompt to ComfyUI" / "Send with workflow") menu on CivitAI's `/images` feed, since it no longer exposes a per-card generation-data panel for the button to attach to. It reads the prompt straight from the image file's embedded metadata (EXIF/PNG text — CivitAI's own JSON, native ComfyUI PNG graphs, or A1111-style text), so it works with no dependency on CivitAI's page markup.
- Extraction now also pulls seed, steps, cfg, sampler, scheduler and checkpoint from the source image (when present) and applies them on top of your saved workflow — only for settings you haven't explicitly overridden (static/random model or seed mode still win).
- The native menu mirrors the injected button's tag-grouped, alphabetized submenus, default-send replay-last-intent behavior, and random/sequential tag modes (including randomizing the first pick before cycling predictably).
- Refactored the embedded-metadata parser, payload builder, and tag-mode resolution into a shared `shared.js` module used by both the content script and the background script, so the two menus can't drift out of sync again.

### v1.3.0
- The extension now resolves the source CivitAI image id for a sent prompt — from the URL on individual `/images/{id}` pages, or captured from the card's DOM at the moment the popover's "Generation data" icon is clicked on feed/model pages. When resolved, it's attached to the ComfyUI `/prompt` request as `extra_data.extra_pnginfo.civitai_image_id`, so it gets embedded in the output PNG's metadata. No id is ever sent if it can't be resolved.

### v1.2.10
- Fixed tag button/context menu no longer appearing on image pages after CivitAI renamed the tag badge CSS class (`VotableTag_mainBadge` → `VotableTag-module-scss-module__XXXXXX__mainBadge`). Tag detection now matches on the stable `mainBadge` suffix instead.

### v1.2.9
- Ctrl+click the toolbar icon to cancel the prompts queued from your last send (blue button, tag button, or context menu action) — only pending, not-yet-started jobs are removed from ComfyUI's queue.

### v1.2.8
- Content script now also runs on `/collections/*` pages, so the ComfyUI button is injected into image popovers there too.

### v1.2.7
- Toolbar badge now shows the ComfyUI queue size (pending jobs) instead of a plain checkmark, via a lightweight `GET /prompt` poll. Auto-poll slowed to 60s; multi-workflow "All"/tag-group sends now trigger a single debounced status refresh instead of one per workflow.
- Amber (no workflow selected) now behaves like green: still pings the server and shows the queue count, just tinted amber to signal replay mode.
- Options page logo now mirrors all four toolbar states (gray/red/amber/normal), refreshed on load, every 30s, after Test Connection, and immediately on selection change.
- Added a live "N of M selected" count plus Select all / Deselect all buttons above the workflow list in Random/Sequential/All modes.
- Corrected workflow-mode helper text that predated replay mode ("Check at least one" was no longer accurate) and added a persistent explainer for amber/replay behavior under the Mode selector.

### v1.2.6
- Fixed replay mode cycling over the same repeated workflows when clicking rapidly in sequential tag mode — sequential index is now read and written atomically per click instead of from the initial stale storage snapshot.

### v1.2.5
- Fixed extracting negative prompt instead of positive when "Show more" is expanded.

### v1.2.4
- Fixed button not appearing on `/posts/*` URLs.
- Fixed negative prompt being extracted instead of positive when "Show more" is expanded.
- Fixed "Default" model label showing wrong checkpoint name.
- Added workflow list sort controls (A→Z / Recent first).

### v1.2.3
- Tags now displayed as dimmed text next to workflow names in the workflow list.
- Export/import now includes global banned tags.
- Fixed delete button alignment in workflow list.

### v1.2.2
- Fixed prompt extraction failing when "Show more" is expanded — the full prompt is now correctly captured in the expanded state.
- Export/import now includes global banned tags.
- Fixed GitHub Actions release workflow.

### v1.2.1
- Previous release.

### v1.2.0
- See [release notes](https://addons.mozilla.org/en-US/firefox/addon/civitai-comfyui/) on AMO.