// shared.js — loaded by both background.js and content.js (plain globals,
// no module system). Keep everything here free of DOM/browser-context
// dependencies so it behaves identically in either script.

// ── Embedded-metadata extraction ─────────────────────────────────────────────
// CivitAI's default "optimized" delivery URL re-encodes images, stripping any
// EXIF/PNG-text metadata. When it hasn't been stripped (original files, some
// cache variants), the full generation JSON is still readable — this scans
// the raw image bytes for it rather than parsing exact chunk offsets, so it
// works across PNG/WEBP/JPEG without a dedicated parser per format.

function bufferToLatin1String(buffer)
{
    let bytes = new Uint8Array(buffer);
    let parts = [];
    let CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK)
    {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return parts.join("");
}

// Finds "<key>": "<json-escaped string>" and returns the unescaped string.
function findJsonStringValue(text, key)
{
    let keyIdx = text.indexOf("\"" + key + "\"");
    if (keyIdx === -1) return null;

    let idx = keyIdx + key.length + 2;
    while (idx < text.length && text[idx] !== "\"")
    {
        if (text[idx] === "{" || text[idx] === "[") return null; // value isn't a string
        idx++;
    }
    if (text[idx] !== "\"") return null;

    let start = idx;
    let i = idx + 1;
    while (i < text.length)
    {
        let c = text[i];
        if (c === "\\") { i += 2; continue; }
        if (c === "\"") { i++; break; }
        i++;
    }

    try { return JSON.parse(text.slice(start, i)); }
    catch (e) { return null; }
}

// Reads a balanced {...} object starting exactly at text[start] (brace
// matching aware of quoted strings) and JSON.parses it.
function extractBalancedJsonAt(text, start)
{
    if (text[start] !== "{") return null;

    let depth = 0;
    let inString = false;
    let i = start;
    for (; i < text.length; i++)
    {
        let c = text[i];
        if (inString)
        {
            if (c === "\\") { i++; continue; }
            if (c === "\"") inString = false;
            continue;
        }
        if (c === "\"") { inString = true; continue; }
        if (c === "{") depth++;
        else if (c === "}")
        {
            depth--;
            if (depth === 0) { i++; break; }
        }
    }

    try { return JSON.parse(text.slice(start, i)); }
    catch (e) { return null; }
}

// Locates <label> then the first balanced {...} object after it.
function findJsonObjectValue(text, label)
{
    let idx = text.indexOf(label);
    if (idx === -1) return null;

    let start = text.indexOf("{", idx + label.length);
    if (start === -1) return null;

    return extractBalancedJsonAt(text, start);
}

