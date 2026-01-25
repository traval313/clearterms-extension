"use strict"

let activeTabId = null
let currentState = null
let pollingHandle = null
let analysisKickoffRequested = false
let currentAnalysisView = "meter"
let hasBreakdownData = false
let hasSummaryData = false
let hasMeterData = false
let detectionRefreshPending = false
let categoryDetailData = {}
let expandedCategoryKey = null
let expandedCategoryElement = null
let categoryDetailAnimating = false
let detectionScriptInjectionPending = false
let hasGeminiApiKey = false
let apiKeySavePending = false
let forceResetButtonVisible = false
let pendingTabStateReset = false

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
const categoryDetail = document.getElementById("categoryDetail")
const categoryDetailCard = document.getElementById("categoryDetailCard")
const categoryDetailBack = document.getElementById("categoryDetailBack")
const categoryDetailLabel = document.getElementById("categoryDetailLabel")
const categoryDetailScore = document.getElementById("categoryDetailScore")
const categoryDetailTag = document.getElementById("categoryDetailTag")
const categoryDetailText = document.getElementById("categoryDetailText")
const riskMeterNeedle = document.getElementById("riskMeterNeedle")
const riskMeterScore = document.getElementById("riskMeterScore")
const riskMeterLabel = document.getElementById("riskMeterLabel")
const riskMeterHint = document.getElementById("riskMeterHint")
const processingTrackItems = Array.from(document.querySelectorAll('.stateTrack li'))
const apiKeyState = document.getElementById("apiKeyState")
const extensionContent = document.getElementById("extensionContent")
const apiKeyForm = document.getElementById("apiKeyForm")
const apiKeyInput = document.getElementById("apiKeyInput")
const apiKeyMessage = document.getElementById("apiKeyMessage")
const apiKeyHelpLink = document.getElementById("apiKeyHelpLink")
const apiKeyControls = document.getElementById("apiKeyControls")
const apiKeyResetButton = document.getElementById("apiKeyResetButton")
const apiKeySaveButton = document.getElementById("apiKeySaveButton")

const SCORE_LABELS = {
    overall: "Overall risk",
    data_collection: "Data collection",
    data_sharing: "Data sharing",
    user_control: "User control",
    data_longevity: "Data longevity",
    legal_integrity: "Legal integrity",
}

const SCORE_BANDS = [
    {min: 80, level: 5, label: "Dangerous", detail: "Very high risk"},
    {min: 60, level: 4, label: "Risky", detail: "High risk"},
    {min: 40, level: 3, label: "Concerning", detail: "Moderate risk"},
    {min: 20, level: 2, label: "Acceptable", detail: "Low risk"},
    {min: 0, level: 1, label: "Exemplary", detail: "Very low risk"},
]
const GEMINI_HELP_URL = "https://ai.google.dev/gemini-api/docs/api-key"

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
analysisBreakdownGrid?.addEventListener("click", handleCategoryGridActivate)
analysisBreakdownGrid?.addEventListener("keydown", handleCategoryGridKeydown)
categoryDetailBack?.addEventListener("click", () => collapseCategoryDetail())
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isCategoryDetailOpen()) {
        event.preventDefault()
        collapseCategoryDetail()
    }
})
apiKeyForm?.addEventListener("submit", handleApiKeySave)
apiKeyInput?.addEventListener("input", () => setApiKeyMessage(""))
apiKeyHelpLink?.addEventListener("click", openGeminiHelp)
apiKeyResetButton?.addEventListener("click", handleApiKeyReset)

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, "geminiApiKey")) {
        const nextValue = typeof changes.geminiApiKey.newValue === "string" ? changes.geminiApiKey.newValue.trim() : ""
        applyApiKeyAvailability(Boolean(nextValue))
        if (nextValue) {
            const shouldReset = pendingTabStateReset
            pendingTabStateReset = false
            initializeActiveTabContext({resetState: shouldReset})
        } else {
            pendingTabStateReset = false
        }
    }
    if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, "geminiApiKeyStatus")) {
        const change = changes.geminiApiKeyStatus
        const statusText = typeof change.newValue === "string" ? change.newValue : ""
        if (statusText) {
            setApiKeyMessage(statusText, "error")
        } else if (change.newValue === undefined) {
            setApiKeyMessage("")
        }
    }
})

