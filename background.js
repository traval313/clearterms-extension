"use strict"

/**
 * Stores detection and consent data keyed by tab id.
 * @type {Map<number, DetectionState>}
 */
const detectionState = new Map()
const analysisControllers = new Map()
const scheduleTask = typeof queueMicrotask === "function" ? queueMicrotask : (fn) => setTimeout(fn, 0)

const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent"
const MAX_GEMINI_INPUT_CHARS = 20000
const GEMINI_PROMPT = `You are a Consumer Protection Advocate and Data Auditor specializing in legal transparency.
Your task is to analyze Terms of Service (ToS) and Privacy Policies to produce a "Privacy Nutritional Label" for students, families, and community members.

You must remain neutral, evidence-based, and mathematically precise.
Do not speculate. Do not give legal advice.

# TASK

Perform a structured audit of the provided legal document using the Strict Deterministic Rules below.

# PRIVACY PILLARS & WEIGHTS

* Data Collection (25%)
* Data Sharing (25%)
* User Control (20%)
* Data Longevity (15%)
* Legal Integrity (15%)

# SCORING DETERMINISM RULES (MANDATORY)

1. Clause Detection & Hierarchy
- Scoring MUST be based ONLY on the detection of explicit clause types listed in the "Clause Triggers" rubric.
- Worst-Case Resolution: If multiple clause types are detected within a single pillar (e.g., both "crash logs" and "biometrics"), you MUST assign the LOWEST (most harmful) applicable Level.

2. The "Neutral Default" Definition
- If NO specific clause triggers (Levels 1, 2, 3, 4, 5) are found for a pillar, you must check for "General Privacy Language."
- Definition: "General Privacy Language" consists of standard headers (e.g., "Information We Collect", "Security") OR generic assurances (e.g., "We value your privacy") without specific technical details.
- Rule:
  * If General Privacy Language is PRESENT but specific triggers are ABSENT -> Assign Level 3.
  * If the section is completely MISSING -> Assign Level 3 (Standard Default).

3. Fixed Numeric Mapping
- Output risk scores where LOW numbers mean low risk/exemplary and HIGH numbers mean high risk/predatory.
- You are NOT allowed to choose a custom score. You MUST use the exact Fixed Score below for the assigned Level:
  * Level 1 → 5 points
  * Level 2 → 20 points
  * Level 3 → 40 points
  * Level 4 → 60 points
  * Level 5 → 100 points

4. Reading Complexity Logic
- Do not guess. Determine Reading Level based on these text features:
  * Grade 12+ (Complex): Contains sentences >25 words OR legal jargon ("indemnification," "arbitration," "jurisdiction").
  * Grade 10 (Moderate): Standard business language, clear headers, sentences 15-25 words.
  * Grade 8 (Simple): Short sentences (<15 words), plain English ("we will not," "you can"), bullet points.


# CLAUSE-BASED AUDIT RUBRIC

## Data Collection (25%)
- Level 1 (5): Limits collection to email, username, password, or payment only. No device IDs or analytics.
- Level 2 (20): Mentions crash logs, diagnostics, performance data, or cookies for site functionality.
- Level 3 (40): Mentions IP address, device ID, advertising ID, browser type, or usage data for optimization/marketing.
- Level 4 (60): Mentions cross-site tracking, GPS/precise location, tracking pixels, or combining data with third-party sources.
- Level 5 (100): Mentions biometrics, health data, contact lists, photos, or microphone access (unless essential to a feature) OR intrusive sensors like keystroke logging, clipboard scanning, or background recording.

## Data Sharing (25%)
- Level 1 (5): Explicitly states "We do not sell or share personal data with third parties."
- Level 2 (20): Shares only with service providers/processors/vendors for operations.
- Level 3 (40): Shares with affiliates, subsidiaries, or corporate family.
- Level 4 (60): Shares with partners, third parties, or ad networks for marketing/promotions/joint ventures.
- Level 5 (100): Mentions selling/renting/leasing data, sharing with data brokers/researchers, disclaims responsibility for third-party sites/links, or calls data a transferable asset without restriction.

## User Control (20%)
- Level 1 (5): Opt-in required for tracking and explicit delete-account button.
- Level 2 (20): Dashboard/settings provided for opt-out; "Do Not Sell" link mentioned.
- Level 3 (40): References GDPR/CCPA rights but requires emailing support or a form.
- Level 4 (60): Rights limited to specific jurisdictions only.
- Level 5 (100): Must contact company to opt-out with no clear process/timeline OR data provision mandatory for use with no deletion rights.

## Data Longevity (15%)
- Level 1 (5): Explicit retention timeframe (e.g., deleted after 30 days or session only).
- Level 2 (20): Deleted upon account closure or when no longer needed.
- Level 3 (40): Retained as long as account is active.
- Level 4 (60): Retained for business/legal purposes (open-ended).
- Level 5 (100): "Anonymized/Aggregated" data retained indefinitely, permanent retention, or irrevocable license to keep data.

## Legal Integrity (15%)
- Level 1 (5): States no mandatory arbitration or user retains ownership of content.
- Level 2 (20): Standard liability limits; no arbitration/class waiver.
- Level 3 (40): Arbitration clause with explicit opt-out window.
- Level 4 (60): Mandatory arbitration with no opt-out.
- Level 5 (100): Class action waiver, waiver of jury trial, and/or perpetual worldwide license to user content.

# CALCULATIONS & FINAL LEVEL
- Numeric Total = (Collection * 0.25) + (Sharing * 0.25) + (Control * 0.20) + (Longevity * 0.15) + (Legal * 0.15) [round to nearest whole number]
- Map to Safety Levels (remember, higher scores mean higher risk):
  * 80-100 -> Level 5 (Predatory)
  * 60-79 -> Level 4 (High Risk)
  * 40-59 -> Level 3 (Moderate Risk)
  * 20-39 -> Level 2 (Low Risk)
  * 0-19 -> Level 1 (Safe)

# CATEGORY JUSTIFICATIONS
For each pillar you MUST provide a concise justification explaining the score you assigned:
- Limit yourself to 1-2 sentences per pillar.
- Reference the exact behavior or language from the text (quote or paraphrase specific clauses). No speculation.
- No legal advice.
- These are justifications for the score, not a summary of the whole section.

# OUTPUT FORMAT
Output JSON ONLY. No markdown.
{
  "summary": "Plain-language summary of the most important things a user should know before agreeing (Max 3 sentences).",
  "scores": {
    "overall": 0,
    "final_level": "Level X (Label)",
    "breakdown": {
      "data_collection": 0,
      "data_sharing": 0,
      "user_control": 0,
      "data_longevity": 0,
      "legal_integrity": 0
    }
  },
  "justifications": {
    "data_collection": "1-2 sentence justification referencing the document text for why this category earned its score.",
    "data_sharing": "...",
    "user_control": "...",
    "data_longevity": "...",
    "legal_integrity": "..."
  }
}

Analyze ONLY the provided document text. If information is missing, state that clearly.`