// Shared with buildPayload(): given a ComfyUI API-format workflow graph,
// returns the set of node ids feeding a sampler's "negative" input (traced
// upstream through conditioning passthrough nodes too).
function traceNegativeNodeIds(workflow)
{
    let negativeNodeIds = new Set();

    let samplerTypes = [
        "KSampler", "KSamplerAdvanced", "SamplerCustom",
        "KSamplerSelect", "KSampler (Efficient)", "ToBasicPipe",
        "DetailerForEach", "FaceDetailer"
    ];

    for (let nodeId in workflow)
    {
        let node = workflow[nodeId];
        if (!node.inputs) continue;

        let isSampler = samplerTypes.includes(node.class_type);

        for (let inputKey in node.inputs)
        {
            let val = node.inputs[inputKey];

            // Node references are arrays: [connectedNodeId, outputIndex]
            if (!Array.isArray(val) || val.length !== 2) continue;

            let connectedId = String(val[0]);
            let keyLower = inputKey.toLowerCase();

            // Direct negative input on a sampler
            if (isSampler && keyLower === "negative")
            {
                negativeNodeIds.add(connectedId);
            }

            // Conditioning passthrough nodes (e.g. ControlNetApplyAdvanced)
            // that feed into negative — mark them too and trace recursively
            if (keyLower === "negative" || keyLower === "negative_conditioning")
            {
                negativeNodeIds.add(connectedId);
            }
        }
    }

    // Recursively trace upstream ONLY through conditioning passthrough nodes
    // (nodes that take conditioning as input and output conditioning)
    // This avoids incorrectly marking shared CLIP/model nodes as negative
    let conditioningPassthroughs = [
        "ControlNetApplyAdvanced", "ControlNetApply",
        "CLIPTextEncodeSDXL", "ConditioningCombine",
        "ConditioningAverage", "ConditioningSetArea",
        "ConditioningSetTimestepRange", "ConditioningConcat",
        "IPAdapterApply", "IPAdapterApplyEncoded"
    ];

    let changed = true;
    while (changed)
    {
        changed = false;
        for (let nodeId in workflow)
        {
            if (!negativeNodeIds.has(nodeId)) continue;
            let node = workflow[nodeId];
            if (!node.inputs) continue;

            // Only follow upstream through known conditioning nodes
            if (!conditioningPassthroughs.includes(node.class_type)) continue;

            for (let inputKey in node.inputs)
            {
                let val = node.inputs[inputKey];
                if (!Array.isArray(val) || val.length !== 2) continue;
                let connectedId = String(val[0]);
                if (!negativeNodeIds.has(connectedId))
                {
                    negativeNodeIds.add(connectedId);
                    changed = true;
                }
            }
        }
    }

    return negativeNodeIds;
}

// Shared with buildPayload(): is this CLIPTextEncode node the negative one?
function isNegativeClipTextNode(nodeId, node, negativeNodeIds)
{
    if (negativeNodeIds.has(nodeId)) return true;

    let t = node.inputs.text.toLowerCase();
    return t.includes("worst quality") || t.includes("worst_quality") ||
           t.includes("bad quality")   || t.includes("bad_quality") ||
           t.includes("score_4")       || t.includes("score_5") ||
           node.inputs._negative === true;
}

// A1111/CivitAI display names → ComfyUI's internal sampler_name (+ scheduler
// suffix, when the display name bakes one in like "... Karras").
let SAMPLER_LABEL_MAP = {
    "euler a": ["euler_ancestral", null],
    "euler": ["euler", null],
    "lms": ["lms", null],
    "heun": ["heun", null],
    "dpm2": ["dpm_2", null],
    "dpm2 a": ["dpm_2_ancestral", null],
    "dpm++ 2s a": ["dpmpp_2s_ancestral", null],
    "dpm++ 2m": ["dpmpp_2m", null],
    "dpm++ sde": ["dpmpp_sde", null],
    "dpm++ 2m sde": ["dpmpp_2m_sde", null],
    "dpm++ 3m sde": ["dpmpp_3m_sde", null],
    "dpm fast": ["dpm_fast", null],
    "dpm adaptive": ["dpm_adaptive", null],
    "lms karras": ["lms", "karras"],
    "dpm2 karras": ["dpm_2", "karras"],
    "dpm2 a karras": ["dpm_2_ancestral", "karras"],
    "dpm++ 2s a karras": ["dpmpp_2s_ancestral", "karras"],
    "dpm++ 2m karras": ["dpmpp_2m", "karras"],
    "dpm++ sde karras": ["dpmpp_sde", "karras"],
    "dpm++ 2m sde karras": ["dpmpp_2m_sde", "karras"],
    "dpm++ 3m sde karras": ["dpmpp_3m_sde", "karras"],
    "ddim": ["ddim", null],
    "plms": ["plms", null],
    "uni_pc": ["uni_pc", null],
    "unipc": ["uni_pc", null]
};

// Returns { sampler, scheduler } in ComfyUI's own vocabulary, or null when
// the label isn't in the table — callers should just skip the override
// rather than push an invalid sampler_name to ComfyUI.
function mapSamplerLabel(label)
{
    if (!label) return null;
    let hit = SAMPLER_LABEL_MAP[label.trim().toLowerCase()];
    return hit ? { sampler: hit[0], scheduler: hit[1] } : null;
}

