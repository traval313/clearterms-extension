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
const GEMINI_PROMPT = `Act as a Consumer Protection Advocate and Data Auditor. Your goal is to analyze the provided legal text (Privacy Policy or Terms of Service) and generate a structured \"Privacy Nutritional Label\" in JSON format.
Core Instructions
Deterministic Scoring: Assign scores strictly based on the rubric.
Worst-Case Rule: If multiple triggers exist within one category, assign the highest (worst) score detected.
Neutral Default: If a section is missing or only contains vague \"General Privacy Language,\" assign Level 3 (50 pts).
Purpose Alignment: Evaluate if the data practice is \"reasonable\" for the service type (e.g., a map app needing location vs. a calculator app needing location). Note this in the justification without changing the numeric score.
Fixed Values: You may ONLY use the scores: 5, 25, 50, 75, or 100.

Scoring Rubric
1. Data Collection (25%)
5 (Minimal): Strictly necessary (e.g., \"only collect email for account creation\").
25 (Functional): Basic technical data (e.g., \"crash logs,\" \"error reports,\" \"essential cookies\").
50 (Commercial): Standard tracking (e.g., \"IP address,\" \"Device ID,\" \"Analytics,\" \"Usage data\").
75 (Aggressive): High-detail tracking (e.g., \"Precise GPS,\" \"Cross-site tracking,\" \"Third-party data enrichment\").
100 (Invasive): Sensitive access (e.g., \"Biometrics,\" \"Contacts,\" \"Microphone,\" \"Keystrokes,\" \"Health data\").
2. Data Sharing (25%)
5 (None): Explicit \"Do not sell/share\" or \"End-to-end encrypted/Zero-knowledge.\"
25 (Service Providers): Sharing only with necessary vendors (e.g., \"payment processors,\" \"hosting\").
50 (Corporate): Sharing with \"Affiliates,\" \"Subsidiaries,\" or \"Parent companies.\"
75 (Third Parties): Sharing with \"Marketing partners,\" \"Ad networks,\" or \"Strategic partners.\"
100 (Monetization): \"Sell data,\" \"Data brokers,\" or \"Disclaimed liability for third-party use.\"
3. User Control (20%)
5 (Proactive): Opt-in required for tracking; self-service \"Delete Account\" button.
25 (Accessible): Clear \"Opt-out\" links or \"Do Not Sell\" buttons; easy GDPR/CCPA forms.
50 (Manual): Must email support or submit a manual request to exercise rights.
75 (Limited): Rights limited to specific regions (e.g., \"CA/EU residents only\") or high verification barriers.
100 (None): Automatic consent via use; no mention of deletion; \"Mandatory\" collection.
4. Data Longevity (15%)
5 (Minimal): Defined short-term deletion (e.g., \"deleted after 30 days\" or \"session-only\").
25 (Linked): Data deleted automatically upon account closure.
50 (Standard): Retained \"as long as necessary for business purposes\" (vague but standard).
75 (Indefinite): \"Legitimate interests\" with no timeframe; retained in \"backups\" indefinitely.
100 (Permanent): \"Perpetual,\" \"Irrevocable,\" or \"Forever\" retention/licensing.
5. Legal Integrity (15%)
5 (Fair): No mandatory arbitration; users retain full ownership of content.
25 (Balanced): Optional arbitration; small claims court preserved.
50 (Standard): Binding arbitration included but provides a clear opt-out window (e.g., 30 days).
75 (Unfriendly): Mandatory arbitration with NO opt-out; Class Action waiver included.
100 (Rights-Stripping): \"Triple Threat\" (Mandatory Arbitration + Class Action Waiver + Jury Trial Waiver).
**Reasonable Collection Alignments:**
- Health app collecting health data (IF properly secured and not sold)
- Photo app requesting camera access
- Navigation app using location services
- Messaging app collecting contact lists for friend-finding (IF opt-in)
- Cloud storage retaining data \"as long as account active\"


**Misalignments (Flag in Justification):**
- Flashlight app requiring contact list access
- Calculator app tracking cross-site browsing
- E-reader claiming perpetual license to user notes
- Meditation app selling health data to advertisers
- News site requiring biometric authentication

Output Format (Strict JSON)
Return ONLY valid JSON. Do not include markdown headers or conversational filler. Always escape embedded double quotes inside strings as \". Begin the response with { and end with }.
JSON
{
  \"summary\": \"2-3 sentence neutral summary of the document's overall stance.\",
  \"category_scores\": {
    \"data_collection\": 0,
    \"data_sharing\": 0,
    \"user_control\": 0,
    \"data_longevity\": 0,
    \"legal_integrity\": 0
  },
  \"justifications\": {
    \"data_collection\": \"2-3 sentences. Quote the trigger. State if it aligns with product purpose.\",
    \"data_sharing\": \"2-3 sentences. Quote the trigger. State if it aligns with product purpose.\",
    \"user_control\": \"2-3 sentences. Quote the trigger. Note if process is automated or manual.\",
    \"data_longevity\": \"2-3 sentences. Quote the trigger. Explain the retention timeframe.\",
    \"legal_integrity\": \"2-3 sentences. Quote the trigger. Identify specific rights waived.\"
  }
}

Final Reminders: Use exact rubric values. Quote the text verbatim. If data is missing, state \"Information not provided in text.\"`


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
 * @property {{overall:number, finalLevel:string, riskLabel?:string, riskDetail?:string, breakdown:{data_collection:number,data_sharing:number,user_control:number,data_longevity:number,legal_integrity:number}}} scores
 * @property {{data_collection:number,data_sharing:number,user_control:number,data_longevity:number,legal_integrity:number}} category_scores
 * @property {number} final_score
 * @property {string} overall_risk_level
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
    let trimmed = normalizeJsonishText(text.trim())
    if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
        const stripped = trimmed.slice(3, -3).trim()
        const newlineIndex = stripped.indexOf("\n")
        const sanitized = normalizeJsonishText(newlineIndex === -1 ? stripped : stripped.slice(newlineIndex + 1))
        trimmed = sanitized
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

