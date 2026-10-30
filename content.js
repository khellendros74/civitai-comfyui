// content.js — CivitAI → ComfyUI
// Injects a "Send to ComfyUI" button next to the FIRST copy icon
// in the Prompt section of CivitAI's image metadata popover.

(function ()
{
    "use strict";

    let processedPanels = new WeakSet();

    // ── Server availability ────────────────────────────────────────────────────

    let serverAvailable  = null;
    let configMissing    = false;
    let selectionMissing = false;
    let replayDescription = "will send: Default";

    function checkConfig()
    {
        browser.storage.local.get(["comfyUrl", "pairs", "selectedPairs"]).then(function (s)
        {
            let url     = (s.comfyUrl || "").trim();
            let pairs   = s.pairs || [];
            let hasWf   = pairs.some(function (p) { return p.workflow && p.workflow.trim(); });
            let missing = !url || !hasWf;
            let noSel   = !s.selectedPairs || s.selectedPairs.length === 0;
            let changed = (configMissing !== missing) || (selectionMissing !== noSel);
            configMissing    = missing;
            selectionMissing = noSel;
            if (changed) updateAllButtonStates();
        });
    }

    // Builds a human-readable description of what the amber (replay) button
    // will actually fire, mirroring sendToComfyUI()'s own "nothing selected"
    // resolution — without mutating any rotation/randomization state, since
    // this only runs to describe, never to send.
    function computeReplayDescription()
    {
        browser.storage.local.get(["pairs", "lastSentIntent"]).then(function (s)
        {
            let pairs = s.pairs || [];
            let info  = resolveReplayInfo(pairs, s.lastSentIntent);

            if (info.kind === "named")
                replayDescription = "will send: " + info.names.join(", ");
            else if (info.kind === "all")
                replayDescription = "will send all " + info.count + " workflow(s)";
            else if (info.kind === "tag")
            {
                if (info.mode === "random")
                    replayDescription = "will send a random workflow from \"" + info.tag + "\"";
                else if (info.mode === "sequential")
                    replayDescription = "will send the next workflow in rotation from \"" + info.tag + "\"";
                else
                    replayDescription = "will send all workflows tagged \"" + info.tag + "\" (" + info.count + ")";
            }
            else
            {
                replayDescription = "will send: Default";
            }

            updateAllButtonStates();
        });
    }

    function checkServerAvailability()
    {
        browser.storage.local.get(["comfyUrl"]).then(function (s)
        {
            let url = (s.comfyUrl || "").replace(/\/$/, "");
            if (!url) { setServerState(false); return; }
            browser.runtime.sendMessage({ type: "COMFYUI_PING", url: url + "/system_stats" })
            .then(function (r) { setServerState(r && r.ok); })
            .catch(function ()  { setServerState(false); });
        });
    }

    function updateAllButtonStates()
    {
        let btns = document.querySelectorAll(".civitai-comfyui-btn, .civitai-comfyui-tag-btn");
        for (let btn of btns) { applyServerState(btn); }
    }

    function setServerState(available)
    {
        if (serverAvailable === available) return;
        serverAvailable = available;
        updateAllButtonStates();
    }

    function applyServerState(btn)
    {
        // Priority: gray (no config) > red (server down) > amber (no selection) > normal
        if (configMissing)
        {
            btn.disabled      = true;
            btn.title         = "No configuration — open extension settings to set up ComfyUI";
            btn.style.opacity = "0.3";
            btn.style.filter  = "grayscale(1)";
            btn.style.cursor  = "not-allowed";
        }
        else if (serverAvailable === false)
        {
            btn.disabled      = true;
            btn.title         = "ComfyUI unreachable";
            btn.style.opacity = "0.35";
            btn.style.filter  = "grayscale(1) sepia(1) saturate(3) hue-rotate(300deg)";
            btn.style.cursor  = "not-allowed";
        }
        else if (selectionMissing)
        {
            btn.disabled      = false;
            btn.title         = "No workflow selected — " + replayDescription;
            btn.style.opacity = "0.85";
            btn.style.filter  = "sepia(1) saturate(4) hue-rotate(5deg)";
            btn.style.cursor  = "pointer";
        }
        else
        {
            btn.disabled      = false;
            btn.title         = "Send prompt to ComfyUI";
            btn.style.opacity = "0.7";
            btn.style.filter  = "";
            btn.style.cursor  = "pointer";
        }
    }

    checkConfig();
    computeReplayDescription();
    checkServerAvailability();
    setInterval(checkServerAvailability, 30000);

    // Keep amber-state config and the replay tooltip fresh without needing
    // a page reload — e.g. after picking a new workflow from the context
    // menu in another tab, or editing pairs in the options page.
    browser.storage.onChanged.addListener(function (changes, area)
    {
        if (area !== "local") return;
        if (changes.selectedPairs || changes.pairs) checkConfig();
        if (changes.pairs || changes.lastSentIntent || changes.selectedPairs) computeReplayDescription();
    });

    // Lets background.js (native right-click menu path) reuse the toast UI.
    browser.runtime.onMessage.addListener(function (message)
    {
        if (message && message.type === "COMFYUI_TOAST") showToast(message.message);
    });

    // ── Image id resolution ──────────────────────────────────────────────────────

    // Feed/model-page cards open a popover instead of navigating, so the id is
    // never in the URL there. We capture it from the card's DOM the moment the
    // "i" (Generation data) button is clicked — that's what opens the popover.
    let lastOpenedImageId = null;
    let lastOpenedImageSrc = null;

    document.addEventListener("click", function (e)
    {
        let infoBtn = e.target.closest("button[aria-label='Generation data']");
        if (!infoBtn) return;

        let container = infoBtn.closest("div.relative.flex-1");
        if (!container) { lastOpenedImageId = null; lastOpenedImageSrc = null; return; }

        let id = null;
        let link = container.querySelector("a[href*='/images/']");
        if (link)
        {
            let m = link.getAttribute("href").match(/\/images\/(\d+)/);
            if (m) id = m[1];
        }

        let img = container.querySelector("img");

        if (!id && img)
        {
            let m2 = img.src.match(/(\d+)\.\w+(?:\?|$)/);
            if (m2) id = m2[1];
        }

        lastOpenedImageId  = id;
        lastOpenedImageSrc = img ? img.src : null;
    }, true);

    // On individual image/post pages the id is already in the URL.
    function getImageIdFromUrl()
    {
        let m = location.pathname.match(/\/images\/(\d+)/);
        return m ? m[1] : null;
    }

    // URL takes priority (it's authoritative for the current page); the
    // popover-captured id is only relevant on feed/model pages.
    function resolveImageId()
    {
        return getImageIdFromUrl() || lastOpenedImageId;
    }

    // ── Prompt extraction ──────────────────────────────────────────────────────

    function extractPromptFromPanel(panel)
    {
        // Find the section whose header text is exactly "Prompt"
        // Works for both popover layout and static card layout
        let allSections = panel.querySelectorAll("div.flex.flex-col");
        let promptSection = null;

        for (let section of allSections)
        {
            let header = section.querySelector(":scope > div > p, :scope > div > div > p");
            if (header && header.textContent.trim() === "Prompt")
            {
                promptSection = section;
                break;
            }
        }

        // Fallback: use the first flex-col section in a card
        if (!promptSection)
        {
            let card = panel.querySelector(".mantine-Card-root, div.flex.w-96");
            let root = card || panel;
            promptSection = root.querySelector(":scope > div.flex.flex-col");
        }

        if (!promptSection) return null;

        // When collapsed: data-line-clamp="true" is present on the text container.
        // When "Show more" is clicked: CivitAI removes that attribute and renders the
        // full text in a plain div — so we fall back to the prompt section's text content.
        let textEl = promptSection.querySelector("[data-line-clamp='true']");
        if (!textEl) textEl = panel.querySelector("[data-line-clamp='true']");

        // Make sure the found element is actually inside the Prompt section header row's
        // sibling text div, not inside the Negative prompt section below it.
        if (textEl)
        {
            // Check the element is not inside a flex-col sibling that has a "Negative prompt" header
            let negSection = null;
            let flexCols = (promptSection.parentElement || panel).querySelectorAll("div.flex.flex-col");
            for (let col of flexCols)
            {
                let hdr = col.querySelector(":scope > div > p");
                if (hdr && hdr.textContent.trim() === "Negative prompt")
                {
                    negSection = col;
                    break;
                }
            }
            if (negSection && negSection.contains(textEl))
            {
                textEl = null; // discard — it belongs to the negative section
            }
        }

        if (textEl)
        {
            let clone = textEl.cloneNode(true);
            let uiSpans = clone.querySelectorAll("span.absolute, span.select-none");
            for (let s of uiSpans) { s.remove(); }
            let text = clone.textContent.trim();
            if (text.length > 0) return text;
        }

        // Expanded state: positive prompt is a plain div with no data-line-clamp.
        // It's the first dimmed text div directly after the header row.
        // We must NOT fall into the negative prompt section below it.
        let headerRow = promptSection.querySelector(":scope > div.flex.items-center, :scope > div > div.flex.items-center");
        if (headerRow)
        {
            // The prompt text element is the next sibling of the header row
            let textDiv = headerRow.nextElementSibling;
            while (textDiv)
            {
                // Skip if it looks like another header (contains a <p> with font-semibold)
                let innerP = textDiv.querySelector("p");
                if (innerP && innerP.className && innerP.className.includes("font-semibold")) break;

                let clone = textDiv.cloneNode(true);
                // Remove Show less / Show more spans
                let toggles = clone.querySelectorAll("span.cursor-pointer, span.select-none, span.absolute");
                for (let t of toggles) { t.remove(); }
                let text = clone.textContent.trim();
                if (text.length > 0) return text;
                textDiv = textDiv.nextElementSibling;
            }
        }

        return null;
    }

    // ── Embedded-metadata fallback (used when the DOM prompt section is empty) ──
    // CivitAI's own generation images still carry the full prompt inside the
    // image file itself (EXIF UserComment / PNG text chunks). If the on-page
    // panel has no prompt text, we fetch the image and read it from there.

    function resolveImageSrc(panel)
    {
        let img = panel.querySelector("img[src*='civitai']");
        if (img) return img.src;

        if (lastOpenedImageSrc) return lastOpenedImageSrc;

        let id = resolveImageId();
        if (id)
        {
            let all = document.querySelectorAll("img");
            for (let candidate of all)
            {
                if (candidate.src && candidate.src.indexOf(id) !== -1) return candidate.src;
            }
        }

        return null;
    }

    function getMetadataCandidateUrls(src)
    {
        let urls = [src];

        // CivitAI's CDN re-encodes/strips metadata under optimized=true delivery.
        // original=true asks the CDN for the un-re-encoded source file instead.
        if (src.indexOf("optimized=true") !== -1)
        {
            urls.push(src.replace("optimized=true", "original=true"));
        }

        return urls;
    }

    async function tryFallbackPrompt(panel)
    {
        let src = resolveImageSrc(panel);
        if (!src) return null;

        for (let url of getMetadataCandidateUrls(src))
        {
            try
            {
                let response = await browser.runtime.sendMessage({ type: "FETCH_IMAGE_METADATA", url: url });
                if (response && response.ok && response.result && response.result.prompt)
                {
                    return response.result.prompt;
                }
            }
            catch (e) {}
        }

        return null;
    }

    // ── Tag extraction (individual image pages) ──────────────────────────────

    async function expandAndGrabTags(container)
    {
        // Click the chevron-down expand button if present (shows all tags)
        let expandBtn = container.querySelector("button .tabler-icon-chevron-down");
        if (expandBtn)
        {
            expandBtn.closest("button").click();
            // Wait for React to render the extra tags
            await new Promise(function(resolve) { setTimeout(resolve, 400); });
        }

        // Tags are in <a> elements inside VotableTag_mainBadge elements
        let tagLinks = container.querySelectorAll("[class*='mainBadge'] a[data-activity*='tag-click']");
        let tags = [];
        for (let a of tagLinks)
        {
            let text = a.textContent.trim();
            if (text.length > 0) tags.push(text);
        }
        return tags.join(", ");
    }

    function findTagsContainer()
    {
        // The tags group is a mantine-Group-root containing VotableTag_mainBadge elements
        let groups = document.querySelectorAll(".mantine-Group-root");
        for (let group of groups)
        {
            if (group.querySelector("[class*='mainBadge']"))
            {
                return group;
            }
        }
        return null;
    }

    function injectTagButton(container)
    {
        // Don't inject twice
        if (container.querySelector(".civitai-comfyui-tag-btn")) return;

        // Find the "+ Tag" button area to place our button nearby
        // The R badge + TAG button row is the first child of the group
        let tagBtn = document.createElement("button");
        tagBtn.className = "civitai-comfyui-tag-btn";
        tagBtn.title = "Send tags to ComfyUI";
        tagBtn.style.cssText = [
            "display: inline-flex",
            "align-items: center",
            "justify-content: center",
            "padding: 5px",
            "border-radius: 6px",
            "border: none",
            "background: transparent",
            "color: inherit",
            "cursor: pointer",
            "vertical-align: middle",
            "line-height: 1",
            "opacity: 0.7",
            "transition: opacity 0.15s",
            "flex-shrink: 0",
            "min-width: 32px",
            "min-height: 32px",
            "width: 32px",
            "height: 32px",
            "box-sizing: border-box"
        ].join(";");

        let _img = document.createElement("img");
        _img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAY1BMVEVMaXEXLdcXLNgXLdcXLNgWLdcWLNcWLdcXLdgTMNjw/0Hu/UkfMtf2/yUAAdoQKdcYMOUnONYAAN0XLt3S4Hr4/w4vP9UAGtng72TBz4rz/zZEUdKir6e0wphyfsGPm7NaZ8k8Nl+9AAAACnRSTlMAyJb/LLZe+eQFPzCELgAAAAlwSFlzAAAsSwAALEsBpT2WqQAAAsZJREFUeNqll4F2qjAMhlFEnQ0tqUARQX3/p7wp6l1aAuj4z3bOjiOfSROSNEm8fuh3t99mm+MH2mTb/e5l9BL9ud+kBen8gfxz6WbPCD/JLqPPDqT0Aw3PFUW2exPI/lh8ZsspxfFFIPtD8aX5gCgOA+H5/Wn6F8LLh+xv9p6Q+RD2f7X3BMpFslkD2FD9LDyEsSD4924+AoO105EQTBDDdgZg0Fh3DVVrBwywnc0BateVTaTeGeB5mDlDcHVZ5bGqztb8FI/nGQculRopLzX8d+F8nAaY2t7a01j5RWPKAJMBEKDPJQCFwPIwDQDQpQQ4PULAhDFArR9KCMEfAX9UABhA45xDexccUFXPHZAAvno0Yo3mkivBg5vFWYBB964eKQdtU7t0LgSyh1f1SPaqulicBfDqEexz9QjPMAY8q4eZRmXc3HTowMiD2nbB0ZUXrg5i+xgAKVWP4km32jK5IAMCAH31qN8j6+wVayaI7UeAsHraKOlmXHZJXP99pVjSjVlqrBHAYZOrybL9AKB5C1D53eJ3ALQdj0Bdo6r5wIOSR1Au24cA0FfWAnwS8SuA8UlUPIn6S0BtL79HoPIG2QxJzTIAjGnasPcgvBUPRQHg38SweQUz0TpYBnRhFyy5ehQJyVwf562gJYcA5gHoq4C3IjbQTsp3Q1gK4V5VOf1I44SSsgTwhXT3fac8ye10KQRPsMOBl8JAGN6sxXeBNiJ4HsXIvqV+LAIOo8GmH+IRlNoIgPF09tVQKXkmSpveaMGgN0qcidQehe4kbCi0GAlDkaqA2l0qAeIlywNOo8Wore6SA37JGq15aHtfTaHaTkyBX/NGiyY46MpI/c2CvCxvhVUXnNWOaXiXEabWdWHZphUnFH0y1dF28roPkebW/fUXjrVXnvWXrrXXvvUXz/VX3/DyvWQuXb6D6/+sF/Td8fX/H6zEdFpdV1ECAAAAAElFTkSuQmCC";
        _img.width = 22;
        _img.height = 22;
        _img.alt = "ComfyUI";
        _img.style.cssText = "display:block;flex-shrink:0;min-width:22px;min-height:22px;width:22px;height:22px;";
        tagBtn.appendChild(_img);

        tagBtn.addEventListener("mouseenter", function ()
        {
            tagBtn.style.opacity = "1";
        });

        tagBtn.addEventListener("mouseleave", function ()
        {
            tagBtn.style.opacity = "0.7";
        });

        tagBtn.addEventListener("contextmenu", async function (e)
        {
            e.preventDefault();
            e.stopPropagation();
            let tags = await expandAndGrabTags(container);
            if (!tags) return;
            showWorkflowContextMenu(e, tags, tagBtn, resolveImageId());
        }, true);

        tagBtn.addEventListener("click", async function (e)
        {
            e.preventDefault();
            e.stopPropagation();

            tagBtn.disabled = true;
            tagBtn.style.opacity = "0.4";

            let tags = await expandAndGrabTags(container);

            tagBtn.disabled = false;
            tagBtn.style.opacity = "0.7";

            if (!tags)
            {
                showToast("⚠️ No tags found.");
                return;
            }

            sendToComfyUI(tags, tagBtn, resolveImageId());
        });

        // Insert as the first child of the group
        container.insertBefore(tagBtn, container.firstChild);
        applyServerState(tagBtn);
    }

    // ── ComfyUI send ───────────────────────────────────────────────────────────

    // Marks the start of a fresh user-initiated send action — clears the
    // background script's pending-ids list so a toolbar Ctrl+click cancel
    // only targets prompts from this action.
    function startNewBatch()
    {
        browser.runtime.sendMessage({ type: "COMFYUI_START_BATCH" });
    }

    // Reports a queued prompt's id to the background script for cancel tracking.
    // response.body is the raw text from ComfyUI's /prompt endpoint.
    function trackPromptIdFromResponse(responseBody)
    {
        try
        {
            let json = JSON.parse(responseBody);
            if (json && json.prompt_id)
                browser.runtime.sendMessage({ type: "COMFYUI_TRACK_PROMPT_ID", id: json.prompt_id });
        }
        catch (e) {}
    }

    // filterBannedTags() and buildPayload() now live in shared.js so the
    // native context-menu flow in background.js can reuse them verbatim.

    async function sendToComfyUI(prompt, btn, imageId)
    {
        let settings = await browser.storage.local.get(["comfyUrl", "globalBannedTags", "promptSuffix", "promptSuffixPosition", "workflow", "modelMode", "selectedModels", "staticModel", "seedMode", "pairMode", "pairs", "selectedPairs", "staticPair", "sequentialIndex", "sequentialStarted", "tagSequentialIndex", "lastSentIntent"]);
        let comfyUrl = (settings.comfyUrl || "").replace(/\/$/, "");

        if (!comfyUrl)
        {
            alert("CivitAI → ComfyUI: Please set your ComfyUI server URL in the extension options.");
            return;
        }

        // Resolve which workflow + suffix to use based on pair mode
        let workflowRaw = settings.workflow || null;
        let activeSuffix = settings.promptSuffix || "";
        let validModes = ["static", "random", "sequential", "all"];
        let pairMode = validModes.includes(settings.pairMode) ? settings.pairMode : "static";
        let pairs = settings.pairs || [];

        // Resolve which pairs to send (blue button path)
        let pairsToSend = [];
        let hasSelection = settings.selectedPairs && settings.selectedPairs.length > 0;
        let isReplay = false;

        if (pairs.length > 0)
        {
            if (hasSelection)
            {
                // Workflows are checked in config — apply pairMode against the selection
                if (pairMode === "random")
                {
                    let pool = pairs.filter(function (p) { return settings.selectedPairs.includes(p.name); });
                    if (pool.length > 0)
                        pairsToSend.push(pool[Math.floor(Math.random() * pool.length)]);
                }
                else if (pairMode === "sequential")
                {
                    let pool = pairs.filter(function (p) { return settings.selectedPairs.includes(p.name); });
                    if (pool.length > 0)
                    {
                        // sequentialStarted flags that the random seed has been set;
                        // on first click we pick a random position and store it
                        let idx;
                        if (!settings.sequentialStarted)
                        {
                            idx = Math.floor(Math.random() * pool.length);
                            browser.storage.local.set({ sequentialStarted: true, sequentialIndex: (idx + 1) % pool.length });
                        }
                        else
                        {
                            idx = (settings.sequentialIndex || 0) % pool.length;
                            browser.storage.local.set({ sequentialIndex: (idx + 1) % pool.length });
                        }
                        pairsToSend.push(pool[idx]);
                    }
                }
                else if (pairMode === "all")
                {
                    pairsToSend = pairs.filter(function (p) { return settings.selectedPairs.includes(p.name); });
                }
                else
                {
                    // Static: use staticPair if it is among selected, else first selected
                    let chosenPair = pairs.find(function (p) { return p.name === settings.staticPair && settings.selectedPairs.includes(p.name); })
                                  || pairs.find(function (p) { return settings.selectedPairs.includes(p.name); })
                                  || null;
                    if (chosenPair) pairsToSend.push(chosenPair);
                }
            }
            else
            {
                // Nothing selected — replay last sent intent, or fall back to Default
                let intent = settings.lastSentIntent;
                if (intent)
                {
                    isReplay = true;
                    if (intent.type === "named")
                    {
                        for (let name of intent.names)
                        {
                            let p = pairs.find(function (q) { return q.name === name; });
                            if (p) pairsToSend.push(p);
                        }
                    }
                    else if (intent.type === "all")
                    {
                        pairsToSend = pairs.slice();
                    }
                    else if (intent.type === "tag")
                    {
                        let tagPool = pairs.filter(function (p)
                        {
                            let tags = (p.tags || "").split(",").map(function (t) { return t.trim(); });
                            return tags.indexOf(intent.tag) !== -1;
                        });
                        if (tagPool.length > 0)
                        {
                            if (intent.mode === "all")
                            {
                                pairsToSend = tagPool;
                            }
                            else if (intent.mode === "random")
                            {
                                pairsToSend.push(tagPool[Math.floor(Math.random() * tagPool.length)]);
                            }
                            else if (intent.mode === "sequential")
                            {
                                // Fresh read+write to avoid stale-index race on rapid clicks
                                let freshIdx = await browser.storage.local.get(["tagSequentialIndex"]);
                                let tagIndexMap = freshIdx.tagSequentialIndex || {};
                                let idx = (tagIndexMap[intent.tag] || 0) % tagPool.length;
                                pairsToSend.push(tagPool[idx]);
                                tagIndexMap[intent.tag] = (idx + 1) % tagPool.length;
                                await browser.storage.local.set({ tagSequentialIndex: tagIndexMap });
                            }
                        }
                    }
                }
                if (pairsToSend.length === 0)
                {
                    let def = pairs.find(function (p) { return p.isDefault; });
                    if (def) pairsToSend.push(def);
                }
            }
        }

        // Fall back to raw workflow if no pairs resolved
        if (pairsToSend.length === 0)
        {
            let mode = validModes.includes(settings.pairMode) ? settings.pairMode : "static";
            if (mode === "random" || mode === "sequential" || mode === "all")
            {
                showToast("⚠️ No workflows selected — check your workflow settings.");
                return;
            }
            // Static/default: fall back to raw workflow
            if (!workflowRaw)
            {
                showToast("⚠️ No workflow configured — open the extension settings.");
                return;
            }
            pairsToSend.push({ workflow: workflowRaw, suffix: activeSuffix, suffixPosition: settings.promptSuffixPosition || "suffix" });
        }

        if (isReplay) { /* amber state already set */ }

        startNewBatch();

        btn.disabled = true;
        btn.style.opacity = "0.4";

        let modelMode  = settings.modelMode || "default";
        let seedMode   = settings.seedMode || "workflow";
        // For "static" seed mode: generate one seed shared across all workflows this click
        let sharedSeed = (seedMode === "static") ? Math.floor(Math.random() * 2147483647) : null;
        let sendErrors = [];
        let sendCount  = 0;

        function sendNextPair(index)
        {
            if (index >= pairsToSend.length)
            {
                btn.disabled = false;
                btn.style.opacity = "0.7";
                // Restore server status badge
                if (sendErrors.length === 0)
                {
                    let msg = pairsToSend.length > 1
                        ? "✅ " + sendCount + " workflows sent!"
                        : "✅ Prompt sent to ComfyUI!";
                    showToast(msg);
                    showBtnSuccess(btn);
                }
                else
                {
                    showToast(sendErrors[0]);
                    showBtnError(btn);
                }
                return;
            }

            let pair = pairsToSend[index];
            let pairWorkflow = pair.workflow || workflowRaw;
            let pairSuffix   = (pair.suffix || activeSuffix || "").trim();

            if (!pairWorkflow) { sendNextPair(index + 1); return; }

            let workflowTemplate;
            try { workflowTemplate = JSON.parse(pairWorkflow); }
            catch (e) { sendErrors.push("❌ Invalid JSON in: " + (pair.name || "workflow")); sendNextPair(index + 1); return; }

            let mergedBanned = [settings.globalBannedTags, pair.bannedTags].filter(Boolean).join(",");
            let filteredPrompt = filterBannedTags(prompt, mergedBanned);
            let suffixPosition = pair.suffixPosition || settings.promptSuffixPosition || "suffix";
            let finalPrompt = injectCustomText(filteredPrompt, pairSuffix, suffixPosition);

            let modelToInject = null;
            if (modelMode === "static" && settings.staticModel)
                modelToInject = settings.staticModel;
            else if (modelMode === "random" && settings.selectedModels && settings.selectedModels.length > 0)
                modelToInject = settings.selectedModels[Math.floor(Math.random() * settings.selectedModels.length)];

            let payload = buildPayload(finalPrompt, workflowTemplate, modelToInject, seedMode, sharedSeed, imageId);

            browser.runtime.sendMessage({ type: "COMFYUI_FETCH", url: comfyUrl + "/prompt", body: JSON.stringify(payload) })
            .then(function (response)
            {
                if (response && response.ok)
                {
                    sendCount++;
                    trackPromptIdFromResponse(response.body);
                }
                else if (response)
                {
                    let errorMsg = "ComfyUI error " + response.status;
                    try
                    {
                        let json = JSON.parse(response.body);
                        if (json.node_errors)
                        {
                            for (let nodeId in json.node_errors)
                            {
                                for (let err of (json.node_errors[nodeId].errors || []))
                                {
                                    if (err.type === "value_not_in_list")
                                    {
                                        let match = err.details.match(/:\s*'([^']+)'\s*not in/);
                                        errorMsg = "❌ Missing: " + (match ? match[1].split("\\").pop().split("/").pop() : err.details);
                                    }
                                }
                            }
                        }
                        else if (json.error && json.error.message) errorMsg = "❌ " + json.error.message;
                    }
                    catch (e) {}
                    sendErrors.push(errorMsg);
                }
                sendNextPair(index + 1);
            })
            .catch(function ()
            {
                sendErrors.push("❌ Could not reach ComfyUI.");
                sendNextPair(index + 1);
            });
        }

        sendNextPair(0);
    }

    // ── Button error feedback ─────────────────────────────────────────────────

    function showBtnError(btn)
    {
        let originalChild = btn.firstChild ? btn.firstChild.cloneNode(true) : null;
        let originalOpacity = btn.style.opacity;
        let originalBg = btn.style.background;
        let sz = btn.classList.contains("civitai-comfyui-tag-btn") ? "22" : "22";

        btn.textContent = "";
        btn.style.background = "var(--mantine-color-red-light)";
        btn.style.opacity = "1";
        btn.style.filter = "";
        btn.disabled = true;
        btn.style.cursor = "default";

        let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", sz);
        svg.setAttribute("height", sz);
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "var(--mantine-color-red-light-color)");
        svg.setAttribute("stroke-width", "2.5");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.style.cssText = "display:block;flex-shrink:0;";

        let line1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line1.setAttribute("d", "M18 6L6 18");
        svg.appendChild(line1);

        let line2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line2.setAttribute("d", "M6 6L18 18");
        svg.appendChild(line2);

        btn.appendChild(svg);

        setTimeout(function ()
        {
            btn.textContent = "";
            btn.style.background = originalBg;
            if (originalChild) btn.appendChild(originalChild);
            applyServerState(btn);
        }, 3000);
    }

    // ── Button success feedback ────────────────────────────────────────────────

    function showBtnSuccess(btn)
    {
        let originalChild = btn.firstChild ? btn.firstChild.cloneNode(true) : null;
        let originalOpacity = btn.style.opacity;
        let originalBg = btn.style.background;
        let sz = btn.classList.contains("civitai-comfyui-tag-btn") ? "22" : "22";

        // Mantine-style: faded square background + teal checkmark, no circle
        btn.textContent = "";
        btn.style.background = "var(--mantine-color-teal-light)";
        btn.style.opacity = "1";
        btn.style.filter = "";
        btn.disabled = true;
        btn.style.cursor = "default";

        let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", sz);
        svg.setAttribute("height", sz);
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "var(--mantine-color-teal-light-color)");
        svg.setAttribute("stroke-width", "2.5");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.style.cssText = "display:block;flex-shrink:0;";

        let check = document.createElementNS("http://www.w3.org/2000/svg", "path");
        check.setAttribute("d", "M5 13l4 4L19 7");
        svg.appendChild(check);

        btn.appendChild(svg);

        setTimeout(function ()
        {
            btn.textContent = "";
            btn.style.background = originalBg;
            if (originalChild) btn.appendChild(originalChild);
            applyServerState(btn);
        }, 3000);
    }

    // ── Context menu ───────────────────────────────────────────────────────────

    let activeMenu = null;
    let activeSubmenus = [];
    let menuDismissHandler = null;

    function removeContextMenu()
    {
        if (activeMenu) { activeMenu.remove(); activeMenu = null; }
        for (let sub of activeSubmenus) { if (sub && sub.parentNode) sub.remove(); }
        activeSubmenus = [];
        if (menuDismissHandler)
        {
            document.removeEventListener("mousedown", menuDismissHandler, true);
            menuDismissHandler = null;
        }
    }

    function showWorkflowContextMenu(e, prompt, btn, imageId)
    {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        removeContextMenu();

        browser.storage.local.get(["pairs"]).then(function (s)
        {
            let pairs = (s.pairs || []).slice().sort(function (a, b)
            {
                if (a.isDefault) return -1;
                if (b.isDefault) return 1;
                return a.name.localeCompare(b.name);
            });
            if (pairs.length === 0) { showToast("No workflows saved."); return; }

            let MENU_CSS = [
                "position:fixed",
                "z-index:2147483647",
                "background:var(--mantine-color-dark-7,#1a1b1e)",
                "border:1px solid var(--mantine-color-dark-4,#373a40)",
                "border-radius:8px",
                "padding:6px",
                "min-width:200px",
                "max-width:280px",
                "box-shadow:0 8px 24px rgba(0,0,0,0.6)",
                "font-family:var(--mantine-font-family,sans-serif)",
                "font-size:13px",
                "user-select:none"
            ].join(";");

            let ITEM_BASE = "display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:5px;cursor:pointer;color:var(--mantine-color-gray-0,#f8f9fa);";

            function hover(el)
            {
                el.addEventListener("mouseenter", function () { el.style.background = "var(--mantine-color-dark-5,#2c2e33)"; });
                el.addEventListener("mouseleave", function () { el.style.background = ""; });
            }

            function makeItem(label, italic, onClick)
            {
                let el = document.createElement("div");
                el.style.cssText = ITEM_BASE + (italic ? "font-style:italic;" : "");
                hover(el);
                let span = document.createElement("span");
                span.textContent = label;
                span.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                el.appendChild(span);
                el.addEventListener("mousedown", function (ev)
                {
                    ev.preventDefault();
                    ev.stopPropagation();
                    removeContextMenu();
                    onClick();
                });
                return el;
            }

            function makeDivider()
            {
                let d = document.createElement("div");
                d.style.cssText = "border-top:1px solid var(--mantine-color-dark-4,#373a40);margin:4px 0;";
                return d;
            }

            function makeSubmenu(tagLabel, tagPairs)
            {
                let group = document.createElement("div");
                group.style.position = "relative";

                let trigger = document.createElement("div");
                trigger.style.cssText = ITEM_BASE;
                hover(trigger);
                // Will be updated after storage read below
                trigger.title = "";

                let trigSpan = document.createElement("span");
                trigSpan.textContent = tagLabel;
                trigSpan.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                let arrow = document.createElement("span");
                arrow.textContent = "▶";
                arrow.style.cssText = "font-size:14px;color:#64748b;flex-shrink:0;padding:0 8px;margin-left:2px;cursor:pointer;";
                trigger.appendChild(trigSpan);
                trigger.appendChild(arrow);

                // Shared by the trigger row itself and the dedicated menu
                // item below — sends according to the configured pairMode
                // (random: one random pick, sequential: next in rotation,
                // static/all: every workflow in the tag).
                async function sendTagByMode(tp, tl, cfg)
                {
                    let mode = cfg.pairMode || "static";
                    startNewBatch();

                    // resolveTagPairs() (shared.js) does the actual random /
                    // sequential-with-randomized-start / all resolution —
                    // same logic the native right-click menu uses.
                    let picks = await resolveTagPairs(tl, tp, mode);
                    if (picks.length === 0) return;

                    browser.storage.local.set({ lastSentIntent: { type: "tag", tag: tl, mode: mode === "static" ? "all" : mode } });
                    for (let p of picks) { sendWithSpecificPair(prompt, p, btn, imageId); }
                }

                // Click trigger — behaviour depends on configured pairMode.
                // Kept for convenience, but hovering the arrow to open the
                // submenu can make a clean click on the row itself fiddly —
                // see the dedicated "Per workflow settings" item below.
                trigger.addEventListener("mousedown", (function (tp, tl)
                {
                    return function (ev)
                    {
                        ev.preventDefault();
                        ev.stopPropagation();
                        browser.storage.local.get(["pairMode", "tagSequentialIndex"]).then(function (cfg)
                        {
                            removeContextMenu();
                            sendTagByMode(tp, tl, cfg);
                        });
                    };
                })(tagPairs, tagLabel));

                let sub = document.createElement("div");
                sub.style.cssText = MENU_CSS + ";display:none;overflow-y:auto;overscroll-behavior:contain;";

                sub.appendChild(makeItem("All " + tagLabel, true, (function (tp, tl) { return function ()
                {
                    startNewBatch();
                    browser.storage.local.set({ lastSentIntent: { type: "tag", tag: tl, mode: "all" } });
                    for (let p of tp) { sendWithSpecificPair(prompt, p, btn, imageId); }
                }; })(tagPairs, tagLabel)));

                // Dedicated, always-clickable equivalent of the trigger-row
                // gesture — only shown when it would behave differently
                // from "All <tag>" above (random/sequential modes).
                let smartItemSlot = document.createElement("div");
                sub.appendChild(smartItemSlot);

                sub.appendChild(makeDivider());
                for (let p of tagPairs)
                {
                    sub.appendChild(makeItem(p.name, false, (function (pair) { return function () { startNewBatch(); browser.storage.local.set({ lastSentIntent: { type: "named", names: [pair.name] } }); sendWithSpecificPair(prompt, pair, btn, imageId); }; })(p)));
                }

                document.documentElement.appendChild(sub);
                activeSubmenus.push(sub);

                // Pre-calculate direction based on menu position — set arrow before showing
                function updateArrowDirection()
                {
                    let mr = menu.getBoundingClientRect();
                    let estimatedSubWidth = 200; // conservative estimate
                    let opensLeft = (mr.right + 4 + estimatedSubWidth) > window.innerWidth;
                    if (opensLeft)
                    {
                        arrow.textContent = "◀";
                        arrow.style.order = "-1";
                        arrow.style.marginLeft = "0";
                        arrow.style.marginRight = "2px";
                    }
                    else
                    {
                        arrow.textContent = "▶";
                        arrow.style.order = "";
                        arrow.style.marginLeft = "2px";
                        arrow.style.marginRight = "0";
                    }
                }

                function showSub()
                {
                    let tr  = trigger.getBoundingClientRect();
                    let mr  = menu.getBoundingClientRect();
                    // Cap height to available viewport space from trigger top
                    let availableH = window.innerHeight - tr.top - 8;
                    sub.style.maxHeight = Math.max(120, availableH) + "px";
                    sub.style.display = "block";
                    let sw  = sub.offsetWidth;
                    let sh  = sub.offsetHeight;
                    let x = mr.right + 4;
                    let opensLeft = false;
                    if (x + sw > window.innerWidth) { x = mr.left - sw - 4; opensLeft = true; }
                    let y = tr.top;
                    if (y + sh > window.innerHeight) y = window.innerHeight - sh - 8;
                    sub.style.left = x + "px";
                    sub.style.top  = y + "px";
                }

                // Register arrow updater — called after menu is in DOM and positioned
                submenuArrowUpdaters.push(updateArrowDirection);

                // Show on arrow enter, stay open until another arrow is hovered or menu closes
                arrow.addEventListener("mouseenter", function ()
                {
                    // Hide all other open subs first
                    for (let s of activeSubmenus)
                    {
                        if (s !== sub) s.style.display = "none";
                    }
                    showSub();
                });

                browser.storage.local.get(["pairMode"]).then((function (tp, tl) { return function (cfg)
                {
                    let mode = cfg.pairMode || "static";
                    if (mode === "sequential")
                        trigger.title = "Click to send next sequential workflow in this tag";
                    else if (mode === "random")
                        trigger.title = "Click to send a random workflow from this tag";
                    else
                        trigger.title = "Click to send all workflows in this tag";

                    // Only add a dedicated item when it behaves differently
                    // from "All <tag>" — for static/all modes they're identical.
                    if (mode === "random" || mode === "sequential")
                    {
                        let label = mode === "random" ? "Random from " + tl : "Next in rotation";
                        let item = makeItem(label, true, function ()
                        {
                            // Fresh read (not the mode snapshot from menu build time) so
                            // sequential rotation doesn't go stale across menu opens.
                            browser.storage.local.get(["pairMode", "tagSequentialIndex"]).then(function (freshCfg)
                            {
                                sendTagByMode(tp, tl, freshCfg);
                            });
                        });
                        smartItemSlot.replaceWith(item);
                    }
                    else
                    {
                        smartItemSlot.remove();
                    }
                }; })(tagPairs, tagLabel));

                group.appendChild(trigger);
                return group;
            }

            let menu = document.createElement("div");
            menu.style.cssText = MENU_CSS + ";overflow-y:auto;overscroll-behavior:contain;";
            let submenuArrowUpdaters = [];

            let header = document.createElement("div");
            header.style.cssText = "padding:4px 8px 6px;color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--mantine-color-dark-4,#373a40);margin-bottom:4px;";
            header.textContent = "Send with workflow";
            menu.appendChild(header);

            menu.appendChild(makeItem("All workflows", true, function ()
            {
                startNewBatch();
                browser.storage.local.set({ lastSentIntent: { type: "all" } });
                for (let p of pairs) { sendWithSpecificPair(prompt, p, btn, imageId); }
            }));
            menu.appendChild(makeDivider());

            // Group by tags
            let tagMap = {};
            let untagged = [];
            for (let p of pairs)
            {
                let raw = (p.tags || "").trim();
                if (!raw) { untagged.push(p); continue; }
                let tags = raw.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
                for (let tag of tags)
                {
                    if (!tagMap[tag]) tagMap[tag] = [];
                    tagMap[tag].push(p);
                }
            }

            let sortedTags = Object.keys(tagMap).sort();
            for (let tag of sortedTags)
            {
                menu.appendChild(makeSubmenu(tag, tagMap[tag]));
            }

            if (untagged.length > 0)
            {
                if (sortedTags.length > 0) menu.appendChild(makeDivider());
                for (let p of untagged)
                {
                    menu.appendChild(makeItem(p.name, false, (function (pair) { return function () { startNewBatch(); browser.storage.local.set({ lastSentIntent: { type: "named", names: [pair.name] } }); sendWithSpecificPair(prompt, pair, btn, imageId); }; })(p)));
                }
            }

            document.documentElement.appendChild(menu);
            activeMenu = menu;

            let x = e.clientX, y = e.clientY;
            let mw = menu.offsetWidth, mh = menu.offsetHeight;
            if (x + mw > window.innerWidth)  x = window.innerWidth  - mw - 8;
            if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
            if (y < 8) y = 8;
            menu.style.maxHeight = (window.innerHeight - y - 8) + "px";
            menu.style.left = x + "px";
            menu.style.top  = y + "px";

            // Now menu is positioned — update all submenu arrows correctly
            for (let fn of submenuArrowUpdaters) { fn(); }

            menuDismissHandler = function (ev)
            {
                if (activeMenu && !activeMenu.contains(ev.target))
                    removeContextMenu();
            };
            setTimeout(function ()
            {
                document.addEventListener("mousedown", menuDismissHandler, true);
            }, 50);
        });
    }

    // Track pending sends per button to avoid premature restore
    let btnPendingMap = new WeakMap();

    async function sendWithSpecificPair(prompt, pair, btn, imageId)
    {
        let settings = await browser.storage.local.get(["comfyUrl", "globalBannedTags", "modelMode", "selectedModels", "staticModel", "seedMode"]);
        let comfyUrl = (settings.comfyUrl || "").replace(/\/$/, "");
        if (!comfyUrl) { showToast("⚠️ No ComfyUI URL set."); return; }

        let workflowRaw = pair.workflow;
        let suffix = (pair.suffix || "").trim();
        if (!workflowRaw) { showToast("⚠️ Workflow is empty."); return; }

        let workflowTemplate;
        try { workflowTemplate = JSON.parse(workflowRaw); }
        catch (e) { showToast("❌ Invalid JSON in: " + pair.name); return; }

        // Increment pending counter for this button
        btnPendingMap.set(btn, (btnPendingMap.get(btn) || 0) + 1);
        btn.disabled = true;
        btn.style.opacity = "0.4";
        btn.style.cursor  = "default";

        let mergedBanned = [settings.globalBannedTags, pair.bannedTags].filter(Boolean).join(",");
        let filteredPrompt = filterBannedTags(prompt, mergedBanned);
        let suffixPosition = pair.suffixPosition || "suffix";
        let finalPrompt  = injectCustomText(filteredPrompt, suffix, suffixPosition);
        let modelToInject = null;
        let modelMode = settings.modelMode || "default";
        if (modelMode === "static" && settings.staticModel)
            modelToInject = settings.staticModel;
        else if (modelMode === "random" && settings.selectedModels && settings.selectedModels.length > 0)
            modelToInject = settings.selectedModels[Math.floor(Math.random() * settings.selectedModels.length)];

        let seedMode = settings.seedMode || "workflow";
        let staticSeedCtx = (seedMode === "static") ? Math.floor(Math.random() * 2147483647) : null;
        let payload  = buildPayload(finalPrompt, workflowTemplate, modelToInject, seedMode, staticSeedCtx, imageId);


        browser.runtime.sendMessage({ type: "COMFYUI_FETCH", url: comfyUrl + "/prompt", body: JSON.stringify(payload) })
        .then(function (response)
        {
            let pending = (btnPendingMap.get(btn) || 1) - 1;
            btnPendingMap.set(btn, pending);
            let last = pending === 0;

            if (last)
            {
                btn.disabled = false;
                btn.style.opacity = "0.7";
                btn.style.cursor  = "pointer";
            }
            if (response && response.ok)
            {
                trackPromptIdFromResponse(response.body);
                showToast("✅ Sent with: " + pair.name);
                if (last) showBtnSuccess(btn);
            }
            else
            {
                showToast("❌ ComfyUI error " + (response ? response.status : ""));
                if (last) showBtnError(btn);
            }
        })
        .catch(function ()
        {
            let pending = (btnPendingMap.get(btn) || 1) - 1;
            btnPendingMap.set(btn, pending);
            if (pending === 0)
            {
                btn.disabled = false;
                btn.style.opacity = "0.7";
                btn.style.cursor  = "pointer";
            }
            showToast("❌ Could not reach ComfyUI.");
            showBtnError(btn);
        });
    }

    // ── Toast ──────────────────────────────────────────────────────────────────

    function showToast(message)
    {
        let existing = document.getElementById("civitai-comfyui-toast");
        if (existing) existing.remove();

        let toast = document.createElement("div");
        toast.id = "civitai-comfyui-toast";
        toast.textContent = message;
        toast.style.cssText = [
            "position: fixed",
            "bottom: 24px",
            "right: 24px",
            "z-index: 2147483647",
            "background: var(--mantine-color-dark-6, #1a1b1e)",
            "color: var(--mantine-color-gray-0, #f8f9fa)",
            "padding: 12px 20px",
            "border-radius: 8px",
            "font-size: 13px",
            "font-family: var(--mantine-font-family, sans-serif)",
            "box-shadow: 0 4px 24px rgba(0,0,0,0.6)",
            "border: 1px solid var(--mantine-color-dark-4, #373a40)",
            "opacity: 1",
            "pointer-events: none"
        ].join(";");

        document.documentElement.appendChild(toast);

        setTimeout(function ()
        {
            toast.remove();
        }, 4000);
    }

    // ── Button factory ─────────────────────────────────────────────────────────

    function createComfyButton(panel)
    {
        let btn = document.createElement("button");
        btn.title = "Send prompt to ComfyUI";
        btn.className = "civitai-comfyui-btn";
                                let _img = document.createElement("img");
        _img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAY1BMVEVMaXEXLdcXLNgXLdcXLNgWLdcWLNcWLdcXLdgTMNjw/0Hu/UkfMtf2/yUAAdoQKdcYMOUnONYAAN0XLt3S4Hr4/w4vP9UAGtng72TBz4rz/zZEUdKir6e0wphyfsGPm7NaZ8k8Nl+9AAAACnRSTlMAyJb/LLZe+eQFPzCELgAAAAlwSFlzAAAsSwAALEsBpT2WqQAAAsZJREFUeNqll4F2qjAMhlFEnQ0tqUARQX3/p7wp6l1aAuj4z3bOjiOfSROSNEm8fuh3t99mm+MH2mTb/e5l9BL9ud+kBen8gfxz6WbPCD/JLqPPDqT0Aw3PFUW2exPI/lh8ZsspxfFFIPtD8aX5gCgOA+H5/Wn6F8LLh+xv9p6Q+RD2f7X3BMpFslkD2FD9LDyEsSD4924+AoO105EQTBDDdgZg0Fh3DVVrBwywnc0BateVTaTeGeB5mDlDcHVZ5bGqztb8FI/nGQculRopLzX8d+F8nAaY2t7a01j5RWPKAJMBEKDPJQCFwPIwDQDQpQQ4PULAhDFArR9KCMEfAX9UABhA45xDexccUFXPHZAAvno0Yo3mkivBg5vFWYBB964eKQdtU7t0LgSyh1f1SPaqulicBfDqEexz9QjPMAY8q4eZRmXc3HTowMiD2nbB0ZUXrg5i+xgAKVWP4km32jK5IAMCAH31qN8j6+wVayaI7UeAsHraKOlmXHZJXP99pVjSjVlqrBHAYZOrybL9AKB5C1D53eJ3ALQdj0Bdo6r5wIOSR1Au24cA0FfWAnwS8SuA8UlUPIn6S0BtL79HoPIG2QxJzTIAjGnasPcgvBUPRQHg38SweQUz0TpYBnRhFyy5ehQJyVwf562gJYcA5gHoq4C3IjbQTsp3Q1gK4V5VOf1I44SSsgTwhXT3fac8ye10KQRPsMOBl8JAGN6sxXeBNiJ4HsXIvqV+LAIOo8GmH+IRlNoIgPF09tVQKXkmSpveaMGgN0qcidQehe4kbCi0GAlDkaqA2l0qAeIlywNOo8Wore6SA37JGq15aHtfTaHaTkyBX/NGiyY46MpI/c2CvCxvhVUXnNWOaXiXEabWdWHZphUnFH0y1dF28roPkebW/fUXjrVXnvWXrrXXvvUXz/VX3/DyvWQuXb6D6/+sF/Td8fX/H6zEdFpdV1ECAAAAAElFTkSuQmCC";
        _img.width = 22;
        _img.height = 22;
        _img.alt = "ComfyUI";
        _img.style.cssText = "display:block;flex-shrink:0;min-width:16px;min-height:16px;width:16px;height:16px;";
        btn.appendChild(_img);

        btn.style.cssText = [
            "display: inline-flex",
            "align-items: center",
            "justify-content: center",
            "padding: 4px",
            "border-radius: 4px",
            "border: none",
            "background: transparent",
            "color: inherit",
            "cursor: pointer",
            "vertical-align: middle",
            "line-height: 1",
            "opacity: 0.7",
            "transition: opacity 0.15s",
            "flex-shrink: 0",
            "min-width: 36px",
            "min-height: 36px",
            "width: 36px",
            "height: 36px",
            "box-sizing: border-box",
            "touch-action: manipulation",
            "-webkit-tap-highlight-color: transparent"
        ].join(";");

        btn.addEventListener("mouseenter", function ()
        {
            btn.style.opacity = "1";
        });

        btn.addEventListener("mouseleave", function ()
        {
            btn.style.opacity = "0.7";
        });

        btn.addEventListener("contextmenu", async function (e)
        {
            e.preventDefault();
            e.stopPropagation();
            let prompt = extractPromptFromPanel(panel) || await tryFallbackPrompt(panel);
            if (!prompt) { showToast("⚠️ Could not find prompt text."); return; }
            showWorkflowContextMenu(e, prompt, btn, resolveImageId());
        }, true);

        btn.addEventListener("click", async function (e)
        {
            e.preventDefault();
            e.stopPropagation();

            let prompt = extractPromptFromPanel(panel) || await tryFallbackPrompt(panel);

            if (!prompt)
            {
                showToast("⚠️ Could not find prompt text.");
                return;
            }
            sendToComfyUI(prompt, btn, resolveImageId());
        });

        applyServerState(btn);
        return btn;
    }

    // ── Find the first copy icon button in the Prompt section ──────────────────

    function findFirstPromptCopyBtn(panel)
    {
        // Find any p/span whose text is exactly "Prompt" (no child elements)
        let allEls = panel.querySelectorAll("p, span");
        for (let el of allEls)
        {
            if (el.children.length > 0) continue;
            if (el.textContent.trim() !== "Prompt") continue;

            // Walk up through parent rows to find a copy icon button
            let node = el;
            for (let i = 0; i < 5; i++)
            {
                node = node.parentElement;
                if (!node) break;

                // Look for copy icon in this container or its siblings
                let copyIcon = node.querySelector(".tabler-icon-copy");
                if (copyIcon)
                {
                    let btn = copyIcon.closest("button");
                    if (btn) return btn;
                }
            }
        }

        return null;
    }

    // ── Panel injection ────────────────────────────────────────────────────────

    function injectIntoPanel(panel)
    {
        if (processedPanels.has(panel)) return;

        // Don't inject if already done
        if (panel.querySelector(".civitai-comfyui-btn")) return;

        let copyBtn = findFirstPromptCopyBtn(panel);
        if (!copyBtn) return;

        // Presence of a "Prompt" header + copy icon is enough to inject the
        // button — the actual text is resolved (DOM, then embedded-metadata
        // fallback) lazily at click time, since the DOM text can be blank
        // while the source image still carries the prompt.
        let comfyBtn = createComfyButton(panel);
        copyBtn.parentElement.insertBefore(comfyBtn, copyBtn);

        processedPanels.add(panel);
    }

    function scanForPanels()
    {
        // Strategy A: floating popovers (images feed / model pages)
        let panels = document.querySelectorAll("[id^='headlessui-popover-panel']");
        for (let panel of panels)
        {
            injectIntoPanel(panel);
        }

        // Strategy C: tag buttons on individual image pages
        let tagsContainer = findTagsContainer();
        if (tagsContainer) injectTagButton(tagsContainer);

        // Strategy B: static generation data card (individual image/post pages)
        let allP = document.querySelectorAll("p");

        let promptPs = [];
        for (let p of allP)
        {
            let t = p.textContent.trim();
            if (t === "Prompt") promptPs.push(p);
        }

        for (let p of promptPs)
        {

            let headerRow = p.closest("div.flex.items-center.justify-between");
            if (!headerRow)
            {
                // Try without the justify-between requirement
                headerRow = p.closest("div.flex.items-center");
            }
            if (!headerRow) continue;

            if (headerRow.closest("[id^='headlessui-popover-panel']"))
            {
                continue;
            }

            // Find the buttons div — it has items-center and gap-1 but NOT flex-wrap
            let btnGroup = null;
            let candidates = headerRow.querySelectorAll("div.flex.items-center.gap-1");
            for (let candidate of candidates)
            {
                if (!candidate.classList.contains("flex-wrap"))
                {
                    btnGroup = candidate;
                    break;
                }
            }
            if (!btnGroup) continue;

            if (btnGroup.querySelector(".civitai-comfyui-btn"))
            {
                continue;
            }

            let firstCopyBtn = btnGroup.querySelector("button");
            if (!firstCopyBtn) continue;

            let card = p.closest(".mantine-Card-root, .rounded-xl, [class*='Card']");
            if (!card) card = headerRow.parentElement;

            // Text is resolved lazily at click time (DOM, then fallback) —
            // see injectIntoPanel for why we no longer gate on it here.
            let comfyBtn = createComfyButton(card);
            btnGroup.insertBefore(comfyBtn, firstCopyBtn);
        }
    }

    // ── MutationObserver ───────────────────────────────────────────────────────

    let observer = new MutationObserver(function (mutations)
    {
        let shouldScan = false;

        for (let mutation of mutations)
        {
            for (let node of mutation.addedNodes)
            {
                if (node.nodeType === 1)
                {
                    shouldScan = true;
                    break;
                }
            }
            if (shouldScan) break;
        }

        if (shouldScan) scanForPanels();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial scans — retry several times for slow React hydration on image/post pages
    scanForPanels();
    setTimeout(scanForPanels, 1000);
    setTimeout(scanForPanels, 2500);
    setTimeout(scanForPanels, 5000);
    setTimeout(scanForPanels, 8000);

    // CivitAI is a Next.js SPA — handle client-side navigation
    // Re-scan when URL changes (pushState / popstate)
    let lastUrl = location.href;

    function onUrlChange()
    {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        // Reset processed panels so buttons get re-injected on new page
        processedPanels = new WeakSet();
        // Staggered scans to catch React hydration at different speeds
        setTimeout(scanForPanels, 500);
        setTimeout(scanForPanels, 1500);
        setTimeout(scanForPanels, 3000);
        setTimeout(checkServerAvailability, 500);
    }

    // Intercept pushState (Next.js router uses this)
    let origPushState = history.pushState;
    history.pushState = function ()
    {
        origPushState.apply(this, arguments);
        onUrlChange();
    };

    let origReplaceState = history.replaceState;
    history.replaceState = function ()
    {
        origReplaceState.apply(this, arguments);
        onUrlChange();
    };

    window.addEventListener("popstate", onUrlChange);

})();