document.addEventListener("DOMContentLoaded", () => {
    initializePopup()
})

function initializePopup() {
    readStoredApiKeyState().then(({hasKey, statusMessage}) => {
        if (statusMessage) {
            setApiKeyMessage(statusMessage, "error")
        }
        applyApiKeyAvailability(hasKey)
        if (hasKey) {
            initializeActiveTabContext()
        } else {
            renderState(null)
        }
    })
}

function initializeActiveTabContext(options = {}) {
    if (!hasGeminiApiKey) {
        return
    }
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (!tabs || tabs.length === 0) {
            renderState(null)
            return
        }
        activeTabId = tabs[0].id ?? null
        if (typeof activeTabId !== "number") {
            renderState(null)
            return
        }
        const shouldReset = Boolean(options.resetState)
        const afterReset = () => fetchDetectionState()
        if (shouldReset) {
            requestTabStateReset(activeTabId).then(afterReset)
        } else {
            afterReset()
        }
    })
}

function fetchDetectionState() {
    if (!hasGeminiApiKey) {
        return
    }
    if (typeof activeTabId !== "number") {
        renderState(null)
        maybeRequestDetectionRefresh(null)
        return
    }
    chrome.runtime.sendMessage({
        type: "GET_DETECTION_STATE",
        tabId: activeTabId,
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn("Unable to fetch detection state", chrome.runtime.lastError)
            renderState(null)
            maybeRequestDetectionRefresh(null)
            return
        }
        renderState(response)
        maybeRequestDetectionRefresh(response)
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
    updateProcessingTrack(currentState)
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

    if (status === "success") {
        acceptedState.classList.add("hidden")
        acceptedState.classList.remove("panel--error")
        return
    }

    acceptedState.classList.remove("hidden")

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

function updateProcessingTrack(state) {
    if (!processingTrackItems.length) {
        return
    }
    const active = deriveProcessingStage(state)
    processingTrackItems.forEach((item) => {
        const step = item.getAttribute('data-state') || ""
        item.classList.toggle("is-active", step === active)
    })
}

function deriveProcessingStage(state) {
    const extractionStatus = state.extractionStatus || "idle"
    const analysisStatus = state.analysisStatus || "idle"

    if (analysisStatus === "success") {
        return "preview"
    }

    const consented = state.consent === "accepted"
    const extractionInFlight = extractionStatus === "pending"
    const analysisInFlight = analysisStatus === "pending"
    const extractionFinished = extractionStatus === "success"
    const extractionFailed = extractionStatus === "error"
    const analysisFailed = analysisStatus === "error"

    if (consented && (extractionInFlight || analysisInFlight || extractionFinished || extractionFailed || analysisFailed)) {
        return "loading"
    }

    if (state.detected) {
        return "detected"
    }

    return "idle"
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
    categoryDetailData = {}
    collapseCategoryDetail(true)

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
            hasMeterData = updateRiskMeter(result.scores, result.overall_risk_level)
            hasBreakdownData = renderBreakdownGrid(result.scores, result.justifications)
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
    if (currentAnalysisView !== "breakdown") {
        collapseCategoryDetail(true)
    }
}

function handleMeterActivate() {
    if (!hasBreakdownData) {
        return
    }
    setAnalysisView("breakdown")
    scrollAnalysisViewIntoFocus(analysisBreakdownView)
}

function updateRiskMeter(scoreData, explicitDescriptor) {
    if (!riskMeterScore || !riskMeterLabel || !riskMeterNeedle) {
        return false
    }
    const rawValue = Number(scoreData?.overall)
    if (!Number.isFinite(rawValue)) {
        return false
    }
    const value = Math.max(0, Math.min(100, rawValue))
    const providedLevel = parseLevelLabel(scoreData?.finalLevel)
    const fallbackLevel = describeScoreBand(value)
    const levelToShow = providedLevel?.level ?? fallbackLevel.level
    const fallbackDescriptor = formatBandDescriptor(fallbackLevel)
    const descFromScore = scoreData?.riskLabel ? formatBandDescriptor({label: scoreData.riskLabel, detail: scoreData.riskDetail}) : null
    const descriptor = (typeof explicitDescriptor === "string" && explicitDescriptor.trim().length)
        ? explicitDescriptor.trim()
        : (descFromScore || providedLevel?.label || fallbackDescriptor)
    riskMeterScore.textContent = String(Math.round(value))
    riskMeterLabel.textContent = `Level ${levelToShow} (${descriptor})`
    const rotation = -90 + (value / 100) * 180
    riskMeterNeedle.style.setProperty("--needle-rotation", `${rotation}deg`)
    return true
}

function renderBreakdownGrid(scoreData, justifications) {
    if (!analysisBreakdownGrid) {
        return false
    }
    analysisBreakdownGrid.innerHTML = ""
    analysisBreakdownGrid.classList.remove("is-inactive")
    const breakdown = scoreData?.breakdown && typeof scoreData.breakdown === "object" ? scoreData.breakdown : {}
    const explanationSource = justifications && typeof justifications === "object" ? justifications : {}
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
        cube.setAttribute("tabindex", "0")
        cube.setAttribute("role", "button")
        cube.setAttribute("data-category-key", key)

        const labelCopy = SCORE_LABELS[key] || key
        const label = document.createElement("p")
        label.className = "scoreCube__label"
        label.textContent = labelCopy

        const score = document.createElement("p")
        score.className = "scoreCube__value"
        const rounded = Math.round(value)
        score.textContent = String(rounded)

        const bandInfo = describeScoreBand(value)
        const bandDescriptor = formatBandDescriptor(bandInfo)
        const bandText = `Level ${bandInfo.level} (${bandDescriptor})`
        const band = document.createElement("p")
        band.className = "scoreCube__tag"
        band.textContent = bandText

        cube.setAttribute("aria-label", `${labelCopy} scored ${rounded}. View Gemini's justification.`)

        const explanationRaw = typeof explanationSource[key] === "string" ? explanationSource[key].trim() : ""
        const explanation = explanationRaw || "Gemini did not provide a justification for this category."
        categoryDetailData[key] = {
            label: labelCopy,
            score: value,
            band: bandText,
            explanation,
        }

        cube.append(label, score, band)
        analysisBreakdownGrid.appendChild(cube)
    })
    return rendered
}

