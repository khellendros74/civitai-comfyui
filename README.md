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

Current: **v1.2.2**

### v1.2.2
- Fixed prompt extraction failing when "Show more" is expanded — the full prompt is now correctly captured in the expanded state.

### v1.2.1
- Previous release.

### v1.2.0
- See [release notes](https://addons.mozilla.org/en-US/firefox/addon/civitai-comfyui/) on AMO.