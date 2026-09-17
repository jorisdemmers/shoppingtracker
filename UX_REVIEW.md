Version 2.0.3 addendum: live-Chrome retest of the classic arm on real Amazon (amazon.com, Sept 2026) found the "empty assistant shell" risk flagged below was real, not a heuristic false-negative. Root-caused and fixed; see incident writeup at the end of this file.

Version 2.0.2 addendum: explicit Alexa reminder in guided chat; close panel after P2 handoff with a completion-only fallback. See LOCAL_TESTING.md for the separate preview tester page.

# UX review and next steps — 2.0.1

## Findings and changes

| Finding | Action | Evidence / remaining check |
| --- | --- | --- |
| The bottom-left study launcher occupies the Alexa input area | Replaced the fixed overlay with a compact strip in normal page flow above Amazon | Confirm typing/sending in both chat arms with the panel open and closed |
| Classic retains an empty assistant shell | Added bounded parent-dock detection and use of an explicitly labelled close control inside that dock | Heuristic based on known assistant descendants; live shell/gutter removal remains unverified |
| Panel shows all completion controls while still shopping | Product selection and confirmation appear after a cart snapshot arrives | Keeps the successful explicit-selection flow |
| P1 uses category phrases the parser rejected | Normalize the three known P1 phrases to canonical category names/budgets | Automated checks cover all three actual export values |
| P2 was disconnected in preview | Researcher-supplied P2 now opens after confirmation; all join fields passed | P2 embedded-data fields and saved response require a live test |
| A screenshot shows registration failure | Preserve failure visibility; do not assume that run is valid | Copy the full dummy URL from LOCAL_TESTING.md, reset between arms, and verify task/ID before testing |

## Design recommendation

Keep the explicit cart choice and confirmation. Do not infer task completion from any nonempty cart. The panel should be easy to find, but need not occupy screen space throughout browsing. Identical neutral close/reopen guidance is shown in all arms; only chat contains assistant-use encouragement. Chrome's own close control remains available. Do not add extra required tutorial or confirmation steps unless the next pilot exposes a specific failure.

The screenshots also show prices in EUR while the task uses a dollar budget. Standardize participant marketplace/currency instructions before the pilot, or define how the budget is interpreted; the extension does not convert prices or validate budget compliance. Alexa also shows a profile-selection prompt. Confirm assistant access with the recruited account/locale setup; being signed into Amazon alone does not establish assistant usability.

The header/card appearance suggests an Edge-family browser, but this is not verified. Run the acceptance test in the browser specified to participants (Chrome), and test other supported browsers separately if you intend to include them.

## Required next steps

1. Reload/load the new local-preview folder, refresh Amazon, reset the preview, and retest all three arms. Check complete classic suppression and actual query submission, not just assistant visibility. If an empty gutter remains, obtain the dock element and relevant parent attributes from DevTools; do not guess page-wide margins.
2. Run the cart-to-P2 path. P2 must declare PROLIFIC_PID, arm, category, budget, session_id and webmunk_test as URL-supplied embedded data. Test marker values do not automatically prevent recording or remove data. Keep test responses out of analysis.
3. Ask Jairo to restore the existing Firebase/Jitsu client configuration, install production dependencies, type-check/build, and verify server authorization plus actual stored events and session linkage. The explicit P2 URL replaces reliance on the last Remote Config survey entry.
4. Have several people unfamiliar with the task complete it without coaching, on a small laptop window as well as a larger display. Keep worker DevTools closed during part of testing.
5. Package and submit the configured production build only after those checks. Recheck the Store-installed update before recruiting. Never upload local-preview as the participant build.

## Limits

39 automated checks pass. They use mocked Chrome APIs and a small simulated DOM. No live Amazon DOM inspection, Qualtrics response submission, backend delivery verification or Chrome Store submission was performed. The existing uploaded P1 export and remote surveys were not modified.

## Incident — classic-arm assistant not suppressed on live Amazon (fixed in 2.0.3)

First live-Chrome walkthrough of `arm=classic` on real amazon.com surfaced the exact risk this document had marked unverified ("Heuristic based on known assistant descendants; live shell/gutter removal remains unverified"). Two distinct gaps, found by inspecting the live DOM directly rather than guessing:

1. **Dock gutter is on `<body>`, not a descendant panel.** Amazon reserves the Rufus panel's space by writing docking classes and inline padding directly onto `document.body` (e.g. `rufus-docked-left` + `style="padding-left: 320px"`), plus custom properties (`--rufus-docked-panel-width`, etc.). `AssistantControl.ts`'s edge-panel heuristic deliberately never touches `body` (to avoid ever hiding the whole page), so this gutter was completely outside what it could clear — suppressing the inner panel content left a matching blank space at the page edge.
2. **Trigger control wasn't in the selector list.** The live trigger is `<button id="nav-rufus-disco" aria-label="Open Alexa panel">` wrapping two child `<div>`s (`nav-rufus-disco-avatar`, `nav-rufus-disco-text`). None of `id`, `class`, or `aria-label` matched the existing `ASSISTANT_SELECTORS` list or button-label regex, so the icon stayed visible and clickable in classic.

Fix (`src/content/AssistantControl.ts`):
- Added `clearBodyDock()`: strips the known `rufus-docked-*` classes and their associated inline padding/custom-property styles from `document.body` when present, and clears the `rufus:panel:dockedState` session/local-storage key Amazon's own bootstrap script reads on load (otherwise it re-applies the docked state on the next navigation before the content script can react). Original body class/style is restored when leaving classic.
- Widened `ASSISTANT_SELECTORS` to `[id^="nav-rufus-disco"]` / `[class^="nav-rufus-disco"]` (prefix match, covers the button and both child divs) and widened the button-label regex to also match "Open Alexa"/"Open Rufus (panel)" phrasing.
- Added a regression test (`tests/assistant.test.mjs`) asserting body-level docked classes and padding are cleared.

Verified live in Chrome after the fix: the icon and "for shopping" label are gone, no residual gutter, ordinary page padding restored. Not yet re-verified: the same check on other Amazon locales, on dynamically-loaded/lazy Rufus mounts, or after Amazon changes this markup again — selector drift on a live third-party site is an ongoing risk, not a one-time fix. Continue with the rest of Section B of LOCAL_TESTING.md (both chat arms, other categories, resize/zoom) before treating classic as fully verified.