function scoreLevelClass(score) {
    if (score < 20) {
        return "scoreLevel--positive"
    }
    if (score < 40) {
        return "scoreLevel--steady"
    }
    if (score < 60) {
        return "scoreLevel--caution"
    }
    if (score < 80) {
        return "scoreLevel--high"
    }
    return "scoreLevel--critical"
}

function describeScoreBand(score) {
    for (const band of SCORE_BANDS) {
        if (score >= band.min) {
            return {level: band.level, label: band.label, detail: band.detail || ""}
        }
    }
    const fallback = SCORE_BANDS[SCORE_BANDS.length - 1]
    return {level: fallback.level, label: fallback.label, detail: fallback.detail || ""}
}

function formatBandDescriptor(band) {
    if (!band) {
        return ""
    }
    if (band.label && band.detail) {
        return `${band.label} (${band.detail})`
    }
    return band.label || band.detail || ""
}

function parseLevelLabel(text) {
    if (typeof text !== "string") {
        return null
    }
    const match = text.match(/Level\s*(\d)(?:\s*\(([^)]+)\))?/i)
    if (!match) {
        return null
    }
    const level = Number(match[1])
    if (!Number.isFinite(level)) {
        return null
    }
    const label = match[2]?.trim() || `Level ${level}`
    return {level, label}
}

function handleCategoryGridActivate(event) {
    const target = event.target
    if (!target || typeof target.closest !== "function") {
        return
    }
    const cube = target.closest(".scoreCube")
    if (cube) {
        openCategoryDetail(cube)
    }
}

function handleCategoryGridKeydown(event) {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") {
        return
    }
    const target = event.target
    if (!target || typeof target.closest !== "function") {
        return
    }
    const cube = target.closest(".scoreCube")
    if (!cube) {
        return
    }
    event.preventDefault()
    openCategoryDetail(cube)
}