/**
 * Returns an empty detection state object.
 */
function createDefaultState() {
    return {
        detected: false,
        score: 0,
        matchedUrlKeywords: [],
        matchedContentKeywords: [],
        matchedActionKeywords: [],
        lastUpdated: null,
        consent: null,
        extractionStatus: "idle",
        extractionResult: null,
        extractionError: null,
        analysisStatus: "idle",
        analysisResult: null,
        analysisError: null,
    }
}

/**
 * Persists detection details for a tab.
 * @param {number} tabId
 * @param {Partial<DetectionState>} state
 */
function updateDetectionState(tabId, state) {
    const nextState = {
        ...createDefaultState(),
        ...detectionState.get(tabId),
        ...state,
        lastUpdated: Date.now(),
    }
    detectionState.set(tabId, nextState)
}

/**
 * Handles incoming runtime messages from content scripts and the popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
        return undefined
    }

    if (message.type === "LEGAL_PAGE_DETECTION" && sender.tab?.id !== undefined) {
        updateDetectionState(sender.tab.id, message.payload)
        return undefined
    }

    if (message.type === "GET_DETECTION_STATE" && typeof message.tabId === "number") {
        const state = detectionState.get(message.tabId) ?? createDefaultState()
        sendResponse(serializeStateForResponse(state))
        return true
    }

    if (message.type === "USER_CONSENT_RESPONSE" && typeof message.tabId === "number") {
        const tabId = message.tabId
        const consent = message.response === "accepted" ? "accepted" : "declined"
        updateDetectionState(tabId, {
            consent,
            analysisStatus: "idle",
            analysisResult: null,
            analysisError: null,
            ...(consent === "declined" ? {
                extractionStatus: "idle",
                extractionResult: null,
                extractionError: null,
            } : {}),
        })
        if (consent === "accepted") {
            startExtractionForTab(tabId)
        } else {
            cancelAnalysisForTab(tabId)
        }
        return undefined
    }

    if (message.type === "LEGAL_TEXT_EXTRACTION_RESULT" && sender.tab?.id !== undefined) {
        const tabId = sender.tab.id
        const payload = message.payload ?? {}
        if (payload.status === "success" && payload.result) {
            updateDetectionState(tabId, {
                extractionStatus: "success",
                extractionResult: payload.result,
                extractionError: null,
                analysisStatus: "pending",
                analysisResult: null,
                analysisError: null,
            })
            scheduleTask(() => runGeminiAnalysis(tabId))
        } else {
            cancelAnalysisForTab(tabId)
            updateDetectionState(tabId, {
                extractionStatus: "error",
                extractionResult: null,
                extractionError: payload.error || "Extraction failed.",
                analysisStatus: "idle",
                analysisResult: null,
                analysisError: null,
            })
        }
        return undefined
    }

    if (message.type === "REQUEST_GEMINI_ANALYSIS" && typeof message.tabId === "number") {
        const tabId = message.tabId
        const state = detectionState.get(tabId) ?? createDefaultState()
        if (!state.extractionResult) {
            sendResponse?.({started: false, error: "No extracted text available."})
            return false
        }
        if (state.analysisStatus === "pending") {
            sendResponse?.({started: false, status: "pending"})
            return false
        }
        if (state.analysisStatus === "success") {
            sendResponse?.({started: false, status: "success"})
            return false
        }
        updateDetectionState(tabId, {
            analysisStatus: "pending",
            analysisResult: null,
            analysisError: null,
        })
        scheduleTask(() => runGeminiAnalysis(tabId))
        sendResponse?.({started: true, status: "pending"})
        return false
    }

    if (message.type === "RESET_TAB_STATE" && typeof message.tabId === "number") {
        resetDetectionWorkflow(message.tabId)
        sendResponse?.({ok: true})
        return false
    }

    return undefined
})

// Clean up detection data when a tab reloads or closes.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
        cancelAnalysisForTab(tabId)
        detectionState.delete(tabId)
    }
})

chrome.tabs.onRemoved.addListener((tabId) => {
    cancelAnalysisForTab(tabId)
    detectionState.delete(tabId)
})

/**
 * @typedef {Object} DetectionState
 * @property {boolean} detected
 * @property {number} score
 * @property {string[]} matchedUrlKeywords
 * @property {string[]} matchedContentKeywords
 * @property {string[]} matchedActionKeywords
 * @property {number|null} lastUpdated
 * @property {"accepted"|"declined"|null} consent
 * @property {"idle"|"pending"|"success"|"error"} extractionStatus
 * @property {ExtractionResult|null} extractionResult
 * @property {string|null} extractionError
 * @property {"idle"|"pending"|"success"|"error"} analysisStatus
 * @property {LegalAnalysisResult|null} analysisResult
 * @property {string|null} analysisError
 */

