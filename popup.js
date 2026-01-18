"use strict"

let activeTabId = null
let currentState = null
let pollingHandle = null
let analysisKickoffRequested = false

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
const analysisState = document.getElementById("analysisState")
const analysisHeadline = document.getElementById("analysisHeadline")
const analysisSubhead = document.getElementById("analysisSubhead")
const analysisSummaryBlock = document.getElementById("analysisSummaryBlock")
const analysisSummary = document.getElementById("analysisSummary")
const analysisScores = document.getElementById("analysisScores")
const analysisConfidence = document.getElementById("analysisConfidence")
const analysisRawBlock = document.getElementById("analysisRawBlock")
const analysisRaw = document.getElementById("analysisRaw")

const SCORE_LABELS = {
    overall: "Overall risk",
    data_collection: "Data collection",
    data_sharing: "Data sharing",
    user_control: "User control",
    data_longevity: "Data longevity",
    legal_integrity: "Legal integrity",
}

const SCORE_BANDS = [
    {min: 90, label: "Exemplary"},
    {min: 70, label: "User-friendly"},
    {min: 40, label: "Caution"},
    {min: 20, label: "High risk"},
    {min: 0, label: "Predatory"},
]

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
        extractionError: null,
        analysisStatus: "idle",
        analysisResult: null,
        analysisError: null,
        analysisRawResponse: null,
    }
    setBadge(currentState)
    updatePanels(currentState)
    updateReasons(currentState)
    updateExtractionPanel(currentState)
    updateAnalysisPanel(currentState)
    maybeRequestAnalysis(currentState)
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
    acceptedState.classList.toggle("panel--error", status === "error")
}

function updateAnalysisPanel(state) {
    if (!analysisState || !analysisHeadline || !analysisSubhead || !analysisSummaryBlock || !analysisSummary || !analysisScores || !analysisConfidence || !analysisRawBlock || !analysisRaw) {
        return
    }
    const hasConsent = state.consent === "accepted"
    analysisState.classList.toggle("hidden", !hasConsent)
    if (!hasConsent) {
        analysisState.classList.remove("panel--error")
        return
    }

    const status = state.analysisStatus || "idle"
    const result = state.analysisResult || null
    let headline = "Waiting for analysis"
    let subhead = "We’ll run Gemini as soon as the capture finishes."
    let showSummary = false
    let showScores = false
    let showConfidence = false
    let showRaw = false

    analysisSummary.textContent = ""
    analysisScores.innerHTML = ""
    analysisConfidence.textContent = ""
    analysisRaw.textContent = ""

    analysisState.classList.toggle("panel--error", status === "error")

    switch (status) {
    case "pending":
        headline = "Analyzing legal text…"
        subhead = "Gemini is evaluating the extracted agreement."
        break
    case "success":
        if (result) {
            headline = "Key takeaways"
            subhead = "Summarized strictly from the captured document."
            analysisSummary.textContent = result.summary
            showSummary = true
            showScores = renderScoreCards(result.scores)
        }
        if (state.analysisRawResponse) {
            analysisRaw.textContent = state.analysisRawResponse
            showRaw = true
        }
        break
    case "error":
        headline = "Analysis unavailable"
        subhead = state.analysisError || "Gemini could not analyze this document."
        if (state.analysisRawResponse) {
            analysisRaw.textContent = state.analysisRawResponse
            showRaw = true
        }
        break
    default:
        if (state.extractionStatus === "pending") {
            subhead = "We’ll start once the capture is done."
        } else if (state.extractionStatus === "error") {
            headline = "Analysis blocked"
            subhead = "We need a successful capture before Gemini can help."
        }
        break
    }

    analysisHeadline.textContent = headline
    analysisSubhead.textContent = subhead
    analysisSummaryBlock.classList.toggle("hidden", !showSummary)
    analysisScores.classList.toggle("hidden", !showScores)
    analysisConfidence.classList.toggle("hidden", !showConfidence)
    analysisRawBlock.classList.toggle("hidden", !showRaw)
}

function renderScoreCards(scoreData) {
    if (!scoreData || typeof scoreData !== "object" || !analysisScores) {
        return false
    }
    const breakdown = scoreData.breakdown && typeof scoreData.breakdown === "object" ? scoreData.breakdown : {}
    let rendered = false

    if (Number.isFinite(scoreData.overall)) {
        rendered = true
        const overallCard = document.createElement("div")
        overallCard.className = "scoreCard scoreCard--overall"

        const label = document.createElement("p")
        label.className = "scoreCard__label"
        label.textContent = SCORE_LABELS.overall

        const value = document.createElement("p")
        value.className = "scoreCard__value"
        value.textContent = String(Math.round(scoreData.overall))

        const band = document.createElement("p")
        band.className = "scoreCard__tag"
        band.textContent = scoreData.finalLevel || describeScoreBand(scoreData.overall)

        overallCard.append(label, value, band)
        analysisScores.appendChild(overallCard)
    }

    const order = ["data_collection", "data_sharing", "user_control", "data_longevity", "legal_integrity"]
    order.forEach((key) => {
        const raw = Number(breakdown[key])
        if (!Number.isFinite(raw)) {
            return
        }
        rendered = true
        const card = document.createElement("div")
        card.className = "scoreCard"

        const label = document.createElement("p")
        label.className = "scoreCard__label"
        label.textContent = SCORE_LABELS[key] || key

        const value = document.createElement("p")
        value.className = "scoreCard__value"
        value.textContent = String(Math.round(raw))

        const band = document.createElement("p")
        band.className = "scoreCard__tag"
        band.textContent = describeScoreBand(raw)

        card.append(label, value, band)
        analysisScores.appendChild(card)
    })
    return rendered
}

function describeScoreBand(score) {
    for (const band of SCORE_BANDS) {
        if (score >= band.min) {
            return band.label
        }
    }
    return ""
}

function maybeRequestAnalysis(state) {
    if (state.consent !== "accepted") {
        analysisKickoffRequested = false
        return
    }
    if (state.extractionStatus !== "success") {
        analysisKickoffRequested = false
        return
    }
    const status = state.analysisStatus || "idle"
    if (status === "idle" && !analysisKickoffRequested) {
        requestGeminiAnalysis()
        return
    }
    if (status === "pending" || status === "success" || status === "error") {
        analysisKickoffRequested = true
    }
}

function requestGeminiAnalysis() {
    if (typeof activeTabId !== "number") {
        return
    }
    analysisKickoffRequested = true
    chrome.runtime.sendMessage({
        type: "REQUEST_GEMINI_ANALYSIS",
        tabId: activeTabId,
    }, (response) => {
        if (chrome.runtime.lastError) {
            analysisKickoffRequested = false
            console.warn("Unable to request Gemini analysis", chrome.runtime.lastError)
            return
        }
        if (response?.error) {
            analysisKickoffRequested = false
            console.warn("Gemini analysis request failed:", response.error)
            return
        }
        requestStateRefreshSoon()
    })
}

function syncPolling(state) {
    const needsPolling = state.consent === "accepted" && (state.extractionStatus === "pending" || state.analysisStatus === "pending")
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
