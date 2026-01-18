"use strict"

let activeTabId = null
let currentState = null
let extractionResult = null
let pollingHandle = null

const detectionBadge = document.getElementById("detectionBadge")
const legalState = document.getElementById("legalState")
const neutralState = document.getElementById("neutralState")
const acceptedState = document.getElementById("acceptedState")
const declinedState = document.getElementById("declinedState")
const detectionReasons = document.getElementById("detectionReasons")
const consentMessage = document.getElementById("consentMessage")
const consentYes = document.getElementById("consentYes")
const consentNo = document.getElementById("consentNo")
const extractionHeadline = document.getElementById("extractionHeadline")
const extractionSubhead = document.getElementById("extractionSubhead")
const extractionDetails = document.getElementById("extractionDetails")
const extractionUrl = document.getElementById("extractionUrl")
const extractionChars = document.getElementById("extractionChars")

const CHAR_FORMAT = new Intl.NumberFormat()

consentYes.addEventListener("click", () => submitConsent("accepted"))
consentNo.addEventListener("click", () => submitConsent("declined"))

document.addEventListener("DOMContentLoaded", () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (!tabs || tabs.length === 0) {
            renderState(null)
            return
        }
        activeTabId = tabs[0].id ?? null
        fetchDetectionState()
    })
})

function fetchDetectionState() {
    if (typeof activeTabId !== "number") {
        renderState(null)
        return
    }
    chrome.runtime.sendMessage({
        type: "GET_DETECTION_STATE",
        tabId: activeTabId,
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn("Unable to fetch detection state", chrome.runtime.lastError)
            renderState(null)
            return
        }
        renderState(response)
    })
}

function submitConsent(choice) {
    if (typeof activeTabId !== "number") {
        return
    }
    chrome.runtime.sendMessage({
        type: "USER_CONSENT_RESPONSE",
        tabId: activeTabId,
        response: choice,
    }, () => chrome.runtime.lastError && console.debug(chrome.runtime.lastError))

    const optimistic = {
        ...currentState,
        consent: choice,
        extractionStatus: choice === "accepted" ? "pending" : "idle",
        extractionMetadata: null,
        extractionError: null,
    }
    renderState(optimistic)
    if (choice === "accepted") {
        requestStateRefreshSoon()
    }
}

function renderState(state) {
    currentState = state ?? {
        detected: false,
        matchedUrlKeywords: [],
        matchedContentKeywords: [],
        matchedActionKeywords: [],
        consent: null,
        extractionStatus: "idle",
        extractionMetadata: null,
        extractionError: null,
    }
    setBadge(currentState)
    updatePanels(currentState)
    updateReasons(currentState)
    updateExtractionPanel(currentState)
    handleExtractionResultFetch(currentState)
    syncPolling(currentState)
}

function setBadge(state) {
    let label = "Idle"
    if (state.detected && !state.consent) {
        label = "Legal page detected"
    } else if (state.consent === "accepted") {
        label = state.extractionStatus === "success" ? "Legal text ready" : state.extractionStatus === "pending" ? "Extracting…" : "Legal page"
    } else if (state.detected) {
        label = "Legal page"
    }
    detectionBadge.textContent = label
    detectionBadge.classList.toggle("badge--highlight", state.detected)
    detectionBadge.classList.toggle("badge--neutral", !state.detected)
}

function updatePanels(state) {
    const showPrompt = state.detected && !state.consent
    legalState.classList.toggle("hidden", !showPrompt)
    neutralState.classList.toggle("hidden", state.detected)
    acceptedState.classList.toggle("hidden", state.consent !== "accepted")
    declinedState.classList.toggle("hidden", state.consent !== "declined")

    if (state.consent === "declined") {
        consentMessage.textContent = "No problem. We won’t analyze this page until you’re ready."
    }
}

function updateReasons(state) {
    detectionReasons.innerHTML = ""
    if (!state.detected) {
        return
    }
    const items = []
    if (state.matchedUrlKeywords?.length) {
        items.push(`URL keywords: ${state.matchedUrlKeywords.join(", ")}`)
    }
    if (state.matchedContentKeywords?.length) {
        items.push(`On-page text mentions: ${state.matchedContentKeywords.join(", ")}`)
    }
    if (state.matchedActionKeywords?.length) {
        items.push(`Buttons include: ${state.matchedActionKeywords.join(", ")}`)
    }
    if (items.length === 0) {
        items.push("Detected using heuristic signals.")
    }
    items.forEach((text) => {
        const li = document.createElement("li")
        li.textContent = text
        detectionReasons.appendChild(li)
    })
}

function updateExtractionPanel(state) {
    if (!acceptedState) {
        return
    }
    const status = state.extractionStatus || "idle"
    let headline = "Waiting for extraction"
    let subhead = "We’ll start analyzing this page right after you grant consent."

    if (state.consent !== "accepted") {
        acceptedState.classList.add("hidden")
        acceptedState.classList.remove("panel--error")
        return
    }

    switch (status) {
    case "pending":
        headline = "Extracting legal text…"
        subhead = "Hang tight while we capture the visible sections of this page."
        break
    case "success":
        headline = "Legal text ready for analysis"
        subhead = "We captured the page contents and will pass them to analysis next."
        break
    case "error":
        headline = "We couldn’t extract this page"
        subhead = state.extractionError || "Try reloading the page and approving again."
        break
    default:
        headline = "Awaiting extraction"
        subhead = "We’ll start as soon as this page finishes loading."
    }

    extractionHeadline.textContent = headline
    extractionSubhead.textContent = subhead

    const metadata = getExtractionMetadata(state)
    const hasMetadata = !!metadata && status === "success"
    extractionDetails.classList.toggle("hidden", !hasMetadata)
    acceptedState.classList.toggle("panel--error", status === "error")
    if (hasMetadata) {
        extractionUrl.textContent = metadata.sourceUrl || "—"
        extractionUrl.title = metadata.sourceUrl || ""
        extractionChars.textContent = typeof metadata.charCount === "number" ? CHAR_FORMAT.format(metadata.charCount) : "—"
    }
}

function getExtractionMetadata(state) {
    if (extractionResult) {
        return {
            charCount: extractionResult.char_count,
            sourceUrl: extractionResult.source_url,
        }
    }
    return state.extractionMetadata || null
}

function handleExtractionResultFetch(state) {
    if (state.consent !== "accepted") {
        extractionResult = null
        return
    }
    if (state.extractionStatus === "success" && !extractionResult) {
        fetchExtractionResult()
    }
    if (state.extractionStatus !== "success") {
        extractionResult = null
    }
}

function fetchExtractionResult() {
    if (typeof activeTabId !== "number") {
        return
    }
    chrome.runtime.sendMessage({
        type: "GET_LEGAL_TEXT_RESULT",
        tabId: activeTabId,
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn("Unable to fetch extraction result", chrome.runtime.lastError)
            return
        }
        extractionResult = response || null
        updateExtractionPanel(currentState)
    })
}

function syncPolling(state) {
    const needsPolling = state.consent === "accepted" && state.extractionStatus === "pending"
    if (needsPolling && !pollingHandle) {
        pollingHandle = setTimeout(() => {
            pollingHandle = null
            fetchDetectionState()
        }, 1500)
    }
    if (!needsPolling && pollingHandle) {
        clearTimeout(pollingHandle)
        pollingHandle = null
    }
}

function requestStateRefreshSoon() {
    setTimeout(() => {
        if (!pollingHandle) {
            fetchDetectionState()
        }
    }, 200)
}
