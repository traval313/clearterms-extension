"use strict"

let activeTabId = null
let currentState = null

const detectionBadge = document.getElementById("detectionBadge")
const legalState = document.getElementById("legalState")
const neutralState = document.getElementById("neutralState")
const consentState = document.getElementById("consentState")
const detectionReasons = document.getElementById("detectionReasons")
const consentMessage = document.getElementById("consentMessage")
const consentYes = document.getElementById("consentYes")
const consentNo = document.getElementById("consentNo")

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

    const nextState = {...currentState, consent: choice}
    renderState(nextState)
}

function renderState(state) {
    currentState = state ?? {
        detected: false,
        matchedUrlKeywords: [],
        matchedContentKeywords: [],
        matchedActionKeywords: [],
        consent: null,
    }
    setBadge(currentState)
    updatePanels(currentState)
    updateReasons(currentState)
}

function setBadge(state) {
    detectionBadge.textContent = state.detected ? "Legal page" : "Idle"
    detectionBadge.classList.toggle("badge--highlight", state.detected)
    detectionBadge.classList.toggle("badge--neutral", !state.detected)
}

function updatePanels(state) {
    legalState.classList.toggle("hidden", !(state.detected && !state.consent))
    neutralState.classList.toggle("hidden", state.detected)
    consentState.classList.toggle("hidden", !state.consent)

    if (state.consent) {
        consentMessage.textContent = state.consent === "accepted" ?
            "Thanks! We’ll analyze this page when AI results are available." :
            "No problem. We won’t analyze this page until you’re ready."
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
