# ClearTerms Chrome Extension (MVP)

ClearTerms helps surface Terms of Service and Privacy Policy pages the moment you land on them. In this PR, the extension now:

- Scans the active tab with heuristics (URL, text keywords, action buttons) to determine if the page looks like a legal document.
- Extracts the visible legal text (after the user grants consent) and passes it to the background service worker.
- Calls the Gemini API with a deterministic, JSON-only prompt that summarizes the document and scores privacy risk across six categories.
- Renders the summary, category scores, and any confidence notes directly inside the popup, surfacing descriptive errors if Gemini cannot respond.

## Run the Extension Locally (Chrome)

1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select this project folder (the one containing `manifest.json`).
4. Create a `config.json` file (see below) that stores your Gemini API key.
5. Open the popup on any site and navigate to a Terms/Privacy page. The popup will show the detection state, capture progress, and Gemini analysis once ready.

## Configure Gemini API access

1. Copy `config.example.json` to `config.json` in the project root.
2. Replace `YOUR_API_KEY_HERE` with a valid Gemini API key (kept private—`config.json` is ignored by git).
3. Reload the extension in `chrome://extensions/` whenever you change the key so the background worker reads the updated config.

## Development Notes

- `content.js` performs lightweight DOM scans and sends detection messages to the background script.
- `background.js` now owns extraction state plus the Gemini request lifecycle (including JSON validation and error handling).
- `popup.js` requests the detection state for the active tab and renders detection, extraction, and AI analysis states in one place.
