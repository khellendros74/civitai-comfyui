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
