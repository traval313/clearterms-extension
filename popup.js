"use strict"

let activeTabId = null
let currentState = null
let pollingHandle = null
let analysisKickoffRequested = false
let currentAnalysisView = "meter"
let hasBreakdownData = false
let hasSummaryData = false
let hasMeterData = false

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
const analysisContent = document.getElementById("analysisContent")
const analysisMeterView = document.getElementById("analysisMeterView")
const analysisMeterInteractive = document.getElementById("analysisMeterInteractive")
const analysisBreakdownView = document.getElementById("analysisBreakdownView")
const analysisBreakdownGrid = document.getElementById("analysisBreakdownGrid")
const analysisSummaryView = document.getElementById("analysisSummaryView")
const analysisSummary = document.getElementById("analysisSummary")
const analysisSummaryButton = document.getElementById("analysisSummaryButton")
const analysisBackButton = document.getElementById("analysisBackButton")
const riskMeterNeedle = document.getElementById("riskMeterNeedle")
const riskMeterScore = document.getElementById("riskMeterScore")
const riskMeterLabel = document.getElementById("riskMeterLabel")
const riskMeterHint = document.getElementById("riskMeterHint")

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

if (analysisMeterInteractive) {
    analysisMeterInteractive.addEventListener("click", handleMeterActivate)
    analysisMeterInteractive.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault()
            handleMeterActivate()
        }
    })
}

analysisSummaryButton?.addEventListener("click", () => {
    if (!hasSummaryData) {
        return
    }
    setAnalysisView("summary")
    scrollAnalysisViewIntoFocus(analysisSummaryView)
})

analysisBackButton?.addEventListener("click", () => setAnalysisView("meter"))

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
    if (!analysisState || !analysisHeadline || !analysisSubhead || !analysisContent || !analysisSummary) {
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

    analysisSummary.textContent = ""
    if (analysisBreakdownGrid) {
        analysisBreakdownGrid.innerHTML = ""
    }

    hasBreakdownData = false
    hasSummaryData = false
    hasMeterData = false
    analysisContent.classList.add("hidden")
    analysisMeterView?.classList.add("is-disabled")
    analysisMeterInteractive?.setAttribute("aria-disabled", "true")
    analysisMeterInteractive?.setAttribute("tabindex", "-1")
    riskMeterHint?.classList.add("is-muted")
    riskMeterScore && (riskMeterScore.textContent = "--")
    riskMeterLabel && (riskMeterLabel.textContent = "Awaiting")
    riskMeterNeedle?.style.setProperty("--needle-rotation", "-90deg")
    analysisSummaryButton && (analysisSummaryButton.disabled = true)
    setAnalysisView("meter")

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
            hasSummaryData = Boolean(result.summary && result.summary.trim().length)
            if (hasSummaryData) {
                analysisSummary.textContent = result.summary.trim()
            }
            hasMeterData = updateRiskMeter(result.scores)
            hasBreakdownData = renderBreakdownGrid(result.scores)
            analysisSummaryButton && (analysisSummaryButton.disabled = !hasSummaryData)
            analysisMeterView?.classList.toggle("is-disabled", !hasBreakdownData)
            if (analysisMeterInteractive) {
                analysisMeterInteractive.setAttribute("aria-disabled", String(!hasBreakdownData))
                analysisMeterInteractive.setAttribute("tabindex", hasBreakdownData ? "0" : "-1")
            }
            riskMeterHint?.classList.toggle("is-muted", !hasBreakdownData)
            if (hasMeterData || hasBreakdownData || hasSummaryData) {
                analysisContent.classList.remove("hidden")
                setAnalysisView(currentAnalysisView)
            }
        }
        break
    case "error":
        headline = "Analysis unavailable"
        subhead = state.analysisError || "Gemini could not analyze this document."
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
}

function setAnalysisView(view) {
    if (!analysisContent) {
        return
    }
    // Keep navigation consistent even if certain datasets are missing.
    let targetView = view
    if (targetView === "breakdown" && !hasBreakdownData) {
        targetView = hasMeterData ? "meter" : (hasSummaryData ? "summary" : "meter")
    }
    if (targetView === "summary" && !hasSummaryData) {
        targetView = hasMeterData ? "meter" : (hasBreakdownData ? "breakdown" : "meter")
    }
    if (targetView === "meter" && !hasMeterData) {
        targetView = hasBreakdownData ? "breakdown" : (hasSummaryData ? "summary" : "meter")
    }
    currentAnalysisView = targetView
    analysisMeterView?.classList.toggle("hidden", currentAnalysisView !== "meter")
    analysisBreakdownView?.classList.toggle("hidden", currentAnalysisView !== "breakdown")
    analysisSummaryView?.classList.toggle("hidden", currentAnalysisView !== "summary")
    analysisBackButton?.classList.toggle("hidden", currentAnalysisView === "meter")
}

function handleMeterActivate() {
    if (!hasBreakdownData) {
        return
    }
    setAnalysisView("breakdown")
    scrollAnalysisViewIntoFocus(analysisBreakdownView)
}

function updateRiskMeter(scoreData) {
    if (!riskMeterScore || !riskMeterLabel || !riskMeterNeedle) {
        return false
    }
    const rawValue = Number(scoreData?.overall)
    if (!Number.isFinite(rawValue)) {
        return false
    }
    const value = Math.max(0, Math.min(100, rawValue))
    riskMeterScore.textContent = String(Math.round(value))
    const label = scoreData?.finalLevel || describeScoreBand(value)
    riskMeterLabel.textContent = label || ""
    const rotation = -90 + (value / 100) * 180
    riskMeterNeedle.style.setProperty("--needle-rotation", `${rotation}deg`)
    return true
}

function renderBreakdownGrid(scoreData) {
    if (!analysisBreakdownGrid) {
        return false
    }
    analysisBreakdownGrid.innerHTML = ""
    const breakdown = scoreData?.breakdown && typeof scoreData.breakdown === "object" ? scoreData.breakdown : {}
    let rendered = false
    const order = ["data_collection", "data_sharing", "user_control", "data_longevity", "legal_integrity"]
    order.forEach((key) => {
        const raw = Number(breakdown[key])
        if (!Number.isFinite(raw)) {
            return
        }
        rendered = true
        const value = Math.max(0, Math.min(100, raw))
        const cube = document.createElement("div")
        cube.className = `scoreCube ${scoreLevelClass(value)}`

        const label = document.createElement("p")
        label.className = "scoreCube__label"
        label.textContent = SCORE_LABELS[key] || key

        const score = document.createElement("p")
        score.className = "scoreCube__value"
        score.textContent = String(Math.round(value))

        const band = document.createElement("p")
        band.className = "scoreCube__tag"
        band.textContent = describeScoreBand(value)

        cube.append(label, score, band)
        analysisBreakdownGrid.appendChild(cube)
    })
    return rendered
}

function scoreLevelClass(score) {
    if (score >= 80) {
        return "scoreLevel--positive"
    }
    if (score >= 60) {
        return "scoreLevel--steady"
    }
    if (score >= 40) {
        return "scoreLevel--caution"
    }
    if (score >= 20) {
        return "scoreLevel--high"
    }
    return "scoreLevel--critical"
}

function describeScoreBand(score) {
    for (const band of SCORE_BANDS) {
        if (score >= band.min) {
            return band.label
        }
    }
    return ""
}

function scrollAnalysisViewIntoFocus(element) {
    if (!element || element.classList.contains("hidden")) {
        return
    }
    element.scrollIntoView({behavior: "smooth", block: "start"})
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
