# ClearTerms Chrome Extension (MVP)

ClearTerms helps surface Terms of Service and Privacy Policy pages the moment you land on them. In this PR-focused MVP, the extension:

- Scans the active tab with heuristics (URL, text keywords, action buttons) to determine if the page looks like a legal document.
- Passes the detection state from `content.js` → `background.js` → the popup, tracking state per tab.
- Prompts the user for explicit consent before any future analysis work begins.

This version does **not** run AI analysis yet—it only lays the detection + consent foundation described in the PRD.

## Run the Extension Locally (Chrome)

1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select this project folder (the one containing `manifest.json`).
4. Open the popup on any site and navigate to a Terms/Privacy page. The popup will show the detection state and consent actions.

## Development Notes

- `content.js` performs lightweight DOM scans and sends detection messages to the background script.
- `background.js` stores detection + consent per tab so the popup always reflects the latest state.
- `popup.js` requests the detection state for the active tab and renders either the consent UI or the fallback “no legal document detected” view.

Future PRs (per the PRD) will plug analysis, AI prompts, and richer UI states into this baseline.
