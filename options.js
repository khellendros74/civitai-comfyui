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
    let pairSortOrder = "alpha"; // "alpha" | "date"

    const DEFAULT_WORKFLOW = '{"3":{"inputs":{"seed":685468484323813,"steps":20,"cfg":8,"sampler_name":"euler","scheduler":"normal","denoise":1,"model":["4",0],"positive":["6",0],"negative":["7",0],"latent_image":["5",0]},"class_type":"KSampler","_meta":{"title":"KSampler"}},"4":{"inputs":{"ckpt_name":"v1-5-pruned-emaonly-fp16.safetensors"},"class_type":"CheckpointLoaderSimple","_meta":{"title":"Load Checkpoint"}},"5":{"inputs":{"width":512,"height":512,"batch_size":1},"class_type":"EmptyLatentImage","_meta":{"title":"Empty Latent Image"}},"6":{"inputs":{"text":"beautiful scenery nature glass bottle landscape, purple galaxy bottle,","clip":["4",1]},"class_type":"CLIPTextEncode","_meta":{"title":"CLIP Text Encode (Prompt)"}},"7":{"inputs":{"text":"text, watermark","clip":["4",1]},"class_type":"CLIPTextEncode","_meta":{"title":"CLIP Text Encode (Prompt)"}},"8":{"inputs":{"samples":["3",0],"vae":["4",2]},"class_type":"VAEDecode","_meta":{"title":"VAE Decode"}},"9":{"inputs":{"filename_prefix":"ComfyUI","images":["8",0]},"class_type":"SaveImage","_meta":{"title":"Save Image"}}}';

    // ── Status ─────────────────────────────────────────────────────────────────

    function showStatus(message, isError)
    {
        statusEl.textContent = message;
        statusEl.className = isError ? "err" : "ok";
        clearTimeout(showStatus._timer);
        showStatus._timer = setTimeout(function () { statusEl.className = "hidden"; }, 3000);
    }

    // ── Beautify button ────────────────────────────────────────────────────────

    document.getElementById("beautifyWfBtn").addEventListener("click", function ()
    {
        let raw = wfInput.value.trim();
        if (!raw) return;
        try
        {
            wfInput.value = JSON.stringify(JSON.parse(raw), null, 2);
        }
        catch (e)
        {
            showStatus("Invalid JSON — cannot beautify.", true);
        }
    });

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
        // Reset hint to plain text only — sort buttons are re-injected by renderPairList
        pairModeHint.style.cssText = "";
        if (mode === "static")
        {
            pairModeLabel.textContent = "Saved workflows";
            pairModeHint.textContent  = "";
        }
        else if (mode === "random")
        {
            pairModeLabel.textContent = "Select workflows to pick from";
            pairModeHint.textContent  = "One is chosen at random on each send.";
        }
        else if (mode === "sequential")
        {
            pairModeLabel.textContent = "Select workflows to cycle through";
            pairModeHint.textContent  = "Each send advances to the next, looping back to the first.";
        }
        else if (mode === "all")
        {
            pairModeLabel.textContent = "Select workflows to send all at once";
            pairModeHint.textContent  = "All checked workflows are sent together in one click.";
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

            // Sort buttons injected inline into the hint/label row
            function makeSortBtn(label, value)
            {
                let btn = document.createElement("button");
                btn.textContent = label;
                btn.style.cssText = "padding:2px 10px;font-size:11px;border-radius:4px;border:1px solid #2d2b55;cursor:pointer;transition:background 0.15s,color 0.15s;";
                if (pairSortOrder === value)
                {
                    btn.style.background = "#7c6af7";
                    btn.style.color = "#fff";
                }
                else
                {
                    btn.style.background = "transparent";
                    btn.style.color = "#94a3b8";
                }
                btn.addEventListener("click", function ()
                {
                    pairSortOrder = value;
                    renderPairList(getPairMode());
                });
                return btn;
            }

            // Append sort buttons into pairModeHint, right-aligned
            // Remove any previously injected sort buttons first
            let existingSortGroup = pairModeHint.querySelector(".pair-sort-group");
            if (existingSortGroup) existingSortGroup.remove();
            pairModeHint.style.cssText = "display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;";
            let sortGroup = document.createElement("span");
            sortGroup.className = "pair-sort-group";
            sortGroup.style.cssText = "display:flex;gap:4px;margin-left:auto;flex-shrink:0;";
            sortGroup.appendChild(makeSortBtn("A→Z", "alpha"));
            sortGroup.appendChild(makeSortBtn("Recent", "date"));
            pairModeHint.appendChild(sortGroup);

            // Default always stays first; sort the rest
            let defaultEntry = pairs.find(function (p) { return p.isDefault; });
            let custom = pairs.filter(function (p) { return !p.isDefault; });

            if (pairSortOrder === "date")
            {
                custom.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
            }
            else
            {
                custom.sort(function (a, b) { return a.name.localeCompare(b.name); });
            }

            let sorted = defaultEntry ? [defaultEntry].concat(custom) : custom;

            let container = document.createElement("div");
            container.className = "model-checkbox-list";

            function updateCountLabel()
            {
                if (!countLabel) return;
                let n = container.querySelectorAll("input[type='checkbox']:checked").length;
                countLabel.textContent = n + " of " + sorted.length + " selected";
            }

            let controlsRow = null;
            let countLabel  = null;
            if (mode !== "static")
            {
                controlsRow = document.createElement("div");
                controlsRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";

                countLabel = document.createElement("span");
                countLabel.style.cssText = "font-size:11px;color:#64748b;";
                controlsRow.appendChild(countLabel);

                let btnGroup = document.createElement("span");
                btnGroup.style.cssText = "display:flex;gap:6px;";

                let selectAllBtn = document.createElement("button");
                selectAllBtn.type = "button";
                selectAllBtn.textContent = "Select all";
                selectAllBtn.style.cssText = "padding:2px 10px;font-size:11px;border-radius:4px;border:1px solid #2d2b55;background:transparent;color:#94a3b8;cursor:pointer;";
                selectAllBtn.addEventListener("click", function ()
                {
                    for (let cb of container.querySelectorAll("input[type='checkbox']")) { cb.checked = true; }
                    updateCountLabel();
                });

                let deselectAllBtn = document.createElement("button");
                deselectAllBtn.type = "button";
                deselectAllBtn.textContent = "Deselect all";
                deselectAllBtn.style.cssText = selectAllBtn.style.cssText;
                deselectAllBtn.addEventListener("click", function ()
                {
                    for (let cb of container.querySelectorAll("input[type='checkbox']")) { cb.checked = false; }
                    updateCountLabel();
                });

                btnGroup.appendChild(selectAllBtn);
                btnGroup.appendChild(deselectAllBtn);
                controlsRow.appendChild(btnGroup);
            }

            for (let pair of sorted)
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
                    if (input.type === "checkbox") input.addEventListener("change", updateCountLabel);
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
                    let actions = document.createElement("span");
                    actions.style.cssText = "display:flex;gap:2px;margin-left:auto;flex-shrink:0;";

                    let dupBtn = document.createElement("button");
                    dupBtn.textContent = "⧉";
                    dupBtn.title = "Duplicate";
                    dupBtn.style.cssText = "background:transparent;border:none;color:#374151;font-size:12px;padding:2px 6px;cursor:pointer;flex-shrink:0;border-radius:4px;line-height:1;";
                    dupBtn.addEventListener("mouseenter", function () { dupBtn.style.color = "#a5b4fc"; });
                    dupBtn.addEventListener("mouseleave", function () { dupBtn.style.color = "#374151"; });
                    dupBtn.addEventListener("click", (function (p)
                    {
                        return function (e)
                        {
                            e.stopPropagation();
                            clonePair(p.name);
                        };
                    })(pair));

                    let delBtn = document.createElement("button");
                    delBtn.textContent = "✕";
                    delBtn.title = "Delete";
                    delBtn.style.cssText = "background:transparent;border:none;color:#374151;font-size:12px;padding:2px 6px;cursor:pointer;flex-shrink:0;border-radius:4px;line-height:1;";
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

                    actions.appendChild(dupBtn);
                    actions.appendChild(delBtn);
                    row.appendChild(actions);
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
                        updateCountLabel();

                        suffixInput.value   = p.suffix || "";
                        wfInput.value       = p.workflow || "";
                        pairNameInput.value = p.isDefault ? "" : p.name;
                        if (pairTagsInput) pairTagsInput.value = p.isDefault ? "" : (p.tags || "");
                        if (pairBannedTagsInput) pairBannedTagsInput.value = p.bannedTags || "";
                        updateDefaultLabel(p.workflow || "");
                        // If in static mode, refresh the Static model label live
                        if (mode === "static") updateStaticModelLabel();
                        showStatus("Loaded: " + p.name, false);
                    };
                })(pair, input, row));

                container.appendChild(row);
            }

            if (controlsRow) pairListEl.appendChild(controlsRow);
            pairListEl.appendChild(container);
            updateCountLabel();
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

    function clonePair(name)
    {
        browser.storage.local.get(["pairs"]).then(function (s)
        {
            let pairs    = s.pairs || [];
            let original = pairs.find(function (p) { return p.name === name; });
            if (!original) return;

            let baseName = original.name + " copy";
            let newName  = baseName;
            let n = 2;
            while (pairs.some(function (p) { return p.name === newName; }))
            {
                newName = baseName + " " + n;
                n++;
            }

            let clone = Object.assign({}, original, { name: newName, isDefault: false, savedAt: Date.now() });
            pairs.push(clone);

            browser.storage.local.set({ pairs }).then(function ()
            {
                renderPairList(getPairMode());
                showStatus("Duplicated as \"" + newName + "\"", false);
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
        if (!confirmWorkflowIsSaveable(wf)) return;

        let tags = pairTagsInput ? pairTagsInput.value.trim() : "";
        let bannedTags = pairBannedTagsInput ? pairBannedTagsInput.value.trim() : "";

        browser.storage.local.get(["pairs"]).then(function (s)
        {
            let pairs = s.pairs || [];
            let defaultEntry = pairs.find(function (p) { return p.isDefault; });
            pairs = pairs.filter(function (p) { return p.name !== name && !p.isDefault; });
            pairs.push({ name: name, workflow: compressJson(wf), suffix: suffix, tags: tags, bannedTags: bannedTags, savedAt: Date.now() });
            if (defaultEntry) pairs.unshift(defaultEntry);
            browser.storage.local.set({ pairs }).then(function ()
            {
                showStatus("✅ Workflow \"" + name + "\" saved!", false);
                pairNameInput.value = "";
                if (pairTagsInput) pairTagsInput.value = "";
                if (pairBannedTagsInput) pairBannedTagsInput.value = "";
                renderPairList(getPairMode());
                updateStaticModelLabel();
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

    // Default label: never show a checkpoint name — each workflow has its own
    function updateDefaultLabel(workflowRaw)
    {
        let defaultRadio = document.querySelector("input[name='modelMode'][value='default']");
        if (!defaultRadio) return;
        let span = defaultRadio.nextElementSibling;
        if (!span) return;
        span.textContent = "";
        let strong = document.createElement("strong");
        strong.textContent = "Default";
        span.appendChild(strong);
        span.appendChild(document.createTextNode(" — use the model defined in your workflow"));
    }

    // Static label: update the dedicated span inside the Workflow > Static radio
    function updateStaticModelLabel()
    {
        let el = document.getElementById("staticPairLabel");
        if (!el) return;

        browser.storage.local.get(["staticPair"]).then(function (s)
        {
            el.textContent = "";
            if (s.staticPair)
            {
                let code = document.createElement("code");
                code.textContent = s.staticPair;
                code.style.cssText = "background:#0f0f1a;border:1px solid #2d2b55;border-radius:4px;padding:1px 6px;color:#a5b4fc;font-size:11px;font-style:normal;";
                el.appendChild(code);
            }
            else
            {
                el.textContent = "a specific saved workflow";
            }
        });
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

    function updateStaticModelLabelEl(modelName)
    {
        let el = document.getElementById("staticModelLabel");
        if (!el) return;
        el.textContent = "";
        if (modelName)
        {
            let code = document.createElement("code");
            code.textContent = getModelName(modelName);
            code.style.cssText = "background:#0f0f1a;border:1px solid #2d2b55;border-radius:4px;padding:1px 6px;color:#a5b4fc;font-size:11px;font-style:normal;";
            el.appendChild(code);
        }
        else
        {
            el.textContent = "a specific model";
        }
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
            {
                modelListArea.appendChild(buildGroupedList(cachedModels, "checkbox", "randomModelChoice", function (m) { return selectedModels.includes(m); }));
            }
            else
            {
                modelListArea.appendChild(buildGroupedList(cachedModels, "radio", "staticModelChoice", function (m) { return m === staticModel; }));
                // Show the saved value only, not the selected one
                updateStaticModelLabelEl(staticModel);
            }
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

    // ── App logo state (mirrors toolbar badge colors) ───────────────────────────

    function updateLogoState(url, reachable)
    {
        let logo = document.getElementById("appLogo");
        if (!logo) return;

        browser.storage.local.get(["selectedPairs"]).then(function (s)
        {
            let hasSelection = s.selectedPairs && s.selectedPairs.length > 0;

            if (!url || !url.trim())
            {
                logo.style.filter  = "grayscale(1)";
                logo.style.opacity = "0.5";
            }
            else if (reachable === false)
            {
                logo.style.filter  = "grayscale(1) sepia(1) saturate(3) hue-rotate(300deg)";
                logo.style.opacity = "0.7";
            }
            else if (!hasSelection)
            {
                logo.style.filter  = "sepia(1) saturate(4) hue-rotate(5deg)";
                logo.style.opacity = "0.9";
            }
            else
            {
                logo.style.filter  = "";
                logo.style.opacity = "1";
            }
        });
    }

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
            updateLogoState(url, null);
            return;
        }
        setBanner("#94a3b8", "Checking…");
        fetch(url.replace(/\/$/, "") + "/system_stats", { method: "GET", signal: AbortSignal.timeout(5000) })
        .then(function (r)
        {
            if (r.ok)
            {
                setBanner("#6ee7b7", "ComfyUI reachable");
                updateLogoState(url, true);
            }
            else
            {
                setBanner("#f87171", "Server error " + r.status);
                updateLogoState(url, false);
            }
        })
        .catch(function ()
        {
            setBanner("#f87171", "ComfyUI unreachable");
            updateLogoState(url, false);
        });
    }

    // Re-check periodically while the options page stays open
    setInterval(function () { updateServerBanner(urlInput.value.trim()); }, 30000);

    // Reflect selection changes immediately (e.g. after Save, or another tab editing storage)
    browser.storage.onChanged.addListener(function (changes)
    {
        if (changes.selectedPairs) updateLogoState(urlInput.value.trim(), null);
    });

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
        // Restore static model label from saved value
        if (s.staticModel) updateStaticModelLabelEl(s.staticModel);

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
            updateStaticModelLabel();
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

        if (!confirmWorkflowIsSaveable(wf)) return;

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
            pairs.unshift({ name: "Default", workflow: compressJson(wf), suffix: suffix, isDefault: true });

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
                    pairs[idx] = { name: loadedPairName, workflow: compressJson(wf), suffix: suffix, tags: newTags, bannedTags: newBanned, savedAt: Date.now() };
                }
            }

            browser.storage.local.set({ comfyUrl: url, globalBannedTags, promptSuffix: suffix, workflow: wf, modelMode: mode, selectedModels, staticModel, seedMode, pairMode, selectedPairs, staticPair, pairs, sequentialStarted: false })
            .then(function ()
            {
                let msg = (loadedPairName && loadedPairName !== "Default")
                    ? "\u2705 Settings + '" + loadedPairName + "' saved!"
                    : "✅ Settings saved!";
                showStatus(msg, false);
                renderPairList(pairMode);
                updateDefaultLabel(wf);
                updateStaticModelLabel();
                updateStaticModelLabelEl(staticModel);
            })
            .catch(function (e) { showStatus("❌ Save failed: " + e.message, true); });
        });
    });

    // ── Export workflows ───────────────────────────────────────────────────────

    document.getElementById("exportBtn").addEventListener("click", function ()
    {
        browser.storage.local.get(["pairs", "globalBannedTags", "seedMode", "modelMode", "selectedModels", "staticModel"]).then(function (s)
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
            let exportData =
            {
                globalBannedTags: s.globalBannedTags || "",
                seedMode: s.seedMode || "workflow",
                modelMode: s.modelMode || "default",
                selectedModels: s.selectedModels || [],
                staticModel: s.staticModel || "",
                pairs: pairs
            };
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

    function downloadPairsAsJson(pairs, globalBannedTags, filename, extra)
    {
        let custom = pairs.filter(function (p) { return !p.isDefault; });
        if (custom.length === 0) return;
        extra = extra || {};
        let exportData =
        {
            globalBannedTags: globalBannedTags || "",
            seedMode: extra.seedMode || "workflow",
            modelMode: extra.modelMode || "default",
            selectedModels: extra.selectedModels || [],
            staticModel: extra.staticModel || "",
            pairs: custom
        };
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
                let importedSeedMode    = null;
                let importedModelMode   = null;
                let importedSelectedModels = null;
                let importedStaticModel = null;
                if (Array.isArray(imported))
                {
                    // old format
                }
                else if (imported && Array.isArray(imported.pairs))
                {
                    importedGlobalBannedTags = imported.globalBannedTags || "";
                    if (typeof imported.seedMode === "string") importedSeedMode = imported.seedMode;
                    if (typeof imported.modelMode === "string") importedModelMode = imported.modelMode;
                    if (Array.isArray(imported.selectedModels)) importedSelectedModels = imported.selectedModels;
                    if (typeof imported.staticModel === "string") importedStaticModel = imported.staticModel;
                    imported = imported.pairs;
                }
                else
                {
                    statusEl.textContent = "Invalid file — expected a JSON array or export object."; return;
                }

                let valid = imported.filter(function (p) { return p.name && p.workflow; });
                if (valid.length === 0) { statusEl.textContent = "No valid workflows found in file."; return; }

                browser.storage.local.get(["pairs", "globalBannedTags", "seedMode", "modelMode", "selectedModels", "staticModel"]).then(function (s)
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
                    downloadPairsAsJson(existing, s.globalBannedTags || "", "civitai-comfyui-backup-" + stamp + ".json",
                        { seedMode: s.seedMode, modelMode: s.modelMode, selectedModels: s.selectedModels, staticModel: s.staticModel });

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
                    let restoredConfig = false;
                    if (importedSeedMode !== null)
                    {
                        saveData.seedMode = importedSeedMode;
                        for (let rb of seedRadios) { rb.checked = (rb.value === importedSeedMode); }
                        restoredConfig = true;
                    }
                    if (importedModelMode !== null)
                    {
                        saveData.modelMode = importedModelMode;
                        for (let rb of document.querySelectorAll("input[name='modelMode']")) { rb.checked = (rb.value === importedModelMode); }
                        restoredConfig = true;
                    }
                    if (importedSelectedModels !== null) { saveData.selectedModels = importedSelectedModels; restoredConfig = true; }
                    if (importedStaticModel !== null)    { saveData.staticModel    = importedStaticModel;    restoredConfig = true; }

                    browser.storage.local.set(saveData).then(function ()
                    {
                        let detail = added > 0 && replaced > 0
                            ? added + " added, " + replaced + " replaced"
                            : added > 0 ? added + " added" : replaced + " replaced";
                        let extra = importedGlobalBannedTags !== null ? " Global banned tags restored." : "";
                        if (restoredConfig) extra += " Seed/model config restored.";
                        statusEl.textContent = "✅ Import done (" + detail + "). Backup downloaded." + extra;
                        renderPairList(getPairMode());
                        updatePickerUI();
                        if (importedModelMode !== null && importedModelMode !== "default")
                        {
                            let url = urlInput.value.trim().replace(/\/$/, "");
                            if (url)
                            {
                                fetch(url + "/models/checkpoints")
                                .then(function (res) { return res.json(); })
                                .then(function (data) { if (Array.isArray(data) && data.length > 0) { cachedModels = data.sort(); renderModelList(importedModelMode); } })
                                .catch(function () {});
                            }
                        }
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

    function compressJson(raw)
    {
        if (!raw || !raw.trim()) return raw;
        try { return JSON.stringify(JSON.parse(raw)); }
        catch (e) { return raw; }
    }

    function validateWorkflow(raw)
    {
        if (!raw || raw.trim() === "") return "Workflow JSON is empty.";
        try { let p = JSON.parse(raw); if (typeof p !== "object" || Array.isArray(p)) return "Workflow must be a JSON object."; return null; }
        catch (e) { return "Invalid JSON: " + e.message; }
    }

    // Soft checks — a workflow missing these will still be accepted after
    // confirmation, since a valid ComfyUI graph could legitimately omit one
    // (e.g. a checkpoint loaded via a different node type).
    function getWorkflowWarnings(raw)
    {
        let warnings = [];
        try
        {
            let wf = JSON.parse(raw);
            let hasClipTextEncode = false;
            let hasCheckpointLoader = false;
            for (let nodeId in wf)
            {
                let node = wf[nodeId];
                if (!node || typeof node !== "object") continue;
                if (node.class_type === "CLIPTextEncode") hasClipTextEncode = true;
                if (node.class_type === "CheckpointLoaderSimple") hasCheckpointLoader = true;
            }
            if (!hasClipTextEncode)   warnings.push("No CLIPTextEncode node found — the CivitAI prompt won't be injected anywhere.");
            if (!hasCheckpointLoader) warnings.push("No CheckpointLoaderSimple node found — model override (if enabled) won't apply.");
        }
        catch (e) { /* JSON errors are already caught by validateWorkflow */ }
        return warnings;
    }

    // Runs both checks; returns false (and shows/asks the appropriate
    // message) when the save should be aborted.
    function confirmWorkflowIsSaveable(raw)
    {
        let wfError = validateWorkflow(raw);
        if (wfError) { showStatus(wfError, true); return false; }

        let warnings = getWorkflowWarnings(raw);
        if (warnings.length > 0)
        {
            return confirm("Workflow warning:\n\n- " + warnings.join("\n- ") + "\n\nSave anyway?");
        }
        return true;
    }

})();
