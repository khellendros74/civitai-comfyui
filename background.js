// background.js

// ── Toolbar click: open options — Ctrl+click: cancel queued (not yet started) prompts ──
browser.browserAction.onClicked.addListener(function (tab, info)
{
    if (info && info.modifiers && info.modifiers.indexOf("Ctrl") !== -1)
    {
        cancelLastBatch();
        return;
    }
    browser.runtime.openOptionsPage();
});

// Ids of prompts queued by the last user-initiated send action (in-memory only)
let currentBatchIds = [];

function cancelLastBatch()
{
    if (currentBatchIds.length === 0) return;

    browser.storage.local.get(["comfyUrl"]).then(function (s)
    {
        let url = (s.comfyUrl || "").trim().replace(/\/$/, "");
        if (!url) return;

        let idsToDelete = currentBatchIds;
        currentBatchIds = [];

        fetch(url + "/queue",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ delete: idsToDelete })
        })
        .then(function () { scheduleCheckStatus(); })
        .catch(function () {});
    });
}

// ── Icon / badge based on server status + selection state ─────────────────────

function checkStatus()
{
    browser.storage.local.get(["comfyUrl", "selectedPairs"]).then(function (s)
    {
        let url = (s.comfyUrl || "").trim();
        let hasSelection = s.selectedPairs && s.selectedPairs.length > 0;
        let okColor = hasSelection ? "#22c55e" : "#f59e0b";

        if (!url)
        {
            browser.browserAction.setBadgeBackgroundColor({ color: "#64748b" });
            browser.browserAction.setBadgeText({ text: "?" });
            return;
        }

        let base = url.replace(/\/$/, "");

        fetch(base + "/system_stats", { method: "GET", signal: AbortSignal.timeout(5000) })
        .then(function (r)
        {
            if (r.ok)
            {
                browser.browserAction.setBadgeBackgroundColor({ color: okColor });
                browser.browserAction.setBadgeText({ text: "✓" });
                updateQueueBadge(base);
            }
            else
            {
                browser.browserAction.setBadgeBackgroundColor({ color: "#ef4444" });
                browser.browserAction.setBadgeText({ text: "!" });
            }
        })
        .catch(function ()
        {
            browser.browserAction.setBadgeBackgroundColor({ color: "#ef4444" });
            browser.browserAction.setBadgeText({ text: "!" });
        });
    });
}

// Queue size via lightweight GET /prompt — avoids the full /queue payload
function updateQueueBadge(base)
{
    fetch(base + "/prompt", { method: "GET", signal: AbortSignal.timeout(5000) })
    .then(function (r) { return r.json(); })
    .then(function (data)
    {
        let n = (data && data.exec_info && typeof data.exec_info.queue_remaining === "number") ? data.exec_info.queue_remaining : 0;
        browser.browserAction.setBadgeText({ text: n > 0 ? (n > 99 ? "99+" : String(n)) : "✓" });
    })
    .catch(function ()
    {
        browser.browserAction.setBadgeText({ text: "✓" });
    });
}

// Check on startup and every 60s
checkStatus();
setInterval(checkStatus, 60000);

// Debounced trigger — collapses bursts (e.g. "All" / tag-group sends firing
// one COMFYUI_FETCH per pair) into a single status+queue check after the burst settles
let checkStatusDebounceTimer = null;
function scheduleCheckStatus()
{
    clearTimeout(checkStatusDebounceTimer);
    checkStatusDebounceTimer = setTimeout(checkStatus, 800);
}

// React immediately when selectedPairs changes
browser.storage.onChanged.addListener(function (changes)
{
    if (changes.selectedPairs) checkStatus();
    if (changes.pairs || changes.pairMode) rebuildContextMenus();
});

// Updates the top-level "Send prompt to ComfyUI" title right before the
// native menu opens, so it reflects the actual replay target (e.g. "Next in
// rotation") whenever nothing is explicitly selected in the options page.
browser.contextMenus.onShown.addListener(function (info)
{
    if (!info.menuIds || info.menuIds.indexOf("civitai-comfyui-send-default") === -1) return;

    browser.storage.local.get(["pairs", "selectedPairs", "lastSentIntent"]).then(function (s)
    {
        let pairs        = s.pairs || [];
        let hasSelection = s.selectedPairs && s.selectedPairs.length > 0;
        let title = "Send prompt to ComfyUI";

        if (pairs.length > 0 && !hasSelection)
        {
            let replay = resolveReplayInfo(pairs, s.lastSentIntent);
            let label  = null;

            if (replay.kind === "named")      label = replay.names.join(", ");
            else if (replay.kind === "all")   label = "All workflows";
            else if (replay.kind === "tag")
            {
                if (replay.mode === "random")         label = "Random (" + replay.tag + ")";
                else if (replay.mode === "sequential") label = "Next in rotation";
                else                                    label = "All \"" + replay.tag + "\"";
            }

            if (label) title = label;
        }

        browser.contextMenus.update("civitai-comfyui-send-default", { title: title }).then(function ()
        {
            browser.contextMenus.refresh();
        });
    });
});

