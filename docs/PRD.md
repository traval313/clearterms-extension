# Product Requirements Document

## ClearTerms Chrome Extension
**Tagline:** An AI-powered tool for understanding Terms of Service and privacy agreements.

### Overview
ClearTerms is a Chrome extension that helps users interpret and evaluate Terms of Service (ToS), privacy policies, and similar legal agreements directly from the web pages they visit. The extension extracts the legal text, translates dense legal language into plain explanations, and highlights clauses that may raise concerns about data privacy, user rights, or legal obligations. ClearTerms serves an informational and educational purpose only; it is not a replacement for professional legal advice. The MVP scope focuses on analyzing digital agreements found on websites with a client-side-first architecture that emphasizes explainability and ethical AI use.

### Product Goals
- Build a functional Chrome extension that can extract legal text from webpages, process it with AI, and display structured results inside a clear interface.
- Keep the architecture simple, modular, and extensible for future enhancements.
- Ensure all outputs are explainable and traceable to source text.
- Avoid persistent data storage or any form of user tracking.

### High-Level System Architecture
`Webpage (ToS / Privacy Policy)` → `content.js` → `background.js` → `LLM API` → `popup.js / popup.html`

### Repository Structure
```
project-root/
├── manifest.json
├── popup.html
├── popup.js
├── popup.css
├── content.js
├── background.js
└── docs/
    ├── PRD.md
    └── README.md
```

### File Responsibilities
- **manifest.json**: Defines extension metadata, declares permissions and scripts, and specifies the background service worker plus content scripts. Requires permissions for `activeTab`, `scripting`, `storage`, and `host_permissions` covering all URLs.
- **content.js**: Runs in the context of the active webpage, detects whether the page likely contains ToS or privacy policy content via URL/keyword heuristics, extracts visible text, and sends it to `background.js` through message passing.
- **background.js**: Acts as the central coordinator and API handler, receiving document text from `content.js`, formatting requests to the LLM API, managing API authentication securely, parsing responses into structured JSON, and returning the results to `popup.js`.
- **popup.html**: Provides the UI container (Analyze button, Summary section, Risk flags section, disclaimer) with a vertically scrollable layout that clearly separates the summary and flagged clauses.
- **popup.js**: Handles UI logic and interactions, triggers analysis when legal document text is detected or on user action, requests extracted text via background messaging, displays AI-generated summaries and flags, manages loading/error states, and renders source-linked explanations.
- **popup.css**: Styles the popup to support the required layout and readability.

### Expected API Output
```json
{
  "summary": "...",
  "risk_flags": [
    {
      "category": "Data Sharing",
      "explanation": "...",
      "source_quote": "..."
    }
  ],
  "confidence": "medium"
}
```

### End-to-End Data Flow
1. The extension monitors the active tab for signs of ToS or privacy policy content.
2. When such content is detected, the popup prompts the user to analyze the document.
3. Upon user confirmation, `popup.js` requests extraction from `content.js`.
4. `content.js` gathers visible legal text and passes it to `background.js`.
5. `background.js` constructs an LLM prompt that includes instructions plus the extracted text and forwards it to the API.
6. The LLM returns structured JSON (summary, risk flags, confidence), which flows back to `popup.js`.
7. `popup.js` renders the summary, risk flags with source quotes, and the disclaimer in `popup.html`.

### AI Prompting Requirements
- Summaries must use plain, accessible language.
- Each risky clause must be classified, include an explanation, and provide a direct source quote.
- The AI must output JSON only.
- Prompting must avoid legal-advice language or definitive guarantees.
- All responses must include the disclaimer text: “This summary is informational only and not legal advice.”

### UI Requirements
- Popup includes an Analyze button, summary section, risk flag section, and disclaimer area.
- Layout supports vertical scrolling with clear separation between summary content and flagged clauses.
- Source-linked explanations should allow users to trace findings back to the extracted text.

### Non-Functional Considerations
- Operate primarily client-side, minimizing backend dependencies.
- No persistent storage of user data or tracking of user activity.
- Ensure explainability and the ability to trace outputs back to source excerpts.

