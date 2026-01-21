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
4. Click the ClearTerms toolbar icon and, on first run, paste your Gemini API key into the popup when prompted.
5. Open the popup on any site and navigate to a Terms/Privacy page. The popup will show the detection state, capture progress, and Gemini analysis once ready.

## Configure Gemini API access

1. Load the extension and click the ClearTerms icon to open the popup.
2. Enter your Gemini API key in the "API key required" screen and click **Save key**.
3. The key is stored only in `chrome.storage.local`; it never touches this repository or a remote server.
4. Use the **Reset API key** link in the popup at any time to delete the saved key and switch accounts.

## Development Notes

- `content.js` performs lightweight DOM scans and sends detection messages to the background script.
- `background.js` now owns extraction state plus the Gemini request lifecycle (including JSON validation and error handling).
- `popup.js` requests the detection state for the active tab and renders detection, extraction, and AI analysis states in one place.

### Example ClearTerms AI Outputs

<img height="300" alt="image" src="https://github.com/user-attachments/assets/56c64f74-f625-4c83-9ad7-6e16c07c5bab" /> <img height="300" alt="image" src="https://github.com/user-attachments/assets/e2d61f85-3f6e-46b2-a128-368d0bd2d69c" />

