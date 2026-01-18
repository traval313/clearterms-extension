"use strict"

/**
 * Stores detection and consent data keyed by tab id.
 * @type {Map<number, DetectionState>}
 */
const detectionState = new Map()

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
            ...(consent === "declined" ? {
                extractionStatus: "idle",
                extractionResult: null,
                extractionError: null,
            } : {}),
        })
        if (consent === "accepted") {
            startExtractionForTab(tabId)
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
            })
        } else {
            updateDetectionState(tabId, {
                extractionStatus: "error",
                extractionResult: null,
                extractionError: payload.error || "Extraction failed.",
            })
        }
        return undefined
    }

    if (message.type === "GET_LEGAL_TEXT_RESULT" && typeof message.tabId === "number") {
        const state = detectionState.get(message.tabId) ?? createDefaultState()
        sendResponse(state.extractionResult)
        return true
    }

    return undefined
})

// Clean up detection data when a tab reloads or closes.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
        detectionState.delete(tabId)
    }
})

chrome.tabs.onRemoved.addListener((tabId) => {
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
 */

/**
 * @typedef {Object} ExtractionResult
 * @property {string} text
 * @property {number} char_count
 * @property {string} source_url
 */

function startExtractionForTab(tabId) {
    updateDetectionState(tabId, {
        extractionStatus: "pending",
        extractionResult: null,
        extractionError: null,
    })
    chrome.tabs.sendMessage(tabId, {type: "START_LEGAL_TEXT_EXTRACTION"}, (response) => {
        if (chrome.runtime.lastError) {
            updateDetectionState(tabId, {
                extractionStatus: "error",
                extractionError: "Unable to start extraction on this tab.",
            })
            return
        }
        if (response && response.started === false) {
            updateDetectionState(tabId, {
                extractionStatus: "error",
                extractionError: "Extraction already running.",
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
