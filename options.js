// options.js

(function ()
{
    "use strict";

    let urlInput            = document.getElementById("comfyUrl");
    let globalBannedTagsInput = document.getElementById("globalBannedTags");
    let suffixInput         = document.getElementById("promptSuffix");
    let wfInput        = document.getElementById("workflow");
    let saveBtn        = document.getElementById("saveBtn");
    let testBtn        = document.getElementById("testBtn");
    let statusEl       = document.getElementById("status");
    let loadModelsBtn  = document.getElementById("loadModelsBtn");
    let seedRadios     = document.querySelectorAll("input[name='seedMode']");
    let pairModeRadios = document.querySelectorAll("input[name='pairMode']");
    let pairModeLabel  = document.getElementById("pairModeLabel");
    let pairModeHint   = document.getElementById("pairModeHint");
    let pairListEl     = document.getElementById("pairList");
    let pairNameInput  = document.getElementById("pairName");
    let pairTagsInput  = document.getElementById("pairTags");
    let pairBannedTagsInput = document.getElementById("pairBannedTags");
    let savePairBtn    = document.getElementById("savePairBtn");

    let cachedModels = [];

    const DEFAULT_WORKFLOW = '{"3":{"inputs":{"seed":685468484323813,"steps":20,"cfg":8,"sampler_name":"euler","scheduler":"normal","denoise":1,"model":["4",0],"positive":["6",0],"negative":["7",0],"latent_image":["5",0]},"class_type":"KSampler","_meta":{"title":"KSampler"}},"4":{"inputs":{"ckpt_name":"v1-5-pruned-emaonly-fp16.safetensors"},"class_type":"CheckpointLoaderSimple","_meta":{"title":"Load Checkpoint"}},"5":{"inputs":{"width":512,"height":512,"batch_size":1},"class_type":"EmptyLatentImage","_meta":{"title":"Empty Latent Image"}},"6":{"inputs":{"text":"beautiful scenery nature glass bottle landscape, purple galaxy bottle,","clip":["4",1]},"class_type":"CLIPTextEncode","_meta":{"title":"CLIP Text Encode (Prompt)"}},"7":{"inputs":{"text":"text, watermark","clip":["4",1]},"class_type":"CLIPTextEncode","_meta":{"title":"CLIP Text Encode (Prompt)"}},"8":{"inputs":{"samples":["3",0],"vae":["4",2]},"class_type":"VAEDecode","_meta":{"title":"VAE Decode"}},"9":{"inputs":{"filename_prefix":"ComfyUI","images":["8",0]},"class_type":"SaveImage","_meta":{"title":"Save Image"}}}';

    // ── Status ─────────────────────────────────────────────────────────────────

    function showStatus(message, isError)
    {
        statusEl.textContent = message;
        statusEl.className = isError ? "err" : "ok";
        clearTimeout(showStatus._timer);
        showStatus._timer = setTimeout(function () { statusEl.className = "hidden"; }, 3000);
    }

    // ── Pair mode UI ───────────────────────────────────────────────────────────

    function getPairMode()
    {
        for (let rb of pairModeRadios) { if (rb.checked) return rb.value; }
        return "static";
    }

    // Sequential state: index persisted in storage
    function getSequentialIndex(pairs)
    {
        return browser.storage.local.get(["sequentialIndex"]).then(function (s)
        {
            return s.sequentialIndex || 0;
        });
    }

    function advanceSequentialIndex(pairs, currentIndex)
    {
        let next = (currentIndex + 1) % pairs.length;
        return browser.storage.local.set({ sequentialIndex: next }).then(function () { return next; });
    }

    function updatePairModeUI()
    {
        let mode = getPairMode();
        pairModeLabel.style.display = "block";
        if (mode === "static")
        {
            pairModeLabel.textContent = "Saved workflows";
            pairModeHint.textContent  = "";
        }
        else if (mode === "random")
        {
            pairModeLabel.textContent = "Select workflows to pick from (random each run)";
            pairModeHint.textContent  = "Check at least one. One will be chosen at random on each send.";
        }
        else if (mode === "sequential")
        {
            pairModeLabel.textContent = "Select workflows to cycle through (in order, looping)";
            pairModeHint.textContent  = "Check at least one. Each send advances to the next, looping back to the first.";
        }
        else if (mode === "all")
        {
            pairModeLabel.textContent = "Select workflows to send all at once";
            pairModeHint.textContent  = "All checked workflows will be queued in ComfyUI with a single click.";
        }
        renderPairList(mode);
    }

    for (let rb of pairModeRadios) { rb.addEventListener("change", updatePairModeUI); }

    // ── Pair list rendering ────────────────────────────────────────────────────

    function renderPairList(mode)
    {
        browser.storage.local.get(["pairs", "selectedPairs", "staticPair"]).then(function (s)
        {
            let pairs         = s.pairs || [];
            let selectedPairs = s.selectedPairs || [];
            let staticPair    = s.staticPair || "";

            pairListEl.textContent = "";

            if (pairs.length === 0)
            {
                let empty = document.createElement("p");
                empty.style.cssText = "font-size:12px;color:#64748b;font-style:italic;padding:4px 0;";
                empty.textContent = "No saved workflows yet.";
                pairListEl.appendChild(empty);
                return;
            }

            let container = document.createElement("div");
            container.className = "model-checkbox-list";

            for (let pair of pairs)
            {
                let row = document.createElement("div");
                row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:pointer;transition:background 0.15s;";
                row.addEventListener("mouseenter", function () { row.style.background = "#16162a"; });
                row.addEventListener("mouseleave", function () { row.style.background = ""; });

                let input = null;
                if (mode !== "default")
                {
                    input = document.createElement("input");
                    input.type  = (mode === "static") ? "radio" : "checkbox";
                    input.name  = "pairChoice";
                    input.value = pair.name;
                    if (mode === "static") input.checked = (pair.name === staticPair);
                    else                   input.checked = selectedPairs.includes(pair.name);
                    input.style.cssText = "accent-color:#7c6af7;flex-shrink:0;cursor:pointer;";
                    row.appendChild(input);
                }

                let nameSpan = document.createElement("span");
                nameSpan.textContent = pair.name;
                nameSpan.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e0e0ff;font-size:13px;flex-shrink:0;";
                row.appendChild(nameSpan);

                if (pair.tags && pair.tags.trim())
                {
                    let tagsSpan = document.createElement("span");
                    tagsSpan.textContent = pair.tags;
                    tagsSpan.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px;margin-left:6px;";
                    row.appendChild(tagsSpan);
                }
                else
                {
                    nameSpan.style.flex = "1";
                }

                if (!pair.isDefault)
                {
                    let delBtn = document.createElement("button");
                    delBtn.textContent = "✕";
                    delBtn.style.cssText = "background:transparent;border:none;color:#374151;font-size:12px;padding:2px 6px;cursor:pointer;flex-shrink:0;border-radius:4px;line-height:1;margin-left:auto;";
                    delBtn.addEventListener("mouseenter", function () { delBtn.style.color = "#f87171"; });
                    delBtn.addEventListener("mouseleave", function () { delBtn.style.color = "#374151"; });
                    delBtn.addEventListener("click", (function (p)
                    {
                        return function (e)
                        {
                            e.stopPropagation();
                            deletePair(p.name);
                        };
                    })(pair));
                    row.appendChild(delBtn);
                }

                // Clicking the row: toggle input then load
                row.addEventListener("click", (function (p, inp, r)
                {
                    return function (e)
                    {
                        if (e.target === inp) return;
                        if (inp)
                        {
                            if (inp.type === "checkbox") inp.checked = !inp.checked;
                            else inp.checked = true;
                        }
                        // Highlight active row
                        let parent = r.parentElement;
                        if (parent)
                        {
                            for (let sibling of parent.children)
                            {
                                sibling.style.background = "";
                                sibling.style.borderLeft = "";
                            }
                        }
                        r.style.background  = "#1a1a35";
                        r.style.borderLeft  = "2px solid #7c6af7";
                        r.style.paddingLeft = "8px";

                        suffixInput.value   = p.suffix || "";
                        wfInput.value       = p.workflow || "";
                        pairNameInput.value = p.isDefault ? "" : p.name;
                        if (pairTagsInput) pairTagsInput.value = p.isDefault ? "" : (p.tags || "");
                        if (pairBannedTagsInput) pairBannedTagsInput.value = p.bannedTags || "";
                        updateDefaultLabel(p.workflow || "");
                        showStatus("Loaded: " + p.name, false);
                    };
                })(pair, input, row));

                container.appendChild(row);
            }

            pairListEl.appendChild(container);
        });
    }

    function deletePair(name)
    {
        if (name === "Default") return;
        browser.storage.local.get(["pairs", "selectedPairs", "staticPair"]).then(function (s)
        {
            let pairs         = (s.pairs || []).filter(function (p) { return p.name !== name; });
            let selectedPairs = (s.selectedPairs || []).filter(function (n) { return n !== name; });
            let staticPair    = s.staticPair === name ? "" : (s.staticPair || "");
            browser.storage.local.set({ pairs, selectedPairs, staticPair }).then(function ()
            {
                renderPairList(getPairMode());
            });
        });
    }

    // ── Save pair ──────────────────────────────────────────────────────────────

    savePairBtn.addEventListener("click", function ()
    {
        let name   = pairNameInput.value.trim();
        let wf     = wfInput.value.trim();
        let suffix = suffixInput.value.trim();

        if (!name)              { showStatus("Enter a name for this workflow.", true); return; }
        if (name === "Default") { showStatus("'Default' is a reserved name — choose a different name.", true); return; }
        if (!wf)                { showStatus("Paste a workflow before saving.", true); return; }

        let tags = pairTagsInput ? pairTagsInput.value.trim() : "";
        let bannedTags = pairBannedTagsInput ? pairBannedTagsInput.value.trim() : "";

        browser.storage.local.get(["pairs"]).then(function (s)
        {
            let pairs = s.pairs || [];
            let defaultEntry = pairs.find(function (p) { return p.isDefault; });
            pairs = pairs.filter(function (p) { return p.name !== name && !p.isDefault; });
            pairs.push({ name: name, workflow: wf, suffix: suffix, tags: tags, bannedTags: bannedTags });
            if (defaultEntry) pairs.unshift(defaultEntry);
            browser.storage.local.set({ pairs }).then(function ()
            {
                showStatus("✅ Workflow \"" + name + "\" saved!", false);
                pairNameInput.value = "";
                if (pairTagsInput) pairTagsInput.value = "";
                if (pairBannedTagsInput) pairBannedTagsInput.value = "";
                renderPairList(getPairMode());
            });
        });
    });

    // ── Default label ──────────────────────────────────────────────────────────

    function extractCheckpointFromWorkflow(workflowRaw)
    {
        if (!workflowRaw || !workflowRaw.trim()) return null;
        try
        {
            let wf = JSON.parse(workflowRaw);
            for (let nodeId in wf)
            {
                let node = wf[nodeId];
                if (node.class_type === "CheckpointLoaderSimple" && node.inputs && node.inputs.ckpt_name)
                {
                    let name = node.inputs.ckpt_name;
                    return name.split("\\").pop().split("/").pop();
                }
            }
        }
        catch (e) {}
        return null;
    }

    function updateDefaultLabel(workflowRaw)
    {
        let ckpt = extractCheckpointFromWorkflow(workflowRaw);
        let defaultRadio = document.querySelector("input[name='modelMode'][value='default']");
        if (!defaultRadio) return;
        let span = defaultRadio.nextElementSibling;
        if (!span) return;
        span.textContent = "";
        let strong = document.createElement("strong");
        strong.textContent = "Default";
        span.appendChild(strong);
        if (ckpt)
        {
            span.appendChild(document.createTextNode(" — use "));
            let code = document.createElement("code");
            code.textContent = ckpt;
            code.style.cssText = "background:#0f0f1a;border:1px solid #2d2b55;border-radius:4px;padding:1px 6px;color:#a5b4fc;font-size:11px;";
            span.appendChild(code);
            span.appendChild(document.createTextNode(" from your workflow"));
        }
        else
        {
            span.appendChild(document.createTextNode(" — use the model defined in your workflow"));
        }
    }

    // ── Model picker ───────────────────────────────────────────────────────────

    function getSelectedMode()
    {
        for (let rb of document.querySelectorAll("input[name='modelMode']")) { if (rb.checked) return rb.value; }
        return "default";
    }

    function updatePickerUI()
    {
        let mode = getSelectedMode();
        let modelPickerArea  = document.getElementById("modelPickerArea");
        let modelPickerLabel = document.getElementById("modelPickerLabel");
        let modelPickerHint  = document.getElementById("modelPickerHint");
        if (mode === "default") { modelPickerArea.style.display = "none"; return; }
        modelPickerArea.style.display = "block";
        if (mode === "random")
        {
            modelPickerLabel.textContent = "Select models to pick from (random each run)";
            modelPickerHint.textContent  = "At least one must be selected.";
        }
        else
        {
            modelPickerLabel.textContent = "Select the model to always use";
            modelPickerHint.textContent  = "This model will replace the checkpoint in your workflow.";
        }
        if (cachedModels.length > 0) renderModelList(mode);
    }

    document.querySelectorAll("input[name='modelMode']").forEach(function (rb) { rb.addEventListener("change", updatePickerUI); });

    function getModelDir(model) { let n = model.replace(/\\/g, "/"); let p = n.split("/"); return p.length > 1 ? p.slice(0,-1).join("/") : ""; }
    function getModelName(model) { return model.replace(/\\/g, "/").split("/").pop(); }

    function buildGroupedList(models, inputType, inputName, getChecked)
    {
        let groups = {};
        for (let model of models)
        {
            let dir = getModelDir(model) || "(root)";
            if (!groups[dir]) groups[dir] = [];
            groups[dir].push(model);
        }
        let container = document.createElement("div");
        container.className = inputType === "checkbox" ? "model-checkbox-list" : "model-radio-list";
        let sortedDirs = Object.keys(groups).sort();
        for (let dir of sortedDirs)
        {
            let header = document.createElement("div");
            header.style.cssText = "font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;padding:6px 0 3px 0;border-top:1px solid #2d2b55;margin-top:4px;";
            if (dir === sortedDirs[0]) header.style.borderTop = "none";
            header.textContent = dir === "(root)" ? "— root —" : "📁 " + dir;
            container.appendChild(header);
            for (let model of groups[dir])
            {
                let lbl = document.createElement("label");
                let input = document.createElement("input");
                input.type = inputType; input.name = inputName; input.value = model; input.checked = getChecked(model);
                let span = document.createElement("span"); span.textContent = getModelName(model); span.title = model;
                lbl.appendChild(input); lbl.appendChild(span); container.appendChild(lbl);
            }
        }
        return container;
    }

    function renderModelList(mode)
    {
        let modelListArea = document.getElementById("modelListArea");
        browser.storage.local.get(["selectedModels", "staticModel"]).then(function (s)
        {
            let selectedModels = s.selectedModels || [];
            let staticModel    = s.staticModel || "";
            modelListArea.textContent = "";
            if (mode === "random")
                modelListArea.appendChild(buildGroupedList(cachedModels, "checkbox", "randomModelChoice", function (m) { return selectedModels.includes(m); }));
            else
                modelListArea.appendChild(buildGroupedList(cachedModels, "radio", "staticModelChoice", function (m) { return m === staticModel; }));
        });
    }

    loadModelsBtn.addEventListener("click", function ()
    {
        let url = urlInput.value.trim().replace(/\/$/, "");
        if (!url) { document.getElementById("modelsStatus").textContent = "Enter a server URL first."; return; }
        document.getElementById("modelsStatus").textContent = "Loading…";
        fetch(url + "/models/checkpoints")
        .then(function (res) { return res.json(); })
        .then(function (data)
        {
            if (!Array.isArray(data) || data.length === 0) { document.getElementById("modelsStatus").textContent = "No models found."; return; }
            cachedModels = data.sort();
            document.getElementById("modelsStatus").textContent = cachedModels.length + " models loaded";
            renderModelList(getSelectedMode());
        })
        .catch(function (e) { document.getElementById("modelsStatus").textContent = "Failed: " + e.message; });
    });

    // ── Load settings ──────────────────────────────────────────────────────────

    function updateServerBanner(url)
    {
        let banner = document.getElementById("serverStatusBanner");
        if (!banner) return;

        function setBanner(color, text)
        {
            banner.style.display = "block";
            banner.textContent = "";
            let dotEl = document.createElement("span");
            dotEl.style.cssText = "display:inline-block;width:7px;height:7px;border-radius:50%;background:" + color + ";margin-right:5px;vertical-align:middle;";
            banner.appendChild(dotEl);
            banner.appendChild(document.createTextNode(text));
        }

        if (!url || !url.trim())
        {
            setBanner("#64748b", "No server configured");
            return;
        }
        setBanner("#94a3b8", "Checking…");
        fetch(url.replace(/\/$/, "") + "/system_stats", { method: "GET", signal: AbortSignal.timeout(5000) })
        .then(function (r)
        {
            if (r.ok)
                setBanner("#6ee7b7", "ComfyUI reachable");
            else
                setBanner("#f87171", "Server error " + r.status);
        })
        .catch(function ()
        {
            setBanner("#f87171", "ComfyUI unreachable");
        });
    }

    browser.storage.local.get(["comfyUrl", "globalBannedTags", "promptSuffix", "workflow", "modelMode", "selectedModels", "staticModel", "seedMode", "pairMode", "pairs", "selectedPairs", "staticPair"]).then(function (s)
    {
        let resolvedUrl = (s.comfyUrl && s.comfyUrl.trim()) ? s.comfyUrl : "http://localhost:8188";
        let resolvedWf  = (s.workflow  && s.workflow.trim())  ? s.workflow  : DEFAULT_WORKFLOW;
        let resolvedSfx = s.promptSuffix || "";

        urlInput.value            = resolvedUrl;
        globalBannedTagsInput.value = s.globalBannedTags || "";
        suffixInput.value         = resolvedSfx;
        wfInput.value     = resolvedWf;
        updateServerBanner(s.comfyUrl);

        let seedMode = s.seedMode || "workflow";
        for (let rb of seedRadios) { rb.checked = (rb.value === seedMode); }

        let modelMode = s.modelMode || "default";
        for (let rb of document.querySelectorAll("input[name='modelMode']")) { rb.checked = (rb.value === modelMode); }
        updatePickerUI();
        updateDefaultLabel(resolvedWf);

        // Ensure Default entry exists in pairs using the SAVED workflow (not textarea)
        // This is the only place we update Default — never from textarea input events
        let pairs = s.pairs || [];
        pairs = pairs.filter(function (p) { return !p.isDefault; });
        pairs.unshift({ name: "Default", workflow: resolvedWf, suffix: resolvedSfx, isDefault: true });

        let validModes = ["static", "random", "sequential", "all"];
        let pairMode = validModes.includes(s.pairMode) ? s.pairMode : "static";
        for (let rb of pairModeRadios) { rb.checked = (rb.value === pairMode); }
        if (pairMode === "static" && !s.staticPair)
        {
            browser.storage.local.set({ staticPair: "Default" });
            s.staticPair = "Default";
        }

        browser.storage.local.set({ pairs: pairs }).then(function ()
        {
            updatePairModeUI();
        });

        if (modelMode !== "default" && resolvedUrl)
        {
            fetch(resolvedUrl + "/models/checkpoints")
            .then(function (res) { return res.json(); })
            .then(function (data) { if (Array.isArray(data) && data.length > 0) { cachedModels = data.sort(); document.getElementById("modelsStatus").textContent = cachedModels.length + " models"; renderModelList(modelMode); } })
            .catch(function () {});
        }
    }).catch(function (e) {});

    // ── Save settings ──────────────────────────────────────────────────────────

    saveBtn.addEventListener("click", function ()
    {
        let url            = urlInput.value.trim().replace(/\/$/, "");
        let globalBannedTags = globalBannedTagsInput.value.trim();
        let suffix = suffixInput.value.trim();
        let wf     = wfInput.value.trim();
        let mode   = getSelectedMode();

        if (!url) { showStatus("Please enter your ComfyUI URL.", true); return; }

        let wfError = validateWorkflow(wf);
        if (wfError) { showStatus(wfError, true); return; }

        let selectedModels = [], staticModel = "";
        if (mode === "random")
        {
            let cbs = document.querySelectorAll("#modelListArea input[type='checkbox']:checked");
            for (let cb of cbs) selectedModels.push(cb.value);
        }
        else if (mode === "static")
        {
            let rb = document.querySelector("#modelListArea input[type='radio']:checked");
            if (rb) staticModel = rb.value;
        }

        let seedMode = "workflow";
        for (let rb of seedRadios) { if (rb.checked) { seedMode = rb.value; break; } }

        let pairMode = getPairMode();
        let selectedPairs = [], staticPair = "";
        if (pairMode === "static")
        {
            let rb = pairListEl.querySelector("input[type='radio']:checked");
            if (rb) staticPair = rb.value;
        }
        else
        {
            let cbs = pairListEl.querySelectorAll("input[type='checkbox']:checked");
            for (let cb of cbs) selectedPairs.push(cb.value);
        }

        // Update Default entry and optionally the currently loaded named pair
        browser.storage.local.get(["pairs"]).then(function (s)
        {
            let loadedPairName = pairNameInput.value.trim();
            let pairs = s.pairs || [];

            // Update Default
            pairs = pairs.filter(function (p) { return !p.isDefault; });
            pairs.unshift({ name: "Default", workflow: wf, suffix: suffix, isDefault: true });

            // If a named pair is loaded in the fields, update it too
            if (loadedPairName && loadedPairName !== "Default")
            {
                let idx = pairs.findIndex(function (p) { return p.name === loadedPairName; });
                if (idx !== -1)
                {
                    let existingTags = pairs[idx].tags || "";
                    let newTags = pairTagsInput ? pairTagsInput.value.trim() : existingTags;
                    let existingBanned = pairs[idx].bannedTags || "";
                    let newBanned = pairBannedTagsInput ? pairBannedTagsInput.value.trim() : existingBanned;
                    pairs[idx] = { name: loadedPairName, workflow: wf, suffix: suffix, tags: newTags, bannedTags: newBanned };
                }
            }

            browser.storage.local.set({ comfyUrl: url, globalBannedTags, promptSuffix: suffix, workflow: wf, modelMode: mode, selectedModels, staticModel, seedMode, pairMode, selectedPairs, staticPair, pairs })
            .then(function ()
            {
                let msg = (loadedPairName && loadedPairName !== "Default")
                    ? "\u2705 Settings + '" + loadedPairName + "' saved!"
                    : "✅ Settings saved!";
                showStatus(msg, false);
                renderPairList(pairMode);
                updateDefaultLabel(wf);
            })
            .catch(function (e) { showStatus("❌ Save failed: " + e.message, true); });
        });
    });

    // ── Export workflows ───────────────────────────────────────────────────────

    document.getElementById("exportBtn").addEventListener("click", function ()
    {
        browser.storage.local.get(["pairs", "globalBannedTags"]).then(function (s)
        {
            let pairs = (s.pairs || []).filter(function (p) { return !p.isDefault; });
            if (pairs.length === 0)
            {
                document.getElementById("importStatus").textContent = "No custom workflows to export.";
                return;
            }
            let now = new Date();
            let stamp = now.getFullYear() + "-" +
                String(now.getMonth() + 1).padStart(2, "0") + "-" +
                String(now.getDate()).padStart(2, "0") + "_" +
                String(now.getHours()).padStart(2, "0") +
                String(now.getMinutes()).padStart(2, "0");
            let exportData = { globalBannedTags: s.globalBannedTags || "", pairs: pairs };
            let json = JSON.stringify(exportData, null, 2);
            let blob = new Blob([json], { type: "application/json" });
            let url  = URL.createObjectURL(blob);
            let a    = document.createElement("a");
            a.href     = url;
            a.download = "civitai-comfyui-workflows-" + stamp + ".json";
            a.click();
            URL.revokeObjectURL(url);
            document.getElementById("importStatus").textContent = pairs.length + " workflow(s) exported.";
        });
    });

    // ── Import workflows ───────────────────────────────────────────────────────

    function downloadPairsAsJson(pairs, globalBannedTags, filename)
    {
        let custom = pairs.filter(function (p) { return !p.isDefault; });
        if (custom.length === 0) return;
        let exportData = { globalBannedTags: globalBannedTags || "", pairs: custom };
        let blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        let url  = URL.createObjectURL(blob);
        let a    = document.createElement("a");
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    document.getElementById("importBtn").addEventListener("click", function ()
    {
        document.getElementById("importFile").click();
    });

    document.getElementById("importFile").addEventListener("change", function (e)
    {
        let file = e.target.files[0];
        if (!file) return;

        let reader = new FileReader();
        reader.onload = function (evt)
        {
            let statusEl = document.getElementById("importStatus");
            try
            {
                let imported = JSON.parse(evt.target.result);

                // Support both old format (plain array) and new format ({ globalBannedTags, pairs })
                let importedGlobalBannedTags = null;
                if (Array.isArray(imported))
                {
                    // old format
                }
                else if (imported && Array.isArray(imported.pairs))
                {
                    importedGlobalBannedTags = imported.globalBannedTags || "";
                    imported = imported.pairs;
                }
                else
                {
                    statusEl.textContent = "Invalid file — expected a JSON array or export object."; return;
                }

                let valid = imported.filter(function (p) { return p.name && p.workflow; });
                if (valid.length === 0) { statusEl.textContent = "No valid workflows found in file."; return; }

                browser.storage.local.get(["pairs", "globalBannedTags"]).then(function (s)
                {
                    let existing = s.pairs || [];
                    let customExisting = existing.filter(function (p) { return !p.isDefault; });
                    let defaultEntry   = existing.find(function (p) { return p.isDefault; });

                    // Warn if existing workflows will be overwritten
                    let overwritten = customExisting.filter(function (p)
                    {
                        return valid.find(function (v) { return v.name === p.name; });
                    });
                    let replaced = overwritten.length;
                    let added    = valid.length - replaced;

                    let msg = "Importing " + valid.length + " workflow(s)";
                    if (replaced > 0) msg += " — " + replaced + " existing workflow(s) will be replaced";
                    msg += ".\n\nYour current workflows will be backed up automatically before import.\n\nContinue?";

                    if (!confirm(msg)) { e.target.value = ""; return; }

                    // Auto-backup current custom workflows before replacing
                    let now = new Date();
                    let stamp = now.getFullYear() + "-" +
                        String(now.getMonth() + 1).padStart(2, "0") + "-" +
                        String(now.getDate()).padStart(2, "0") + "_" +
                        String(now.getHours()).padStart(2, "0") +
                        String(now.getMinutes()).padStart(2, "0");
                    downloadPairsAsJson(existing, s.globalBannedTags || "", "civitai-comfyui-backup-" + stamp + ".json");

                    // Replace: overwrite matching names, keep non-matching existing ones
                    let merged = customExisting.filter(function (p)
                    {
                        return !valid.find(function (v) { return v.name === p.name; });
                    });
                    for (let p of valid)
                    {
                        if (p.name === "Default") continue;
                        merged.push({ name: p.name, workflow: p.workflow, suffix: p.suffix || "", tags: p.tags || "", bannedTags: p.bannedTags || "" });
                    }
                    if (defaultEntry) merged.unshift(defaultEntry);

                    // Save immediately — no manual save needed
                    let saveData = { pairs: merged };
                    if (importedGlobalBannedTags !== null)
                    {
                        saveData.globalBannedTags = importedGlobalBannedTags;
                        globalBannedTagsInput.value = importedGlobalBannedTags;
                    }
                    browser.storage.local.set(saveData).then(function ()
                    {
                        let detail = added > 0 && replaced > 0
                            ? added + " added, " + replaced + " replaced"
                            : added > 0 ? added + " added" : replaced + " replaced";
                        let extra = importedGlobalBannedTags !== null ? " Global banned tags restored." : "";
                        statusEl.textContent = "✅ Import done (" + detail + "). Backup downloaded." + extra;
                        renderPairList(getPairMode());
                    });
                });
            }
            catch (err)
            {
                document.getElementById("importStatus").textContent = "Invalid JSON file.";
            }
        };
        reader.readAsText(file);
        e.target.value = "";
    });

    // ── Reset defaults ─────────────────────────────────────────────────────────

    document.getElementById("resetBtn").addEventListener("click", function ()
    {
        if (!confirm("Reset URL and workflow to defaults? Your saved workflows will be kept.")) return;
        urlInput.value    = "http://localhost:8188";
        suffixInput.value = "";
        wfInput.value     = DEFAULT_WORKFLOW;
        showStatus("✅ Defaults restored — click Save Settings to apply.", false);
        updateDefaultLabel(DEFAULT_WORKFLOW);
    });

    // ── Test connection ────────────────────────────────────────────────────────

    testBtn.addEventListener("click", function ()
    {
        let url = urlInput.value.trim().replace(/\/$/, "");
        if (!url) { showStatus("Enter a URL first.", true); return; }
        statusEl.textContent = "Testing…"; statusEl.className = "";
        updateServerBanner(url);
        fetch(url + "/system_stats", { method: "GET", signal: AbortSignal.timeout(5000) })
        .then(function (res) { if (res.ok) showStatus("✅ Connected to ComfyUI!", false); else showStatus("⚠️ Server responded with status " + res.status, true); })
        .catch(function (e) { showStatus("❌ Could not reach server: " + e.message, true); });
    });

    // ── Triple-click debug ─────────────────────────────────────────────────────

    let clickCount = 0, clickTimer = null;
    document.querySelector("h1").addEventListener("click", function ()
    {
        clickCount++;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(function () { clickCount = 0; }, 600);
        if (clickCount >= 3)
        {
            clickCount = 0;
            browser.storage.local.get(["comfyUrl", "promptSuffix", "workflow", "modelMode", "seedMode", "pairMode", "pairs"]).then(function (s)
            {
                alert("Storage:\n" + JSON.stringify({ comfyUrl: s.comfyUrl || "(empty)", workflowLength: s.workflow ? s.workflow.length + " chars" : "(empty)", seedMode: s.seedMode || "workflow", pairMode: s.pairMode || "default", pairs: (s.pairs || []).map(function (p) { return p.name; }) }, null, 2));
            });
        }
    });

    // ── Helpers ────────────────────────────────────────────────────────────────

    function validateWorkflow(raw)
    {
        if (!raw || raw.trim() === "") return "Workflow JSON is empty.";
        try { let p = JSON.parse(raw); if (typeof p !== "object" || Array.isArray(p)) return "Workflow must be a JSON object."; return null; }
        catch (e) { return "Invalid JSON: " + e.message; }
    }

})();