// Pulls the A1111-style "Steps: N, Sampler: X, CFG scale: Y, Seed: Z,
// Size: WxH, Clip skip: C" tail that both raw A1111 PNGs and CivitAI's own
// on-site generator write after the negative prompt. Capped window since
// these fields always sit within a few hundred chars of the marker.
function extractA1111Fields(text, fromIdx)
{
    let scope = text.slice(fromIdx, fromIdx + 4000);
    let fields = {};
    let m;

    if ((m = scope.match(/Steps:\s*(\d+)/))) fields.steps = parseInt(m[1], 10);
    if ((m = scope.match(/Sampler:\s*([^,\n]+)/))) fields.samplerLabel = m[1].trim();
    if ((m = scope.match(/CFG scale:\s*([\d.]+)/))) fields.cfg = parseFloat(m[1]);
    if ((m = scope.match(/Seed:\s*(\d+)/))) fields.seed = parseInt(m[1], 10);
    if ((m = scope.match(/Size:\s*(\d+)x(\d+)/))) { fields.width = parseInt(m[1], 10); fields.height = parseInt(m[2], 10); }
    if ((m = scope.match(/Clip skip:\s*(\d+)/))) fields.clipSkip = parseInt(m[1], 10);

    return fields;
}

// Native ComfyUI PNGs embed the raw API-format workflow graph under a PNG
// text chunk keyworded "prompt" — no CivitAI wrapper at all. We find that
// graph, run the same negative-node tracing buildPayload() uses, and pull
// the first non-negative CLIPTextEncode node's text.
function tryExtractComfyUIWorkflowPrompt(text)
{
    let marker = "tEXtprompt";
    let idx = text.indexOf(marker);
    if (idx === -1) return null;

    let start = text.indexOf("{", idx + marker.length);
    if (start === -1) return null;

    let workflow = extractBalancedJsonAt(text, start);
    if (!workflow || typeof workflow !== "object") return null;

    let negativeNodeIds = traceNegativeNodeIds(workflow);
    let positive = null;
    let negative = null;

    for (let nodeId in workflow)
    {
        let node = workflow[nodeId];
        if (!node || node.class_type !== "CLIPTextEncode") continue;
        if (!node.inputs || typeof node.inputs.text !== "string") continue;

        let t = node.inputs.text.trim();
        if (t.length === 0) continue;

        if (isNegativeClipTextNode(nodeId, node, negativeNodeIds))
        {
            if (!negative) negative = t;
        }
        else if (!positive) positive = t;
    }

    if (!positive) return null;

    // These are already ComfyUI-native values (came straight out of a
    // ComfyUI graph), so no label-mapping needed — just read literal
    // (non-wired) values off the sampler/checkpoint nodes.
    let result = {
        prompt: positive, negativePrompt: negative,
        steps: null, cfg: null, seed: null,
        sampler: null, scheduler: null, checkpoint: null, clipSkip: null,
        width: null, height: null
    };

    for (let nodeId in workflow)
    {
        let node = workflow[nodeId];
        if (!node.inputs) continue;

        if (typeof node.inputs.steps === "number") result.steps = node.inputs.steps;
        if (typeof node.inputs.cfg === "number") result.cfg = node.inputs.cfg;
        if (typeof node.inputs.sampler_name === "string") result.sampler = node.inputs.sampler_name;
        if (typeof node.inputs.scheduler === "string") result.scheduler = node.inputs.scheduler;
        if (typeof node.inputs.seed === "number") result.seed = node.inputs.seed;
        else if (typeof node.inputs.noise_seed === "number") result.seed = node.inputs.noise_seed;

        if (node.class_type === "CheckpointLoaderSimple" && typeof node.inputs.ckpt_name === "string")
        {
            result.checkpoint = node.inputs.ckpt_name;
        }
    }

    return result;
}