function openCategoryDetail(cube) {
    if (!categoryDetail || !categoryDetailCard || categoryDetailAnimating || isCategoryDetailOpen()) {
        return
    }
    const key = cube.getAttribute("data-category-key") || ""
    if (!key) {
        return
    }
    const detail = categoryDetailData[key]
    if (!detail) {
        return
    }
    expandedCategoryKey = key
    expandedCategoryElement = cube
    categoryDetailLabel && (categoryDetailLabel.textContent = detail.label)
    categoryDetailScore && (categoryDetailScore.textContent = String(Math.round(detail.score)))
    categoryDetailTag && (categoryDetailTag.textContent = detail.band)
    categoryDetailText && (categoryDetailText.textContent = detail.explanation)
    analysisBreakdownGrid?.classList.add("is-inactive")
    analysisBreakdownGrid?.setAttribute("aria-hidden", "true")
    analysisBreakdownView?.classList.add("is-detail")
    analysisBackButton?.classList.add("hidden")
    categoryDetail.classList.remove("hidden")
    categoryDetail.setAttribute("aria-hidden", "false")
    const sourceRect = cube.getBoundingClientRect()
    playCategoryDetailAnimation("expand", sourceRect).then(() => {
        categoryDetailBack?.focus({preventScroll: true})
    })
}

function collapseCategoryDetail(skipAnimation = false) {
    if (!categoryDetail) {
        expandedCategoryElement = null
        expandedCategoryKey = null
        analysisBreakdownGrid?.classList.remove("is-inactive")
        analysisBreakdownGrid?.setAttribute("aria-hidden", "false")
        analysisBreakdownView?.classList.remove("is-detail")
        analysisBackButton?.classList.remove("hidden")
        return
    }
    if (!isCategoryDetailOpen()) {
        analysisBreakdownGrid?.classList.remove("is-inactive")
        analysisBreakdownGrid?.setAttribute("aria-hidden", "false")
        analysisBreakdownView?.classList.remove("is-detail")
        analysisBackButton?.classList.remove("hidden")
        expandedCategoryElement = null
        expandedCategoryKey = null
        categoryDetail.classList.add("hidden")
        categoryDetail.setAttribute("aria-hidden", "true")
        return
    }
    const origin = expandedCategoryElement
    const finish = () => {
        categoryDetail.classList.add("hidden")
        categoryDetail.setAttribute("aria-hidden", "true")
        analysisBreakdownGrid?.classList.remove("is-inactive")
        analysisBreakdownGrid?.setAttribute("aria-hidden", "false")
        analysisBreakdownView?.classList.remove("is-detail")
        analysisBackButton?.classList.remove("hidden")
        const focusTarget = origin
        expandedCategoryElement = null
        expandedCategoryKey = null
        if (focusTarget && typeof focusTarget.focus === "function") {
            requestAnimationFrame(() => focusTarget.focus({preventScroll: true}))
        }
    }
    if (skipAnimation || !origin) {
        stopCategoryDetailAnimations()
        finish()
        return
    }
    const sourceRect = origin.getBoundingClientRect()
    playCategoryDetailAnimation("collapse", sourceRect).then(finish)
}

function isCategoryDetailOpen() {
    return Boolean(categoryDetail && !categoryDetail.classList.contains("hidden"))
}

function playCategoryDetailAnimation(mode, sourceRect) {
    if (!categoryDetailCard || !sourceRect || prefersReducedMotion()) {
        return Promise.resolve()
    }
    const detailRect = categoryDetailCard.getBoundingClientRect()
    if (!detailRect.width || !detailRect.height) {
        return Promise.resolve()
    }
    stopCategoryDetailAnimations()
    const deltaX = sourceRect.left - detailRect.left
    const deltaY = sourceRect.top - detailRect.top
    const scaleX = sourceRect.width / detailRect.width
    const scaleY = sourceRect.height / detailRect.height
    const rotate = mode === "expand" ? -18 : 18
    const frames = mode === "expand" ? [
        {transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY}) rotateY(${rotate}deg)`, opacity: 0},
        {transform: "translate(0, 0) scale(1, 1) rotateY(0deg)", opacity: 1},
    ] : [
        {transform: "translate(0, 0) scale(1, 1) rotateY(0deg)", opacity: 1},
        {transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY}) rotateY(${rotate}deg)`, opacity: 0},
    ]
    categoryDetailAnimating = true
    const animation = categoryDetailCard.animate(frames, {
        duration: 380,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
    })
    return new Promise((resolve) => {
        const handleFinish = () => {
            categoryDetailAnimating = false
            categoryDetailCard.style.transform = ""
            categoryDetailCard.style.opacity = ""
            resolve()
        }
        animation.addEventListener("finish", handleFinish, {once: true})
        animation.addEventListener("cancel", handleFinish, {once: true})
    })
}

