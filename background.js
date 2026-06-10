// background.js

// ── Open options on toolbar click ─────────────────────────────────────────────
browser.browserAction.onClicked.addListener(function ()
{
    browser.runtime.openOptionsPage();
});

// ── Icon / badge based on server status + selection state ─────────────────────

function checkStatus()
{
    browser.storage.local.get(["comfyUrl", "selectedPairs"]).then(function (s)
    {
        let url = (s.comfyUrl || "").trim();
        let hasSelection = s.selectedPairs && s.selectedPairs.length > 0;

        if (!hasSelection)
        {
            // No workflows selected — amber badge regardless of server state
            browser.browserAction.setBadgeBackgroundColor({ color: "#f59e0b" });
            browser.browserAction.setBadgeText({ text: "" });
            return;
        }

        if (!url)
        {
            browser.browserAction.setBadgeBackgroundColor({ color: "#64748b" });
            browser.browserAction.setBadgeText({ text: "?" });
            return;
        }

        fetch(url.replace(/\/$/, "") + "/system_stats", { method: "GET", signal: AbortSignal.timeout(5000) })
        .then(function (r)
        {
            if (r.ok)
            {
                browser.browserAction.setBadgeBackgroundColor({ color: "#22c55e" });
                browser.browserAction.setBadgeText({ text: "✓" });
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

// Check on startup and every 30s
checkStatus();
setInterval(checkStatus, 30000);

// React immediately when selectedPairs changes
browser.storage.onChanged.addListener(function (changes)
{
    if (changes.selectedPairs) checkStatus();
});

// ── Message handler ────────────────────────────────────────────────────────────
browser.runtime.onMessage.addListener(function (message, sender, sendResponse)
{
    if (message.type === "COMFYUI_PING")
    {
        fetch(message.url, { method: "GET", signal: AbortSignal.timeout(5000) })
        .then(function (r) { sendResponse({ ok: r.ok }); checkStatus(); })
        .catch(function ()  { sendResponse({ ok: false }); checkStatus(); });
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
        });
    })
    .catch(function (e)
    {
        sendResponse({ ok: false, status: 0, error: e.message });
    });

    return true;
});