// CivitAI's own on-site generator writes a literal "Civitai metadata: {...}"
// JSON object straight into the EXIF UserComment / PNG text (no extra
// escaping layer, unlike the ComfyUI-orchestration "extraMetadata" case).
function tryExtractCivitaiMetadataLabel(text)
{
    let idx = text.indexOf("Civitai metadata:");
    if (idx === -1) return null;

    let meta = findJsonObjectValue(text, "Civitai metadata:");
    if (!meta || typeof meta.prompt !== "string" || meta.prompt.trim().length === 0) return null;

    // Seed isn't in this JSON block — it's in the A1111-style tail just
    // before it ("Steps: N, Sampler: X, ..., Seed: Z, ...").
    let a1111 = extractA1111Fields(text, Math.max(0, idx - 4000));
    let mapped = mapSamplerLabel(meta.sampler || a1111.samplerLabel);

    return {
        prompt: meta.prompt,
        negativePrompt: meta.negativePrompt || null,
        steps: meta.steps != null ? meta.steps : (a1111.steps != null ? a1111.steps : null),
        cfg: meta.cfgScale != null ? meta.cfgScale : (a1111.cfg != null ? a1111.cfg : null),
        seed: a1111.seed != null ? a1111.seed : null,
        clipSkip: meta.clipSkip != null ? meta.clipSkip : (a1111.clipSkip != null ? a1111.clipSkip : null),
        width: a1111.width != null ? a1111.width : null,
        height: a1111.height != null ? a1111.height : null,
        sampler: mapped ? mapped.sampler : null,
        scheduler: mapped ? mapped.scheduler : null,
        checkpoint: null
    };
}

// CivitAI orchestration images embed a ComfyUI-style graph plus an
// "extraMetadata" field whose value is itself a JSON string with the
// human prompt.
function tryExtractCivitaiExtraMetadata(text)
{
    let inner = findJsonStringValue(text, "extraMetadata");
    if (!inner) return null;

    try
    {
        let meta = JSON.parse(inner);
        if (meta && typeof meta.prompt === "string" && meta.prompt.trim().length > 0)
        {
            let mapped = mapSamplerLabel(meta.sampler);
            return {
                prompt: meta.prompt,
                negativePrompt: meta.negativePrompt || null,
                steps: meta.steps != null ? meta.steps : null,
                cfg: meta.cfgScale != null ? meta.cfgScale : null,
                seed: meta.seed != null ? meta.seed : null,
                clipSkip: meta.clipSkip != null ? meta.clipSkip : null,
                width: null, height: null,
                sampler: mapped ? mapped.sampler : null,
                scheduler: mapped ? mapped.scheduler : null,
                checkpoint: null
            };
        }
    }
    catch (e) {}

    return null;
}

// AUTOMATIC1111-style PNG "parameters" text chunk: plain text, not JSON.
function tryExtractA1111Parameters(text)
{
    let negIdx = text.indexOf("Negative prompt:");
    if (negIdx === -1) return null;

    function isBoundary(code)
    {
        return code === 0 || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d);
    }

    let start = negIdx;
    while (start > 0 && !isBoundary(text.charCodeAt(start - 1))) start--;
    let positive = text.slice(start, negIdx).trim();

    let afterNeg = negIdx + "Negative prompt:".length;
    let end = afterNeg;
    while (end < text.length && !isBoundary(text.charCodeAt(end))) end++;
    let negBlock = text.slice(afterNeg, end);

    let stepsIdx = negBlock.search(/\r?\n(Steps|Sampler|CFG scale|Seed|Model|Size):/);
    let negative = (stepsIdx !== -1 ? negBlock.slice(0, stepsIdx) : negBlock).trim();

    if (positive.length === 0) return null;

    let extra = extractA1111Fields(text, negIdx);
    let mapped = mapSamplerLabel(extra.samplerLabel);

    return {
        prompt: positive,
        negativePrompt: negative || null,
        steps: extra.steps != null ? extra.steps : null,
        cfg: extra.cfg != null ? extra.cfg : null,
        seed: extra.seed != null ? extra.seed : null,
        clipSkip: extra.clipSkip != null ? extra.clipSkip : null,
        width: extra.width != null ? extra.width : null,
        height: extra.height != null ? extra.height : null,
        sampler: mapped ? mapped.sampler : null,
        scheduler: mapped ? mapped.scheduler : null,
        checkpoint: null
    };
}