/**
 * @typedef {Object} ExtractionResult
 * @property {string} text
 * @property {number} char_count
 * @property {string} source_url
 */

/**
 * @typedef {Object} LegalAnalysisResult
 * @property {string} summary
 * @property {{overall:number, finalLevel:string, breakdown:{data_collection:number,data_sharing:number,user_control:number,data_longevity:number,legal_integrity:number}}} scores
 * @property {{data_collection:string,data_sharing:string,user_control:string,data_longevity:string,legal_integrity:string}} justifications
 */

function startExtractionForTab(tabId) {
    cancelAnalysisForTab(tabId)
    updateDetectionState(tabId, {
        extractionStatus: "pending",
        extractionResult: null,
        extractionError: null,
        analysisStatus: "idle",
        analysisResult: null,
        analysisError: null,
    })
    chrome.tabs.sendMessage(tabId, {type: "START_LEGAL_TEXT_EXTRACTION"}, (response) => {
        if (chrome.runtime.lastError) {
            updateDetectionState(tabId, {
                extractionStatus: "error",
                extractionError: "Unable to start extraction on this tab.",
                analysisStatus: "idle",
            })
            return
        }
        if (response && response.started === false) {
            updateDetectionState(tabId, {
                extractionStatus: "error",
                extractionError: "Extraction already running.",
                analysisStatus: "idle",
            })
        }
    })
}

function serializeStateForResponse(state) {
    const {extractionResult, ...rest} = state
    const extractionMetadata = extractionResult ? {
        charCount: extractionResult.char_count,
        sourceUrl: extractionResult.source_url,
    } : null
    return {
        ...rest,
        extractionMetadata,
    }
}

