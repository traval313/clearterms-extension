"use strict"

const URL_KEYWORDS = [
    "terms",
    "privacy",
    "policy",
    "conditions",
    "agreement",
    "legal",
    "eula",
]

const PAGE_KEYWORDS = [
    "terms of service",
    "terms & conditions",
    "terms and conditions",
    "privacy policy",
    "data policy",
    "acceptable use",
    "user agreement",
    "service agreement",
    "cookie policy",
    "legal notice",
]

const ACTION_KEYWORDS = [
    "accept",
    "agree",
    "consent",
    "decline",
    "continue",
]

let lastDetection = null
let pendingEvaluation = false

evaluateDetection(true)
setupDomObserver()

function setupDomObserver() {
    if (!document) {
        return
    }
    const observer = new MutationObserver(() => scheduleEvaluation())
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    })
}

function scheduleEvaluation() {
    if (pendingEvaluation) {
        return
    }
    pendingEvaluation = true
    setTimeout(() => {
        pendingEvaluation = false
        evaluateDetection(false)
    }, 800)
}

function evaluateDetection(forceSend) {
    const detection = collectDetection()
    if (!forceSend && !hasDetectionChanged(detection)) {
        return
    }
    lastDetection = detection
    chrome.runtime.sendMessage({
        type: "LEGAL_PAGE_DETECTION",
        payload: detection,
    }, () => chrome.runtime.lastError && console.debug(chrome.runtime.lastError))
}

function collectDetection() {
    const matchedUrlKeywords = findUrlKeywords()
    const matchedContentKeywords = findContentKeywords()
    const matchedActionKeywords = findActionKeywords()

    let score = 0
    if (matchedUrlKeywords.length > 0) score += 1
    if (matchedContentKeywords.length > 0) score += 1
    if (matchedActionKeywords.length > 0) score += 1

    const detected = score >= 2 || matchedContentKeywords.length >= 2

    return {
        detected,
        score,
        matchedUrlKeywords,
        matchedContentKeywords,
        matchedActionKeywords,
    }
}

function hasDetectionChanged(nextDetection) {
    if (lastDetection === null) {
        return true
    }
    return lastDetection.detected !== nextDetection.detected ||
        lastDetection.score !== nextDetection.score ||
        arrayChanged(lastDetection.matchedUrlKeywords, nextDetection.matchedUrlKeywords) ||
        arrayChanged(lastDetection.matchedContentKeywords, nextDetection.matchedContentKeywords) ||
        arrayChanged(lastDetection.matchedActionKeywords, nextDetection.matchedActionKeywords)
}

function arrayChanged(prev, next) {
    if (prev.length !== next.length) {
        return true
    }
    for (let i = 0; i < prev.length; i += 1) {
        if (prev[i] !== next[i]) {
            return true
        }
    }
    return false
}

function findUrlKeywords() {
    const href = window.location.href.toLowerCase()
    return URL_KEYWORDS.filter((keyword) => href.includes(keyword))
}

function findContentKeywords() {
    const body = document.body
    if (!body) {
        return []
    }
    const text = body.innerText.toLowerCase().slice(0, 50000)
    return PAGE_KEYWORDS.filter((keyword) => text.includes(keyword))
}

function findActionKeywords() {
    const matches = new Set()
    const selector = "button, a, input[type='button'], input[type='submit']"
    document.querySelectorAll(selector).forEach((node) => {
        const textContent = (node.textContent || node.value || "").trim().toLowerCase()
        if (!textContent) {
            return
        }
        ACTION_KEYWORDS.forEach((keyword) => {
            if (textContent.includes(keyword)) {
                matches.add(keyword)
            }
        })
    })
    return Array.from(matches.values())
}