// EXIF UserComment can be stored as "UNICODE\0" + UTF-16LE text — every
// ASCII byte is then followed by a 0x00 byte, which breaks literal-substring
// search. Stripping nulls recovers a readable ASCII string in that case
// (and is a harmless no-op search pass when the encoding was ASCII already).
function stripNullBytes(text)
{
    let out = "";
    for (let i = 0; i < text.length; i++)
    {
        if (text.charCodeAt(i) !== 0) out += text[i];
    }
    return out;
}

function extractPromptFromImageBuffer(buffer)
{
    let text = bufferToLatin1String(buffer);

    let direct = tryExtractCivitaiExtraMetadata(text)
        || tryExtractCivitaiMetadataLabel(text)
        || tryExtractComfyUIWorkflowPrompt(text)
        || tryExtractA1111Parameters(text);
    if (direct) return direct;

    let stripped = stripNullBytes(text);
    return tryExtractCivitaiExtraMetadata(stripped)
        || tryExtractCivitaiMetadataLabel(stripped)
        || tryExtractComfyUIWorkflowPrompt(stripped)
        || tryExtractA1111Parameters(stripped)
        || null;
}

// ── Tag-grouped workflow resolution ──────────────────────────────────────────
// Shared by the injected button's custom menu (content.js) and the native
// right-click menu (background.js) so "random"/"sequential" pairMode behaves
// identically from both entry points.

function pairHasTag(pair, tag)
{
    let tags = (pair.tags || "").split(",").map(function (t) { return t.trim(); });
    return tags.indexOf(tag) !== -1;
}

// Sequential mode randomizes which pair starts the rotation the first time a
// given tag is used (tagSequentialStarted flags that), then cycles
// predictably 0→1→2→...→0 from there — same pattern as the extension's
// existing global (non-tag) sequential mode.
async function resolveTagPairsSequential(tag, tagPool)
{
    let fresh = await browser.storage.local.get(["tagSequentialIndex", "tagSequentialStarted"]);
    let tagIndexMap = fresh.tagSequentialIndex || {};
    let tagStartedMap = fresh.tagSequentialStarted || {};

    let idx;
    if (!tagStartedMap[tag])
    {
        idx = Math.floor(Math.random() * tagPool.length);
        tagStartedMap[tag] = true;
    }
    else
    {
        idx = (tagIndexMap[tag] || 0) % tagPool.length;
    }

    tagIndexMap[tag] = (idx + 1) % tagPool.length;
    await browser.storage.local.set({ tagSequentialIndex: tagIndexMap, tagSequentialStarted: tagStartedMap });

    return tagPool[idx];
}

// random: one random pick, sequential: see above, static/all: every
// workflow tagged with it.
async function resolveTagPairs(tag, pairs, mode)
{
    let tagPool = pairs.filter(function (p) { return pairHasTag(p, tag); });
    if (tagPool.length === 0) return [];

    if (mode === "random") return [tagPool[Math.floor(Math.random() * tagPool.length)]];
    if (mode === "sequential") return [await resolveTagPairsSequential(tag, tagPool)];

    return tagPool; // static / all
}

// ── Banned tag filtering ──────────────────────────────────────────────────────