function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function stopCategoryDetailAnimations() {
    if (!categoryDetailCard || typeof categoryDetailCard.getAnimations !== "function") {
        categoryDetailAnimating = false
        return
    }
    const running = categoryDetailCard.getAnimations()
    running.forEach((animation) => animation.cancel())
    categoryDetailAnimating = false
}

function shouldAttemptContentScriptInjection(errorMessage) {
    if (!errorMessage) {
        return false
    }
    if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
        return false
    }
    return errorMessage.includes("Could not establish connection")
}

function injectDetectionContentScript() {
    if (detectionScriptInjectionPending) {
        return Promise.reject(new Error("Content script injection already in progress."))
    }
    if (typeof activeTabId !== "number") {
        return Promise.reject(new Error("No active tab available for injection."))
    }
    detectionScriptInjectionPending = true
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript({
            target: {tabId: activeTabId},
            files: ["content.js"],
        }, () => {
            detectionScriptInjectionPending = false
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError)
                return
            }
            resolve(true)
        })
    })
}

function scrollAnalysisViewIntoFocus(element) {
    if (!element || element.classList.contains("hidden")) {
        return
    }
    element.scrollIntoView({behavior: "smooth", block: "start"})
}

function maybeRequestAnalysis(state) {
    if (!hasGeminiApiKey) {
        analysisKickoffRequested = false
        return
    }
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
    if (!hasGeminiApiKey) {
        return
    }
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

function maybeRequestDetectionRefresh(state) {
    if (!hasGeminiApiKey) {
        return
    }
    if (typeof activeTabId !== "number") {
        return
    }
    const lastUpdate = typeof state?.lastUpdated === "number" ? state.lastUpdated : 0
    const detectionMissing = !state?.detected
    const isStale = !lastUpdate || Date.now() - lastUpdate > 5000
    if (!detectionMissing && !isStale) {
        return
    }
    requestDetectionRefresh()
}

function requestDetectionRefresh() {
    if (!hasGeminiApiKey) {
        return
    }
    if (detectionRefreshPending) {
        return
    }
    if (typeof activeTabId !== "number") {
        return
    }
    detectionRefreshPending = true
    chrome.tabs.sendMessage(activeTabId, {type: "REQUEST_DETECTION_REFRESH"}, () => {
        detectionRefreshPending = false
        if (chrome.runtime.lastError) {
            const message = chrome.runtime.lastError.message || ""
            console.debug("Detection refresh unavailable", message)
            if (shouldAttemptContentScriptInjection(message)) {
                injectDetectionContentScript().then(() => {
                    requestDetectionRefresh()
                }).catch((error) => {
                    console.debug("Content script injection failed", error?.message || error)
                })
            }
            return
        }
        requestStateRefreshSoon()
    })
}

function requestStateRefreshSoon() {
    if (!hasGeminiApiKey) {
        return
    }
    setTimeout(() => {
        if (!pollingHandle) {
            fetchDetectionState()
        }
    }, 200)
}

function readStoredApiKeyState() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["geminiApiKey", "geminiApiKeyStatus"], (items) => {
            if (chrome.runtime.lastError) {
                console.warn("Unable to read stored API key", chrome.runtime.lastError)
                resolve({hasKey: false, statusMessage: ""})
                return
            }
            const key = typeof items?.geminiApiKey === "string" ? items.geminiApiKey.trim() : ""
            const statusMessage = typeof items?.geminiApiKeyStatus === "string" ? items.geminiApiKeyStatus : ""
            resolve({hasKey: Boolean(key), statusMessage})
        })
    })
}