function normalizeJsonishText(value) {
    if (typeof value !== "string" || value.length === 0) {
        return value
    }
    return value
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u00a0/g, " ")
}

function normalizeAnalysisPayload(payload) {
    if (!payload || typeof payload !== "object") {
        throw new Error("Gemini analysis payload missing.")
    }
    const summary = typeof payload.summary === "string" ? payload.summary.trim() : ""
    if (!summary) {
        throw new Error("Gemini response missing summary.")
    }
    const breakdownSource = typeof payload.category_scores === "object" && payload.category_scores !== null ? payload.category_scores : {}
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

    const overall = computeWeightedScore(normalizedBreakdown)
    const riskInfo = describeRiskLevel(overall)
    const breakdownCopy = {...normalizedBreakdown}
    const finalLevelLabel = `Level ${riskInfo.level} (${riskInfo.label})`
    const overallRiskLabel = riskInfo.detail ? `${riskInfo.label} (${riskInfo.detail})` : riskInfo.label

    return {
        summary,
        scores: {
            overall,
            finalLevel: finalLevelLabel,
            riskLabel: riskInfo.label,
            riskDetail: riskInfo.detail,
            breakdown: breakdownCopy,
        },
        justifications: normalizedJustifications,
        category_scores: breakdownCopy,
        final_score: overall,
        overall_risk_level: overallRiskLabel,
    }
}

function clampScore(value) {
    return Math.min(100, Math.max(0, Math.round(value)))
}

function computeWeightedScore(breakdown) {
    const collection = Number(breakdown.data_collection) || 0
    const sharing = Number(breakdown.data_sharing) || 0
    const control = Number(breakdown.user_control) || 0
    const longevity = Number(breakdown.data_longevity) || 0
    const legal = Number(breakdown.legal_integrity) || 0
    const total = (collection * 0.25) + (sharing * 0.25) + (control * 0.20) + (longevity * 0.15) + (legal * 0.15)
    return Math.round(total)
}

const RISK_LEVELS = [
    {min: 80, level: 5, label: "Dangerous", detail: "Very high risk"},
    {min: 60, level: 4, label: "Risky", detail: "High risk"},
    {min: 40, level: 3, label: "Concerning", detail: "Moderate risk"},
    {min: 20, level: 2, label: "Acceptable", detail: "Low risk"},
    {min: 0, level: 1, label: "Exemplary", detail: "Very low risk"},
]

function describeRiskLevel(score) {
    const value = clampScore(score)
    for (const band of RISK_LEVELS) {
        if (value >= band.min) {
            return band
        }
    }
    return RISK_LEVELS[RISK_LEVELS.length - 1]
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