function cancelAnalysisForTab(tabId) {
    const controller = analysisControllers.get(tabId)
    if (controller) {
        controller.abort()
        analysisControllers.delete(tabId)
    }
}

async function runGeminiAnalysis(tabId) {
    const state = detectionState.get(tabId)
    if (!state) {
        return
    }
    const extraction = state?.extractionResult
    if (!extraction?.text) {
        updateDetectionState(tabId, {
            analysisStatus: "error",
            analysisResult: null,
            analysisError: "No extracted text available for analysis.",
        })
        return
    }

    const controller = new AbortController()
    analysisControllers.set(tabId, controller)

    try {
        const apiKey = await getGeminiApiKey()
        if (!apiKey) {
            throw createApiKeyIssue("Add your Gemini API key in the popup to enable AI analysis.", "missing")
        }

        const prompt = buildGeminiPrompt(extraction)
        const rawText = await requestGeminiAnalysis(apiKey, prompt, controller.signal)
        const parsed = parseGeminiJson(rawText)
        const normalized = normalizeAnalysisPayload(parsed)

        updateDetectionState(tabId, {
            analysisStatus: "success",
            analysisResult: normalized,
            analysisError: null,
        })
    } catch (error) {
        if (controller.signal.aborted) {
            return
        }
        let message = error instanceof Error ? error.message : "Unable to analyze legal text."
        if (error?.apiKeyIssue === "invalid") {
            await resetStoredGeminiKey("Gemini rejected the stored API key. Please Reset the API Key.")
            resetDetectionWorkflow(tabId)
            message = "Gemini rejected the stored API key. Please Reset the API Key."
        } else if (error?.apiKeyIssue === "missing") {
            message = "Add your Gemini API key in the popup to enable AI analysis."
        }
        updateDetectionState(tabId, {
            analysisStatus: "error",
            analysisResult: null,
            analysisError: message,
        })
    } finally {
        if (analysisControllers.get(tabId) === controller) {
            analysisControllers.delete(tabId)
        }
    }
}

async function getGeminiApiKey() {
    const data = await readFromStorage(["geminiApiKey"])
    const key = typeof data?.geminiApiKey === "string" ? data.geminiApiKey.trim() : ""
    return key || null
}

async function requestGeminiAnalysis(apiKey, prompt, signal) {
    const response = await fetch(GEMINI_API_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
            contents: [{
                role: "user",
                parts: [{text: prompt}],
            }],
            generationConfig: {
                temperature: 0,
                topK: 1,
                topP: 0.1,
                maxOutputTokens: 8192,
            },
        }),
        signal,
    })

    if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}))
        let message = errorPayload?.error?.message || `Gemini API error (${response.status})`
        const error = new Error(message)
        if (response.status === 401 || response.status === 403) {
            message = "API key not valid. Please Reset the API Key."
            error.message = message
            error.apiKeyIssue = "invalid"
        }
        throw error
    }

    const payload = await response.json()
    return extractGeminiText(payload)
}

function buildGeminiPrompt(extraction) {
    const sourceLine = extraction.source_url ? `Document source URL: ${extraction.source_url}` : "Document source URL: unavailable"
    const text = extraction.text || ""
    const trimmed = text.length > MAX_GEMINI_INPUT_CHARS ? `${text.slice(0, MAX_GEMINI_INPUT_CHARS)}\n[TRUNCATED]` : text
    return `${GEMINI_PROMPT}

${sourceLine}
Document text is delimited by <document> tags.
<document>
${trimmed}
</document>`
}

function extractGeminiText(payload) {
    const candidates = payload?.candidates
    if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error("Gemini response did not include any candidates.")
    }
    for (const candidate of candidates) {
        const parts = candidate?.content?.parts
        if (!Array.isArray(parts)) {
            continue
        }
        const textParts = parts
            .map((part) => typeof part?.text === "string" ? part.text : "")
            .filter((part) => part.trim().length > 0)
        if (textParts.length > 0) {
            return textParts.join("\n").trim()
        }
    }
    throw new Error("Gemini returned an empty response.")
}

function parseGeminiJson(text) {
    if (typeof text !== "string") {
        throw new Error("Gemini response payload was not text.")
    }
    let trimmed = text.trim()
    if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
        const stripped = trimmed.slice(3, -3).trim()
        const newlineIndex = stripped.indexOf("\n")
        trimmed = newlineIndex === -1 ? stripped : stripped.slice(newlineIndex + 1)
    }

    const directParse = safeParseJson(trimmed)
    if (directParse) {
        return directParse
    }

    const firstBrace = trimmed.indexOf("{")
    const lastBrace = trimmed.lastIndexOf("}")
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const sliced = trimmed.slice(firstBrace, lastBrace + 1)
        const slicedParse = safeParseJson(sliced)
        if (slicedParse) {
            return slicedParse
        }
    }

    throw new Error("Gemini response was not valid JSON.")
}