// extractPromptFromImageBuffer(), buildPayload() and filterBannedTags() are
// defined in shared.js (loaded before this script — see manifest.json).

// ── Native right-click menu (feed grid has no metadata panel to attach to) ──
// CivitAI's /images feed no longer exposes a per-card generation-data panel,
// so there's no DOM element to inject our button into there. Instead we hook
// the browser's native image context menu directly and pull the prompt from
// the image file itself — this needs no CivitAI DOM structure at all, so it
// keeps working regardless of feed layout changes.

function rebuildContextMenus()
{
    browser.contextMenus.removeAll().then(function ()
    {
        let patterns = ["*://civitai.com/*", "*://civitai.red/*"];

        browser.contextMenus.create({
            id: "civitai-comfyui-send-default",
            title: "Send prompt to ComfyUI",
            contexts: ["image"],
            documentUrlPatterns: patterns
        });

        browser.storage.local.get(["pairs", "pairMode"]).then(function (s)
        {
            let pairs = s.pairs || [];
            if (pairs.length === 0) return;

            let mode = VALID_PAIR_MODES.includes(s.pairMode) ? s.pairMode : "static";

            browser.contextMenus.create({
                id: "civitai-comfyui-send-with",
                title: "Send with workflow",
                contexts: ["image"],
                documentUrlPatterns: patterns
            });

            browser.contextMenus.create({
                id: "civitai-comfyui-send-with-all",
                parentId: "civitai-comfyui-send-with",
                title: "All workflows",
                contexts: ["image"]
            });

            // Group by tag, same rule as the old custom HTML menu: a pair
            // with multiple tags shows up under each of them.
            let tagMap = {};
            let untagged = [];

            for (let pair of pairs)
            {
                let tags = (pair.tags || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
                if (tags.length === 0) { untagged.push(pair); continue; }
                for (let tag of tags)
                {
                    if (!tagMap[tag]) tagMap[tag] = [];
                    tagMap[tag].push(pair);
                }
            }

            let sortedTags = Object.keys(tagMap).sort(function (a, b) { return a.localeCompare(b); });

            if (sortedTags.length > 0 || untagged.length > 0)
            {
                browser.contextMenus.create({
                    id: "civitai-comfyui-sep-top",
                    parentId: "civitai-comfyui-send-with",
                    type: "separator",
                    contexts: ["image"]
                });
            }

            for (let tag of sortedTags)
            {
                let tagId = "civitai-comfyui-tag::" + tag;

                browser.contextMenus.create({
                    id: tagId,
                    parentId: "civitai-comfyui-send-with",
                    title: tag,
                    contexts: ["image"]
                });

                browser.contextMenus.create({
                    id: "civitai-comfyui-tag-all::" + tag,
                    parentId: tagId,
                    title: "All " + tag,
                    contexts: ["image"]
                });

                // Only add a dedicated item when it behaves differently
                // from "All <tag>" above — identical for static/all modes.
                if (mode === "random" || mode === "sequential")
                {
                    browser.contextMenus.create({
                        id: "civitai-comfyui-tag-smart::" + tag,
                        parentId: tagId,
                        title: mode === "random" ? "Random from " + tag : "Next in rotation",
                        contexts: ["image"]
                    });
                }

                browser.contextMenus.create({
                    id: tagId + "-sep",
                    parentId: tagId,
                    type: "separator",
                    contexts: ["image"]
                });

                let sortedTagPairs = tagMap[tag].slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
                for (let pair of sortedTagPairs)
                {
                    browser.contextMenus.create({
                        id: "civitai-comfyui-tagpair::" + tag + "::" + pair.name,
                        parentId: tagId,
                        title: pair.name,
                        contexts: ["image"]
                    });
                }
            }

            let sortedUntagged = untagged.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
            for (let pair of sortedUntagged)
            {
                browser.contextMenus.create({
                    id: "civitai-comfyui-pair::" + pair.name,
                    parentId: "civitai-comfyui-send-with",
                    title: pair.name,
                    contexts: ["image"]
                });
            }
        });
    });
}

// pairHasTag() and resolveTagPairs() are defined in shared.js so both the
// native menu here and the custom menu in content.js stay in sync.

let VALID_PAIR_MODES = ["static", "random", "sequential", "all"];

// Same resolution the injected button's sendToComfyUI() uses for its
// "nothing explicit" click: explicit selectedPairs+pairMode config first,
// then replay whatever was last explicitly sent (from either send path —
// they share the same lastSentIntent in storage), then the flagged Default.
async function resolveDefaultPairs(settings, pairs)
{
    if (pairs.length === 0) return [];

    let hasSelection = settings.selectedPairs && settings.selectedPairs.length > 0;
    let pairMode = VALID_PAIR_MODES.includes(settings.pairMode) ? settings.pairMode : "static";
    let pairsToSend = [];

    if (hasSelection)
    {
        if (pairMode === "random")
        {
            let pool = pairs.filter(function (p) { return settings.selectedPairs.includes(p.name); });
            if (pool.length > 0) pairsToSend.push(pool[Math.floor(Math.random() * pool.length)]);
        }
        else if (pairMode === "sequential")
        {
            let pool = pairs.filter(function (p) { return settings.selectedPairs.includes(p.name); });
            if (pool.length > 0)
            {
                let idx;
                if (!settings.sequentialStarted)
                {
                    idx = Math.floor(Math.random() * pool.length);
                    await browser.storage.local.set({ sequentialStarted: true, sequentialIndex: (idx + 1) % pool.length });
                }
                else
                {
                    idx = (settings.sequentialIndex || 0) % pool.length;
                    await browser.storage.local.set({ sequentialIndex: (idx + 1) % pool.length });
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
            let chosenPair = pairs.find(function (p) { return p.name === settings.staticPair && settings.selectedPairs.includes(p.name); })
                          || pairs.find(function (p) { return settings.selectedPairs.includes(p.name); })
                          || null;
            if (chosenPair) pairsToSend.push(chosenPair);
        }

        return pairsToSend;
    }

    // Nothing selected — replay last sent intent, or fall back to Default
    let intent = settings.lastSentIntent;
    if (intent)
    {
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
            pairsToSend = await resolveTagPairs(intent.tag, pairs, intent.mode);
        }
    }

    if (pairsToSend.length === 0)
    {
        let def = pairs.find(function (p) { return p.isDefault; });
        if (def) pairsToSend.push(def);
    }

    return pairsToSend;
}

rebuildContextMenus();

function notifyTab(tabId, message)
{
    if (typeof tabId !== "number") return;
    browser.tabs.sendMessage(tabId, { type: "COMFYUI_TOAST", message: message }).catch(function () {});
}

async function fetchEmbeddedPrompt(url)
{
    let urls = [url];
    if (url.indexOf("optimized=true") !== -1) urls.push(url.replace("optimized=true", "original=true"));

    // CivitAI's jpeg delivery strips embedded generation metadata — the same
    // asset served with a .png extension usually still has it, so add a png
    // variant right after each jpeg candidate.
    let withPng = [];
    for (let u of urls)
    {
        withPng.push(u);
        let pngUrl = u.replace(/\.jpe?g(\?|$)/i, ".png$1");
        if (pngUrl !== u) withPng.push(pngUrl);
    }
    urls = withPng;

    let anyFetchSucceeded = false;

    for (let u of urls)
    {
        try
        {
            // Some CDN configs check Referer for hotlink protection — image
            // requests made straight from the background script otherwise
            // have no referrer at all.
            let r = await fetch(u, {
                signal: AbortSignal.timeout(15000),
                referrer: "https://civitai.com/",
                referrerPolicy: "strict-origin-when-cross-origin"
            });
            if (!r.ok) continue;

            let buf = await r.arrayBuffer();
            anyFetchSucceeded = true;
            let result = extractPromptFromImageBuffer(buf);
            if (result && result.prompt) return result;
        }
        catch (e) {}
    }

    return anyFetchSucceeded ? null : { networkError: true };
}

async function handleNativeSend(info, tabId)
{
    if (!info.srcUrl) { notifyTab(tabId, "⚠️ No image found under cursor."); return; }

    let imageId = null;
    if (info.linkUrl)
    {
        let m = info.linkUrl.match(/\/images\/(\d+)/);
        if (m) imageId = m[1];
    }

    let promptData = await fetchEmbeddedPrompt(info.srcUrl);
    if (!promptData || !promptData.prompt)
    {
        let msg = (promptData && promptData.networkError)
            ? "⚠️ Could not download the image to read its metadata."
            : "⚠️ No embedded prompt found in this image.";
        notifyTab(tabId, msg);
        return;
    }

    let settings = await browser.storage.local.get([
        "comfyUrl", "globalBannedTags", "promptSuffix", "promptSuffixPosition", "workflow",
        "modelMode", "selectedModels", "staticModel", "seedMode", "samplerMode", "pairs",
        "pairMode", "selectedPairs", "staticPair", "sequentialIndex",
        "sequentialStarted", "tagSequentialIndex", "lastSentIntent"
    ]);
    let comfyUrl = (settings.comfyUrl || "").replace(/\/$/, "");
    if (!comfyUrl) { notifyTab(tabId, "⚠️ Set your ComfyUI server URL in the extension options."); return; }

    let pairs = settings.pairs || [];
    let pairsToSend = [];

    let menuItemId = info.menuItemId;

    if (menuItemId === "civitai-comfyui-send-with-all")
    {
        pairsToSend = pairs.slice();
        await browser.storage.local.set({ lastSentIntent: { type: "all" } });
    }
    else if (typeof menuItemId === "string" && menuItemId.indexOf("civitai-comfyui-tag-all::") === 0)
    {
        let tag = menuItemId.slice("civitai-comfyui-tag-all::".length);
        pairsToSend = pairs.filter(function (p) { return pairHasTag(p, tag); });
        await browser.storage.local.set({ lastSentIntent: { type: "tag", tag: tag, mode: "all" } });
    }
    else if (typeof menuItemId === "string" && menuItemId.indexOf("civitai-comfyui-tag-smart::") === 0)
    {
        let tag = menuItemId.slice("civitai-comfyui-tag-smart::".length);
        let mode = VALID_PAIR_MODES.includes(settings.pairMode) ? settings.pairMode : "static";
        pairsToSend = await resolveTagPairs(tag, pairs, mode);
        await browser.storage.local.set({ lastSentIntent: { type: "tag", tag: tag, mode: mode === "static" ? "all" : mode } });
    }
    else if (typeof menuItemId === "string" && menuItemId.indexOf("civitai-comfyui-tagpair::") === 0)
    {
        let rest = menuItemId.slice("civitai-comfyui-tagpair::".length);
        let sepIdx = rest.indexOf("::");
        let name = sepIdx !== -1 ? rest.slice(sepIdx + 2) : rest;
        let p = pairs.find(function (q) { return q.name === name; });
        if (p) pairsToSend.push(p);
        await browser.storage.local.set({ lastSentIntent: { type: "named", names: [name] } });
    }
    else if (typeof menuItemId === "string" && menuItemId.indexOf("civitai-comfyui-pair::") === 0)
    {
        let name = menuItemId.slice("civitai-comfyui-pair::".length);
        let p = pairs.find(function (q) { return q.name === name; });
        if (p) pairsToSend.push(p);
        await browser.storage.local.set({ lastSentIntent: { type: "named", names: [name] } });
    }
    else
    {
        // "Send prompt to ComfyUI" — mirrors the injected button's own
        // resolution, including replaying the last explicit pick.
        pairsToSend = await resolveDefaultPairs(settings, pairs);
        if (pairsToSend.length === 0 && settings.workflow)
        {
            pairsToSend.push({ workflow: settings.workflow, suffix: settings.promptSuffix || "", suffixPosition: settings.promptSuffixPosition || "suffix" });
        }
    }

    if (pairsToSend.length === 0) { notifyTab(tabId, "⚠️ No workflow configured — open the extension settings."); return; }

    // Explicit user settings (static/random) always win over what the source
    // image was made with. Only fall back to the image's own checkpoint/seed
    // when the user hasn't configured an override at all ("default"/"workflow").
    let modelToInject = null;
    let modelMode = settings.modelMode || "default";
    if (modelMode === "static" && settings.staticModel) modelToInject = settings.staticModel;
    else if (modelMode === "random" && settings.selectedModels && settings.selectedModels.length > 0)
        modelToInject = settings.selectedModels[Math.floor(Math.random() * settings.selectedModels.length)];
    else if (modelMode === "default" && promptData.checkpoint) modelToInject = promptData.checkpoint;

    let seedMode = settings.seedMode || "workflow";
    let sharedSeed = null;
    if (seedMode === "static") sharedSeed = Math.floor(Math.random() * 2147483647);
    else if (seedMode === "workflow" && typeof promptData.seed === "number")
    {
        // Re-use the existing "static" injection path to apply the source
        // image's own seed instead of leaving the workflow template's seed.
        seedMode = "static";
        sharedSeed = promptData.seed;
    }

    // Only adopt the source image's own sampler/scheduler/steps/cfg when the
    // user explicitly opted in — default ("workflow") always keeps whatever
    // the saved workflow's KSampler is set to, same as before native-menu
    // metadata extraction existed.
    let samplerMode = settings.samplerMode || "workflow";
    let samplerOverrides = (samplerMode === "source") ? {
        steps: promptData.steps, cfg: promptData.cfg,
        samplerName: promptData.sampler, scheduler: promptData.scheduler
    } : null;

    currentBatchIds = [];
    let sent = 0, failed = 0;
    let lastErrorMsg = null;

    for (let pair of pairsToSend)
    {
        let workflowRaw = pair.workflow;
        if (!workflowRaw) continue;

        let workflowTemplate;
        try { workflowTemplate = JSON.parse(workflowRaw); } catch (e) { failed++; continue; }

        let mergedBanned = [settings.globalBannedTags, pair.bannedTags].filter(Boolean).join(",");
        let filteredPrompt = filterBannedTags(promptData.prompt, mergedBanned);
        let suffix = (pair.suffix || settings.promptSuffix || "").trim();
        let suffixPosition = pair.suffixPosition || settings.promptSuffixPosition || "suffix";
        let finalPrompt = injectCustomText(filteredPrompt, suffix, suffixPosition);

        let payload = buildPayload(finalPrompt, workflowTemplate, modelToInject, seedMode, sharedSeed, imageId, samplerOverrides);

        try
        {
            let r = await fetch(comfyUrl + "/prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (r.ok)
            {
                sent++;
                let j = await r.json().catch(function () { return null; });
                if (j && j.prompt_id) currentBatchIds.push(j.prompt_id);
            }
            else
            {
                failed++;
                lastErrorMsg = await parseComfyError(r);
            }
        }
        catch (e) { failed++; }
    }

    scheduleCheckStatus();

    if (failed === 0) notifyTab(tabId, "✅ " + (sent > 1 ? sent + " workflows sent!" : "Prompt sent to ComfyUI!"));
    else notifyTab(tabId, lastErrorMsg || ("⚠️ " + sent + " sent, " + failed + " failed"));
}

async function parseComfyError(response)
{
    try
    {
        let body = await response.text();
        let json = JSON.parse(body);

        if (json.node_errors)
        {
            for (let nodeId in json.node_errors)
            {
                for (let err of (json.node_errors[nodeId].errors || []))
                {
                    if (err.type === "value_not_in_list")
                    {
                        let match = err.details.match(/:\s*'([^']+)'\s*not in/);
                        return "❌ Missing: " + (match ? match[1].split("\\").pop().split("/").pop() : err.details);
                    }
                }
            }
        }
        if (json.error && json.error.message) return "❌ " + json.error.message;
    }
    catch (e) {}

    return "ComfyUI error " + response.status;
}

browser.contextMenus.onClicked.addListener(function (info, tab)
{
    if (typeof info.menuItemId !== "string" || info.menuItemId.indexOf("civitai-comfyui") !== 0) return;
    handleNativeSend(info, tab ? tab.id : null);
});

// ── Message handler ────────────────────────────────────────────────────────────
browser.runtime.onMessage.addListener(function (message, sender, sendResponse)
{
    if (message.type === "COMFYUI_START_BATCH")
    {
        currentBatchIds = [];
        return;
    }

    if (message.type === "COMFYUI_TRACK_PROMPT_ID")
    {
        if (message.id) currentBatchIds.push(message.id);
        return;
    }

    if (message.type === "COMFYUI_PING")
    {
        fetch(message.url, { method: "GET", signal: AbortSignal.timeout(5000) })
        .then(function (r) { sendResponse({ ok: r.ok }); scheduleCheckStatus(); })
        .catch(function ()  { sendResponse({ ok: false }); scheduleCheckStatus(); });
        return true;
    }

    if (message.type === "FETCH_IMAGE_METADATA")
    {
        fetch(message.url, { signal: AbortSignal.timeout(15000) })
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) { sendResponse({ ok: true, result: extractPromptFromImageBuffer(buf) }); })
        .catch(function (e) { sendResponse({ ok: false, error: e.message }); });
        return true;
    }

    if (message.type !== "COMFYUI_FETCH") return;

    fetch(message.url,
    {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: message.body
    })
    .then(function (response)
    {
        return response.text().then(function (text)
        {
            sendResponse({ ok: response.ok, status: response.status, body: text });
            scheduleCheckStatus();
        });
    })
    .catch(function (e)
    {
        sendResponse({ ok: false, status: 0, error: e.message });
        scheduleCheckStatus();
    });

    return true;
});
