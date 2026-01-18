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

const MINIMUM_TEXT_LENGTH = 300
const TEXT_LENGTH_TARGET = 1200
const CANDIDATE_SELECTORS = [
    "main",
    "article",
    "section",
    "div[class*='legal' i]",
    "div[class*='terms' i]",
    "div[class*='policy' i]",
    "div[class*='privacy' i]",
    "div[id*='terms' i]",
    "div[id*='privacy' i]",
]
const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "META",
    "LINK",
    "SVG",
    "CANVAS",
    "IMG",
    "VIDEO",
    "AUDIO",
    "PICTURE",
    "SOURCE",
    "NAV",
    "HEADER",
    "FOOTER",
    "ASIDE",
    "FORM",
])
const BLOCK_ELEMENTS = new Set([
    "P",
    "DIV",
    "SECTION",
    "ARTICLE",
    "MAIN",
    "UL",
    "OL",
    "LI",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TD",
    "TH",
    "BLOCKQUOTE",
])

let lastDetection = null
let pendingEvaluation = false
let extractionInProgress = false

evaluateDetection(true)
setupDomObserver()
setupMessageListener()

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

function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message.type !== "string") {
            return undefined
        }
        if (message.type === "START_LEGAL_TEXT_EXTRACTION") {
            if (extractionInProgress) {
                if (sendResponse) {
                    sendResponse({started: false, reason: "busy"})
                }
                return false
            }
            extractionInProgress = true
            if (sendResponse) {
                sendResponse({started: true})
            }
            queueMicrotask(() => runLegalTextExtraction())
            return false
        }
        return undefined
    })
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

async function runLegalTextExtraction() {
    try {
        const result = extractLegalTextFromDocument()
        const charCount = result.length
        if (charCount < MINIMUM_TEXT_LENGTH) {
            throw new Error("Not enough visible legal text found on this page.")
        }
        chrome.runtime.sendMessage({
            type: "LEGAL_TEXT_EXTRACTION_RESULT",
            payload: {
                status: "success",
                result: {
                    text: result,
                    char_count: charCount,
                    source_url: window.location.href,
                },
            },
        }, () => chrome.runtime.lastError && console.debug(chrome.runtime.lastError))
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to extract legal text."
        chrome.runtime.sendMessage({
            type: "LEGAL_TEXT_EXTRACTION_RESULT",
            payload: {
                status: "error",
                error: message,
            },
        }, () => chrome.runtime.lastError && console.debug(chrome.runtime.lastError))
    } finally {
        extractionInProgress = false
    }
}

function extractLegalTextFromDocument() {
    if (!document || !document.body) {
        return ""
    }
    const segments = []
    let longestText = ""
    const candidates = getCandidateContainers()
    for (const node of candidates) {
        segments.length = 0
        collectVisibleText(node, segments)
        const text = normalizeSegments(segments)
        if (text.length > longestText.length) {
            longestText = text
        }
        if (text.length >= TEXT_LENGTH_TARGET) {
            break
        }
    }
    if (!longestText && document.body) {
        segments.length = 0
        collectVisibleText(document.body, segments)
        longestText = normalizeSegments(segments)
    }
    return longestText.trim()
}

function getCandidateContainers() {
    if (!document) {
        return []
    }
    const nodes = new Set()
    CANDIDATE_SELECTORS.forEach((selector) => {
        document.querySelectorAll(selector).forEach((node) => nodes.add(node))
    })
    if (document.body) {
        nodes.add(document.body)
    }
    const arr = Array.from(nodes.values())
        .filter((node) => !!node && node instanceof Element)
        .sort((a, b) => getTextScore(b) - getTextScore(a))
    if (document.body) {
        const bodyIndex = arr.indexOf(document.body)
        if (bodyIndex > 0) {
            arr.splice(bodyIndex, 1)
            arr.push(document.body)
        }
    }
    return arr
}

function getTextScore(element) {
    const raw = (element.innerText || "").replace(/\s+/g, " ").trim()
    return raw.length
}

function collectVisibleText(node, segments) {
    if (node.nodeType === Node.TEXT_NODE) {
        const textContent = node.textContent || ""
        const normalized = textContent.replace(/\s+/g, " ").trim()
        if (normalized) {
            segments.push(normalized)
        }
        return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return
    }
    const element = /** @type {Element} */ (node)
    if (shouldSkipElement(element)) {
        return
    }
    const isBlock = BLOCK_ELEMENTS.has(element.tagName)
    if (isBlock) {
        segments.push("\n")
    }
    for (const child of element.childNodes) {
        collectVisibleText(child, segments)
    }
    if (isBlock) {
        segments.push("\n")
    }
}

function normalizeSegments(segments) {
    const raw = segments.join(" ").replace(/\u00a0/g, " ")
    return raw
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim()
}

function shouldSkipElement(element) {
    if (SKIP_TAGS.has(element.tagName)) {
        return true
    }
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
        return true
    }
    const role = element.getAttribute("role")
    if (role === "navigation" || role === "banner" || role === "contentinfo") {
        return true
    }
    const style = window.getComputedStyle(element)
    if (!style) {
        return false
    }
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) {
        return true
    }
    if (element.offsetWidth === 0 && element.offsetHeight === 0) {
        return true
    }
    return false
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
