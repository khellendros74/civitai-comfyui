// popup.js

(function ()
{
    "use strict";

    document.getElementById("optBtn").addEventListener("click", function ()
    {
        browser.runtime.openOptionsPage();
    });

    let dot        = document.getElementById("dot");
    let statusText = document.getElementById("statusText");

    browser.storage.local.get(["comfyUrl", "workflow"]).then(function (settings)
    {
        if (!settings.comfyUrl)
        {
            dot.className = "dot err";
            statusText.textContent = "No server URL set";
            return;
        }

        if (!settings.workflow)
        {
            dot.className = "dot err";
            statusText.textContent = "No workflow set";
            return;
        }

        statusText.textContent = "Checking server…";

        fetch(settings.comfyUrl.replace(/\/$/, "") + "/system_stats",
        {
            method: "GET",
            signal: AbortSignal.timeout(4000)
        })
        .then(function (res)
        {
            if (res.ok)
            {
                dot.className = "dot ok";
                statusText.textContent = "ComfyUI connected";
            }
            else
            {
                dot.className = "dot err";
                statusText.textContent = "Server error " + res.status;
            }
        })
        .catch(function ()
        {
            dot.className = "dot err";
            statusText.textContent = "Server unreachable";
        });
    });

})();