function filterBannedTags(prompt, bannedRaw)
{
    if (!bannedRaw || !bannedRaw.trim()) return prompt;

    // Parse banned list: trim each entry, separate wildcards from exact
    let rules = bannedRaw.split(",").map(function (r) { return r.trim(); }).filter(Boolean);

    // Split prompt into individual tags preserving spacing style
    let tags = prompt.split(",");

    tags = tags.filter(function (tag)
    {
        let trimmed = tag.trim().toLowerCase();
        for (let rule of rules)
        {
            let isWildcard = rule.charAt(rule.length - 1) === "*";
            // Re-trim after stripping the "*" — "ears *" (space before the
            // star) would otherwise leave a trailing space baked into base,
            // which silently never matches a tag ending in "ears" exactly.
            let base = isWildcard ? rule.slice(0, -1).trim().toLowerCase() : rule.toLowerCase();
            if (isWildcard)
            {
                // Remove any tag containing the base string
                if (trimmed.indexOf(base) !== -1) return false;
            }
            else
            {
                // Exact match only
                if (trimmed === base) return false;
            }
        }
        return true;
    });

    return tags.join(",");
}

// ── ComfyUI payload construction ──────────────────────────────────────────────

// samplerOverrides (optional): { steps, cfg, samplerName, scheduler } pulled
// from source-image metadata. Only applied to inputs that already exist and
// aren't wired to another node, so it's a no-op for workflows/nodes that
// don't have that field.
function buildPayload(prompt, workflowTemplate, modelOverride, seedMode, staticSeed, imageId, samplerOverrides)
{
    let workflow = JSON.parse(JSON.stringify(workflowTemplate));

    // Trace which CLIPTextEncode nodes feed a sampler's "negative" input —
    // shared with tryExtractComfyUIWorkflowPrompt() above.
    let negativeNodeIds = traceNegativeNodeIds(workflow);

    // ── Inject prompt and model ────────────────────────────────────────────

    for (let nodeId in workflow)
    {
        let node = workflow[nodeId];
        if (!node.inputs) continue;

        if (node.class_type === "CLIPTextEncode" && typeof node.inputs.text === "string")
        {
            if (!isNegativeClipTextNode(nodeId, node, negativeNodeIds)) node.inputs.text = prompt;
        }

        if (modelOverride && node.class_type === "CheckpointLoaderSimple")
        {
            node.inputs.ckpt_name = modelOverride;
        }

        // Inject seed into sampler nodes
        if (seedMode === "random" || seedMode === "static")
        {
            let samplerSeedInputs = ["seed", "noise_seed"];
            let isSampler = [
                "KSampler", "KSamplerAdvanced", "SamplerCustom",
                "Seed (rgthree)", "easy int"
            ].includes(node.class_type);

            if (isSampler)
            {
                for (let seedKey of samplerSeedInputs)
                {
                    if (typeof node.inputs[seedKey] === "number")
                    {
                        // staticSeed is pre-generated once per click and passed in
                        node.inputs[seedKey] = staticSeed !== null ? staticSeed : Math.floor(Math.random() * 2147483647);
                    }
                }
            }
        }

        if (samplerOverrides)
        {
            if (samplerOverrides.steps != null && "steps" in node.inputs && !Array.isArray(node.inputs.steps))
                node.inputs.steps = samplerOverrides.steps;
            if (samplerOverrides.cfg != null && "cfg" in node.inputs && !Array.isArray(node.inputs.cfg))
                node.inputs.cfg = samplerOverrides.cfg;
            if (samplerOverrides.samplerName && "sampler_name" in node.inputs && !Array.isArray(node.inputs.sampler_name))
                node.inputs.sampler_name = samplerOverrides.samplerName;
            if (samplerOverrides.scheduler && "scheduler" in node.inputs && !Array.isArray(node.inputs.scheduler))
                node.inputs.scheduler = samplerOverrides.scheduler;
        }
    }

    let payload = { prompt: workflow };

    // Only attach source metadata when we actually resolved an id —
    // never inject a null/empty civitai_image_id.
    if (imageId)
    {
        payload.extra_data = { extra_pnginfo: { civitai_image_id: imageId } };
    }

    return payload;
}