function applyApiKeyAvailability(enabled) {
    hasGeminiApiKey = enabled
    extensionContent?.classList.toggle("hidden", !enabled)
    apiKeyState?.classList.toggle("hidden", enabled)
    if (enabled) {
        forceResetButtonVisible = false
        apiKeyInput && (apiKeyInput.value = "")
        setApiKeyMessage("")
    } else {
        stopStatePolling()
        detectionRefreshPending = false
        detectionScriptInjectionPending = false
        analysisKickoffRequested = false
        activeTabId = null
        renderState(null)
    }
    syncResetButtonVisibility()
}

function handleApiKeySave(event) {
    event?.preventDefault()
    if (apiKeySavePending) {
        return
    }
    if (!apiKeyInput) {
        return
    }
    const key = apiKeyInput.value.trim()
    if (!key) {
        setApiKeyMessage("Enter a Gemini API key to continue.", "error")
        return
    }
    if (key.length < 30) {
        setApiKeyMessage("The key looks too short. Paste the full Gemini API key.", "error")
        return
    }
    apiKeySavePending = true
    if (apiKeySaveButton) {
        apiKeySaveButton.disabled = true
    }
    chrome.storage.local.set({geminiApiKey: key}, () => {
        apiKeySavePending = false
        if (apiKeySaveButton) {
            apiKeySaveButton.disabled = false
        }
        if (chrome.runtime.lastError) {
            setApiKeyMessage("Unable to save the API key. Try again.", "error")
            return
        }
        chrome.storage.local.remove("geminiApiKeyStatus", () => {})
        apiKeyInput.value = ""
        setApiKeyMessage("Key saved. You can close this popup.", "success")
        forceResetButtonVisible = false
        setResetButtonHighlight(false)
        syncResetButtonVisibility()
        pendingTabStateReset = true
    })
}

function handleApiKeyReset() {
    chrome.storage.local.remove(["geminiApiKey", "geminiApiKeyStatus"], () => {
        if (chrome.runtime.lastError) {
            setApiKeyMessage("Unable to reset the API key. Try again.", "error")
            return
        }
        setApiKeyMessage("API key cleared. Enter a new key to re-enable AI analysis.", "success")
        pendingTabStateReset = true
        if (typeof activeTabId === "number") {
            requestTabStateReset(activeTabId)
        } else {
            renderState(null)
        }
    })
}

function openGeminiHelp(event) {
    event?.preventDefault()
    chrome.tabs.create({url: GEMINI_HELP_URL}, () => chrome.runtime.lastError && console.debug(chrome.runtime.lastError))
}

function setApiKeyMessage(text, variant = "") {
    if (!apiKeyMessage) {
        return
    }
    apiKeyMessage.textContent = text
    apiKeyMessage.classList.toggle("hidden", !text)
    apiKeyMessage.classList.remove("formMessage--error", "formMessage--success")
    if (variant === "error") {
        apiKeyMessage.classList.add("formMessage--error")
    } else if (variant === "success") {
        apiKeyMessage.classList.add("formMessage--success")
    }
    const highlightReset = Boolean(text && /reset the api key/i.test(text))
    forceResetButtonVisible = highlightReset
    setResetButtonHighlight(highlightReset)
    syncResetButtonVisibility()
}

function stopStatePolling() {
    if (pollingHandle) {
        clearTimeout(pollingHandle)
        pollingHandle = null
    }
}

function syncResetButtonVisibility() {
    if (!apiKeyControls) {
        return
    }
    const shouldShow = hasGeminiApiKey || forceResetButtonVisible
    apiKeyControls.classList.toggle("hidden", !shouldShow)
}

function setResetButtonHighlight(enabled) {
    apiKeyResetButton?.classList.toggle("is-highlighted", Boolean(enabled))
}

function requestTabStateReset(tabId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({type: "RESET_TAB_STATE", tabId}, () => {
            if (chrome.runtime.lastError) {
                console.debug("Unable to reset tab state", chrome.runtime.lastError)
            }
            resolve()
        })
    })
}
