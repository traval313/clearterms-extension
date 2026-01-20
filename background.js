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
const GEMINI_PROMPT = `  You are a Consumer Protection Advocate and Data Auditor specializing in legal transparency.
  Your task is to analyze Terms of Service (ToS) and Privacy Policies to produce a "Privacy Nutritional Label" for students, families, and community members.
Perform a structured audit of the provided legal document using the Strict Deterministic Rules below.   When scoring, consider the product purpose.

- Consider what the service does (e.g., social network, file editor, messaging app) to determine whether data collection, sharing, retention, or processing is reasonable.

- Do NOT adjust numeric risk scores based on purpose; all scores remain fixed.  
- Use inferred purpose to explain **alignment or misalignment** in each pillar’s justification.
- Example justification snippet: 
  "Clause: 'We collect IP addresses and device IDs.' Level 3 assigned. Collection is moderate risk, but aligns with expected functionality of a social content platform, as device info is needed for account and session management."




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
  - Worst-Case Resolution: If multiple clause types are detected within a single pillar (e.g., both "crash logs" and "biometrics"), you
  MUST assign the LOWEST (most harmful) applicable Level.

  2. The "Neutral Default" Definition
  - If NO specific clause triggers (Levels 1, 2, 3, 4, 5) are found for a pillar, you must check for "General Privacy Language."
  - Definition: "General Privacy Language" consists of standard headers (e.g., "Information We Collect", "Security") OR generic
  assurances (e.g., "We value your privacy") without specific technical details.
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

 CLAUSE-BASED AUDIT RUBRIC

## 1. Data Collection: What do they take from you? (Weight: 25%)

### DETECTION RULES:

**Level 1 (Score: 5 pts) - Minimal Collection**
Trigger if document contains:
- Explicit limitation language:
  * "only collect" + ["email" OR "username" OR "password" OR "payment information"]
  * "minimal data" + "account creation"
  * "strictly necessary for" + ["registration" OR "authentication" OR "billing"]
- AND document does NOT mention:
  * Device identifiers (Device ID, IMEI, MAC address, advertising ID)
  * Analytics terms (usage data, behavioral data, interaction patterns)
  * Tracking technologies beyond essential cookies

**Level 2 (Score: 25 pts) - Functional Data**
Trigger if document mentions ANY of:
- "crash reports" OR "crash logs" OR "error reports"
- "diagnostic data" OR "diagnostics" OR "performance data" OR "performance metrics"
- "cookies" + ["essential" OR "functional" OR "necessary" OR "site functionality"]
- "device type" OR "operating system version" (for compatibility purposes)
- "log files" (basic server logs)

**Level 3 (Score: 50 pts) - Standard Commercial**
Trigger if document mentions ANY of:
- "IP address" OR "internet protocol address"
- "device identifier" OR "device ID" OR "unique device identifier"
- "advertising ID" OR "IDFA" OR "AAID" OR "ad identifier"
- "browser type" OR "browser version" OR "user agent"
- "usage data" OR "usage information" OR "activity data"
- "analytics" (without "third-party" modifier)
- "session data" OR "session information"
- "cookies" (without specifying essential-only)
- "preferences" OR "settings"

**Level 4 (Score: 75 pts) - Aggressive Tracking**
Trigger if document mentions ANY of:
- "cross-site tracking" OR "tracking across websites" OR "tracking pixels" OR "web beacons"
- "precise location" OR "GPS location" OR "geolocation data" (not approximate/city-level)
- "third-party data" + ["combine" OR "enrich" OR "append" OR "match"]
- "data from other sources" OR "publicly available information"
- "social media" + ["monitor" OR "track" OR "analyze"]
- "persistent identifiers" + "advertising"
- "behavioral advertising" OR "interest-based advertising"

**Level 5 (Score: 100 pts) - Invasive Collection**
Trigger if document mentions ANY of:
- "biometric" OR "biometrics" OR "facial recognition" OR "face ID" OR "face scan" 
  OR "fingerprint" OR "voiceprint" OR "voice recognition" OR "iris scan" OR "retina scan"
- "health data" OR "medical information" OR "health information" (unless healthcare service)
- "genetic information" OR "DNA"
- "contact list" OR "address book" OR "phonebook access"
- "photo library" OR "camera roll" OR "gallery access" (unless photo/camera app)
- "microphone" + ["always" OR "background" OR "continuous"] 
- "keystroke" + ["logging" OR "monitoring" OR "tracking" OR "patterns"]
- "clipboard" + ["monitor" OR "scan" OR "access" OR "read"]
- "screen recording" OR "screen capture" (unless explicit feature)
- "background audio" OR "background video recording"
- "ambient audio" OR "always-on listening"

---

## 2. Data Sharing: Who else sees your info? (Weight: 25%)

### DETECTION RULES:

**Level 1 (Score: 5 pts) - No Sharing**
Trigger if document contains explicit prohibition:
- "do not sell" + "personal data" OR "personal information" OR "your information"
- "do not share" + "personal data" OR "personal information" + "third parties"
- "do not rent" + ["data" OR "information"]
- "never share" OR "will not share" + "third parties"
- "data stays on your device"
- "end-to-end encrypted" + "cannot access"
- "zero-knowledge" + ["architecture" OR "encryption"]

**Level 2 (Score: 25 pts) - Service Providers Only**
Trigger if document mentions sharing with:
- "service providers" OR "service providers who assist us"
- "processors" OR "data processors"
- "vendors" + ["limited" OR "contractual" OR "obligations"]
- AND includes protective language:
  * "contractual obligations" OR "contractually bound" OR "bound by contract"
  * "on our behalf" OR "for us" OR "to provide services to us"
  * "prohibited from using" + "their own purposes"
- Specific examples acceptable: "payment processors," "cloud hosting," "email delivery," 
  "customer support," "analytics providers who process on our behalf"

**Level 3 (Score: 50 pts) - Corporate Family**
Trigger if document mentions sharing with:
- "affiliates" OR "affiliated companies"
- "subsidiaries" OR "subsidiary companies"
- "parent company" OR "parent corporation"
- "corporate family" OR "family of companies"
- "related entities" OR "related companies"
- "companies under common control"
- "sister companies"

**Level 4 (Score: 75 pts) - Third-Party Sharing**
Trigger if document mentions sharing with:
- "partners" (without "service" modifier) OR "business partners" OR "strategic partners"
- "third parties" + ["marketing" OR "advertising" OR "promotions"]
- "advertisers" OR "advertising partners" OR "advertising networks" OR "ad networks"
- "joint ventures" OR "co-branded services"
- "select third parties" OR "trusted partners" (vague language)
- "for their own purposes" OR "their independent use"
- "marketing purposes" (external)
- "third-party analytics" (where they use data independently)

**Level 5 (Score: 100 pts) - Data Monetization / No Accountability**
Trigger if document mentions ANY of:
- "sell your data" OR "sell personal information" OR "sale of data"
- "rent your data" OR "rent personal information"
- "license your data" OR "license to third parties"
- "monetize" + ["data" OR "information"]
- "data brokers" OR "information brokers" OR "data aggregators"
- "researchers" + "share data" (without IRB/consent specifics)
- "publicly available" + "may be shared"
- "transferable asset" + ["merger" OR "acquisition" OR "bankruptcy"] (unrestricted)
- "not responsible for" + "third-party" + ["practices" OR "policies" OR "use"]
- "disclaims liability" + "third parties"
- "any third party for any purpose" (unrestricted sharing)

---

## 3. User Control: Are you in charge? (Weight: 20%)

### DETECTION RULES:

**Level 1 (Score: 5 pts) - Proactive Control**
Trigger if document mentions:
- "opt-in" + ["required" OR "consent required" OR "explicit consent"] + "tracking"
- "delete account" + ["button" OR "settings" OR "anytime" OR "immediately"]
- "self-service" + "deletion"
- "granular controls" OR "toggle" + ["individual" OR "specific" OR "each"]
- "privacy dashboard" + "manage all settings"
- "consent management platform"

**Level 2 (Score: 25 pts) - Accessible Rights**
Trigger if document mentions:
- "opt-out" + ["link" OR "button" OR "settings" OR "dashboard"]
- "Do Not Sell My Personal Information" OR "Do Not Sell" link
- "privacy settings" OR "privacy controls" OR "data controls"
- "manage preferences" + ["dashboard" OR "portal" OR "settings"]
- GDPR/CCPA rights + ["easy" OR "simple" OR "straightforward" OR "online form"]
- "respond within" + [number] + "days" (30 days or less)
- "verify and respond" + specific timeframe

**Level 3 (Score: 50 pts) - Manual Process**
Trigger if document mentions:
- "email" + ["privacy@" OR "support@" OR "dpo@"] + "to request"
- "contact us" + ["deletion" OR "access" OR "correction" OR "data request"]
- "submit a request" + ["form" OR "email" OR "mail"]
- GDPR/CCPA rights mentioned BUT no self-service mechanism described
- "reasonable timeframe" OR "as soon as possible" (vague)
- "may require" + "verification" (without specifying process)

**Level 4 (Score: 75 pts) - Limited / Conditional Rights**
Trigger if document mentions:
- Jurisdiction restrictions:
  * "California residents only" OR "EU residents only" OR "where required by law"
  * "available in certain jurisdictions" OR "if you reside in"
- Process barriers:
  * "contact us to request" (no email/form provided)
  * "no specific timeline" OR "reasonable time" (context suggests long delay)
  * "extensive verification" + ["notarized" OR "government ID" OR "multiple documents"]
  * "may deny requests" + broad exceptions
- Weak implementation:
  * "except where" + ["legal obligations" OR "legitimate interests"] (overly broad)
  * "residual copies" may remain

**Level 5 (Score: 100 pts) - No Meaningful Control**
Trigger if document mentions:
- "required to provide" + "to use the service" (no opt-outs mentioned)
- "mandatory" + "data collection"
- "cannot use service" + "without providing"
- "by using" + "you agree" OR "you consent" (automatic consent)
- "no deletion available" OR "cannot delete" OR "unable to delete"
- "retain indefinitely" + no deletion mechanism
- No mention of deletion rights anywhere in document
- "unsubscribe" applies only to emails, not data deletion

---

## 4. Data Longevity: How long do they keep it? (Weight: 15%)

### DETECTION RULES:

**Level 1 (Score: 5 pts) - Minimal Retention**
Trigger if document mentions:
- Specific short timeframes:
  * "deleted after" + ["30 days" OR "60 days" OR "90 days" OR "6 months"]
  * "session-only" OR "session data" + "deleted upon logout"
  * "temporary" + specific timeframe
- Automatic deletion:
  * "automatically deleted" + timeframe
  * "auto-delete" + timeframe
- Clear minimization:
  * "retain only as long as necessary" + specific examples with timeframes
  * "data minimization" + defined retention periods

**Level 2 (Score: 25 pts) - Account-Linked Retention**
Trigger if document mentions:
- "deleted upon account closure" OR "deleted when you close your account"
- "deleted within" + ["30 days" OR "60 days"] + "account deletion"
- "retain while account is active" + "deleted after closure"
- "grace period" + [specific days] + "then permanently deleted"
- "no longer needed" + "deleted" (with reasonable context)

**Level 3 (Score: 50 pts) - Standard Retention**
Trigger if document mentions:
- "as long as" + ["account active" OR "account exists" OR "you use our service"]
- "necessary for" + ["services" OR "operations" OR "business purposes"]
- "retained" + "reasonable period"
- "legitimate business interests" (undefined duration)
- Some data deleted, some retained:
  * "certain data" + "may be retained"
  * "some information" + "kept for business purposes"

**Level 4 (Score: 75 pts) - Indefinite Business Retention**
Trigger if document mentions:
- "business purposes" (no timeframe specified)
- "legal purposes" OR "legal compliance" (open-ended)
- "as long as permitted by law" OR "maximum period allowed by law"
- "legitimate interests" (no limit)
- "backup systems" + ["may retain" OR "residual copies"] + no deletion timeframe
- "archived" + no deletion timeline
- "compliance" + "indefinite" OR "no specified period"

**Level 5 (Score: 100 pts) - Permanent / Unrestricted**
Trigger if document mentions:
- "perpetual" + ["retention" OR "license" OR "right to use"]
- "indefinitely" + ["retain" OR "keep" OR "store"]
- "irrevocable" + ["license" OR "right" OR "permission"]
- "permanent" + "retention"
- "forever" OR "in perpetuity"
- "aggregated data" + ["indefinitely" OR "permanently" OR "no time limit"]
- "anonymized data" + ["indefinitely" OR "forever"] (weak anonymization claims)
- "de-identified" + "retain indefinitely" (without explaining methodology)
- "cannot delete" + ["technical reasons" OR "backups" OR "archives"]
- "perpetual, worldwide, irrevocable" (content license)

---

## 5. Legal Integrity: Is the contract fair? (Weight: 15%)

### DETECTION RULES:

**Level 1 (Score: 5 pts) - All yours**
Trigger if document mentions:
- "no mandatory arbitration" OR "do not require arbitration"
- "you may sue us in court" OR "court litigation available"
- "you retain ownership" + "content" OR "data"
- "you own" + ["your content" OR "your data"]
- "governing law" + [user's reasonable jurisdiction]
- "small claims court" + "available" (without arbitration requirement)
- "standard warranty" (not excessive disclaimers)

**Level 2 (Score: 25 pts) - Balanced**
Trigger if document mentions:
- "arbitration" + ["optional" OR "by mutual agreement" OR "if both parties agree"]
- "small claims court" + "exception" + "preserved" OR "allowed"
- "mediation" + "voluntary" OR "optional"
- "limitation of liability" + reasonable caps (e.g., "amount paid")
- "notice" + "opt-out" + ["changes" OR "updates"] + specific timeframe
- Standard terms without aggressive overreach

**Level 3 (Score: 50 pts) - Standard Corporate**
Trigger if document mentions:
- "binding arbitration" + "opt-out" + ["30 days" OR "60 days" OR specific window]
- "arbitration agreement" + "may opt out by" + [clear instructions]
- "individual arbitration" (no class action) BUT small claims preserved
- "indemnification" (standard commercial language)
- "reasonable venue" OR "convenient jurisdiction"
- "changes effective" + ["30 days notice" OR "upon posting"]
- "AS IS" warranty disclaimers (standard)

**Level 4 (Score: 75 pts) - User-Unfriendly**
Trigger if document mentions:
- "mandatory arbitration" + NO opt-out mentioned
- "binding arbitration" (no opt-out or exception)
- "class action waiver" OR "no class actions" OR "waive right to class action"
- "jury trial waiver" OR "waive right to jury trial"
- "broad indemnification" + "defend and hold harmless" + user obligations
- "unilateral" + "change" OR "modify" + "without notice"
- "changes effective immediately"
- Inconvenient jurisdiction (e.g., Delaware for non-US users)

**Level 5 (Score: 100 pts) - Rights-Stripping**
Trigger if document mentions ANY of:
- "mandatory binding arbitration" + "class action waiver" + "jury trial waiver" 
  (triple threat - all three together)
- "perpetual, worldwide, irrevocable license" + "user content" + NO compensation
- "governing law" + [hostile/unreasonable jurisdiction with no user connection]
- "zero liability" OR "no liability" OR "maximum liability: $0"
- "unlimited indemnification" OR user must pay company's legal fees (unrestricted)
- "changes without notice" + "effective immediately" + "continued use = acceptance"
- "unilateral termination" + "without cause" + "no refund"
- "we may" + "modify, suspend, discontinue" + "without liability"
- "all disputes" + [specific arbitration firm] + "company's location only"
- "waive all rights" (blanket waiver)

---
# CALCULATIONS & FINAL LEVEL

**Step 1: Weighted Sum**
\`Numeric Total = (Collection * 0.25) + (Sharing * 0.25) + (Control * 0.20) + (Longevity * 0.15) + (Legal * 0.15)\`
Round the total to the nearest whole number. Use standard rounding rules:
Decimal ≥ 0.5 → round up
Decimal < 0.5 → round down

Assign Final Safety Level
Map the Numeric Total to the Safety Level using this EXACT table:
0 – 19 → Exemplary (Very low risk)
20 – 39 → Acceptable (Low risk)
40 – 59 → Concerning (Moderate risk)
60 – 79 → Risky (High risk)
80 – 100 → Dangerous (Very high risk)
# PURPOSE-AWARE SCORING GUIDANCE

When justifying scores, consider whether data practices align with reasonable expectations for the service type:

**Reasonable Alignments:**
- Health app collecting health data (IF properly secured and not sold)
- Photo app requesting camera access
- Navigation app using location services
- Messaging app collecting contact lists for friend-finding (IF opt-in)
- Cloud storage retaining data "as long as account active"

**Misalignments (Flag in Justification):**
- Flashlight app requiring contact list access
- Calculator app tracking cross-site browsing
- E-reader claiming perpetual license to user notes
- Meditation app selling health data to advertisers
- News site requiring biometric authentication

**In Justifications:**
- Quote the clause
- Assign the level based on the clause rubric (DO NOT adjust the score)
- Note: "This practice [aligns / does not align] with reasonable expectations for a [product type]"


  # OUTPUT FORMAT (STRICT JSON)

  {
    "summary": "2-3 sentence neutral summary.",
    "reading_level": "Grade 8|Grade 10|Grade 12+",
    "scores": {
      "overall": 0-100,
      "final_level": "Level X (Descriptor)",
      "breakdown": {
        "data_collection": 0-100,
        "data_sharing": 0-100,
        "user_control": 0-100,
        "data_longevity": 0-100,
        "legal_integrity": 0-100
      }
    },
    "justifications": {
      "data_collection": "...",
      "data_sharing": "...",
      "user_control": "...",
      "data_longevity": "...",
      "legal_integrity": "..."
    }
  }

  Output JSON ONLY. No markdown.

# FINAL REMINDERS

- You MUST use exact numeric values: 5, 25, 50, 75, 100 (no other numbers allowed)
- You MUST quote verbatim from the document
- You MUST list all detected clause types even when applying worst-case rule
- You MUST explain purpose alignment without changing scores
- You MUST flag vague or missing sections
- You MUST output valid JSON only (no markdown, no commentary)

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