function safeParseJson(text) {
    try {
        return JSON.parse(text)
    } catch (error) {
        return null
    }
}

function normalizeAnalysisPayload(payload) {
    if (!payload || typeof payload !== "object") {
        throw new Error("Gemini analysis payload missing.")
    }
    const summary = typeof payload.summary === "string" ? payload.summary.trim() : ""
    if (!summary) {
        throw new Error("Gemini response missing summary.")
    }
    const scoresBlock = payload.scores
    if (!scoresBlock || typeof scoresBlock !== "object") {
        throw new Error("Gemini response missing scores.")
    }

    const overall = clampScore(Number(scoresBlock.overall))
    if (!Number.isFinite(overall)) {
        throw new Error("Gemini overall score invalid.")
    }
    const finalLevel = typeof scoresBlock.final_level === "string" ? scoresBlock.final_level.trim() : deriveSafetyLevel(overall)

    const breakdownSource = typeof scoresBlock.breakdown === "object" && scoresBlock.breakdown !== null ? scoresBlock.breakdown : {}
    const justificationSource = typeof payload.justifications === "object" && payload.justifications !== null ? payload.justifications : {}
    const categoryKeys = ["data_collection", "data_sharing", "user_control", "data_longevity", "legal_integrity"]
    const normalizedBreakdown = {}
    const normalizedJustifications = {}
    const missingMessage = "Gemini did not provide a justification for this category."
    for (const key of categoryKeys) {
        const value = Number(breakdownSource[key])
        if (!Number.isFinite(value)) {
            throw new Error(`Gemini breakdown score for ${key} is invalid.`)
        }
        normalizedBreakdown[key] = clampScore(value)

        const justification = typeof justificationSource[key] === "string" ? justificationSource[key].trim() : ""
        normalizedJustifications[key] = justification || missingMessage
    }

    return {
        summary,
        scores: {
            overall,
            finalLevel: finalLevel || deriveSafetyLevel(overall),
            breakdown: normalizedBreakdown,
        },
        justifications: normalizedJustifications,
    }
}

function clampScore(value) {
    return Math.min(100, Math.max(0, Math.round(value)))
}

function deriveSafetyLevel(score) {
    if (score >= 80) {
        return "Level 5 (Predatory)"
    }
    if (score >= 60) {
        return "Level 4 (High Risk)"
    }
    if (score >= 40) {
        return "Level 3 (Moderate Risk)"
    }
    if (score >= 20) {
        return "Level 2 (Low Risk)"
    }
    return "Level 1 (Safe)"
}

function createApiKeyIssue(message, reason) {
    const error = new Error(message)
    error.apiKeyIssue = reason
    return error
}

async function resetStoredGeminiKey(statusMessage) {
    if (statusMessage) {
        await writeToStorage({geminiApiKeyStatus: statusMessage})
    }
    await removeFromStorage(["geminiApiKey"])
}

function readFromStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (items) => {
            if (chrome.runtime.lastError) {
                console.warn("Storage read failed", chrome.runtime.lastError)
                resolve({})
                return
            }
            resolve(items || {})
        })
    })
}

function writeToStorage(values) {
    return new Promise((resolve) => {
        chrome.storage.local.set(values, () => {
            if (chrome.runtime.lastError) {
                console.warn("Storage write failed", chrome.runtime.lastError)
            }
            resolve()
        })
    })
}

function removeFromStorage(keys) {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    return new Promise((resolve) => {
        chrome.storage.local.remove(keyArray, () => {
            if (chrome.runtime.lastError) {
                console.warn("Storage remove failed", chrome.runtime.lastError)
            }
            resolve()
        })
    })
}

function resetDetectionWorkflow(tabId) {
    cancelAnalysisForTab(tabId)
    const existing = detectionState.get(tabId)
    if (!existing) {
        detectionState.delete(tabId)
        return
    }
    const nextState = {
        ...existing,
        consent: null,
        extractionStatus: "idle",
        extractionResult: null,
        extractionError: null,
        analysisStatus: "idle",
        analysisResult: null,
        analysisError: null,
        lastUpdated: Date.now(),
    }
    detectionState.set(tabId, nextState)
}
