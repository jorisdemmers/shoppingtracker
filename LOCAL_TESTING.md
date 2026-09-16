# Test locally before Store review

## A. Load the ready-made preview — no terminal or backend needed

1. Extract the ZIP to a normal folder. Keep it there while testing: Chrome loads unpacked code from that folder.
2. Use current desktop Chrome (minimum 116). Prefer a separate test Chrome profile. Disable any existing Webmunk Store version in that profile; do not run both copies. Sign into Amazon in the new profile if needed.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the extracted **local-preview** folder containing `manifest.json` — NOT the source root or ZIP.
4. Verify its name says **Webmunk Shopping Study — LOCAL PREVIEW**. Pin its icon using Chrome’s puzzle-piece menu. Open it once to check the side panel and preview notice.
5. Copy this test URL into a new tab’s address bar:

   ```text
   https://www.amazon.com/?PROLIFIC_PID=0123456789abcdef01234567&arm=classic&category=Headphones
   ```

   This dummy PID is for LOCAL PREVIEW only. It creates no Firebase registration or Jitsu events. Amazon itself still has normal network traffic; adding/removing cart products changes your real Amazon account’s cart.

6. Click **Open study panel** in the strip at the top of Amazon. It should show the dummy PID, Headphones and $350 without a PID-confirmation step. If that button fails, try the toolbar icon too and report which failed. Chrome requires an initial click; arrival alone does not open the panel.
7. Sign into Amazon if requested. Search, open several products, click outside the panel, and navigate back/forward. The panel should remain open. Deliberately close and reopen it: it should retain the session.
8. Add your selected product to the cart. **Do not check out or buy anything.** Click **Review my cart**. Wait for rows or use **Refresh cart list**. Compare title, ASIN and price against Amazon. If rows are missing/wrong, stop and report the page; do not bypass the check.
9. Select the product’s radio button, check the confirmation box, then click **Confirm choice and continue**. Tracking should stop. After P2 opens, the panel should close on Chrome 141+. If it remains open or you reopen it, it must show only “Shopping task completed.” P2 should open at https://uva.fra1.qualtrics.com/jfe/form/SV_dm4HvTdtNMHXymO with PID, arm, category, budget, session_id and webmunk_test=1 in the URL. This is a real Qualtrics link and may create test responses. Add embedded fields in P2 to retain these values; the test marker does not automatically exclude records. The preview still sends no Firebase/Jitsu data.
10. After completion the participant panel has no controls. To export events or reset the preview, use its separate tester page: enable Developer mode at `chrome://extensions`, copy the LOCAL PREVIEW extension ID, and open `chrome-extension://YOUR_EXTENSION_ID/popup/preview-tools.html` in a tab. Replace YOUR_EXTENSION_ID with the actual ID. This page exists only in the preview build. Click **Download local test events**. Browse/search Amazon again, then download again: no new behavioral events should appear after completion. Check the same session ID throughout, correct condition/category, one `final_choice_confirmed` and one `session_summary`.

These are [Chrome’s standard unpacked-install steps](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world). The opening/persistence behavior is documented in the [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

## B. Repeat the experimental conditions

Version 2.0.2 retest: in `chat`, the reminder must explicitly say “Amazon’s Alexa AI shopping assistant”; neither other arm should show it. Confirm a product and check that P2 opens before the panel closes. Reopening the panel should show only the completion message. On older Chrome without the close API, that message is the fallback. Automatic closing and real browser rendering still require manual verification.

For this update, first check: (1) classic has no Alexa panel, header, close button or leftover gutter; (2) both chat arms allow typing and sending a query with the study panel open and closed; (3) the bottom-left overlay is gone; (4) the panel displays a valid task rather than a registration error. Test normal and small laptop windows at 100% and 125% zoom. If the classic gutter remains, the live dock markup is needed; do not treat an empty shell as a passed test.

The full panel can be closed for browsing; reopening from the page strip or pinned toolbar icon preserves the session. Keep procedural guidance the same in every condition.

Reset clears the optional P2 override and restores the supplied default URL. To keep a run entirely local, clear the URL in Preview tools and save it after each reset.

Before each run, download any test records you want to keep, then click **Reset preview session** in the panel before completion or on the separate tester page after completion. This clears only the preview extension’s local test records, not your Amazon cart. Close old Amazon test tabs, then open the new URL; otherwise an old handoff URL can re-enroll you.

Use the URL above, replacing `arm=classic`:

| Parameter | Verify manually |
| --- | --- |
| `arm=classic` | No usable assistant on home, results, product or cart pages, including dynamically loaded controls. Ordinary Alexa/Echo products remain visible. |
| `arm=chat_no_guide` | Assistant is not hidden by Webmunk; no assistant-use prompt in the panel. Check Amazon/account availability separately. |
| `arm=chat` | Assistant remains available and the explicit prompt appears. Submit a question and verify assistant-text events, not arbitrary form drafts. |

P1 values `new Headphones`, `a new Backpack`, and `a new Robot Vacuum` are also supported and normalized.

Also test `category=Backpack` ($150) and `category=Robot%20Vacuum` ($500), resetting between runs. A useful minimum is all 3 arms × all 3 categories, then a small pilot with people unfamiliar with the study. Use the Amazon locale/accounts you will recruit; a US test does not establish other-locale support.

## C. Failure cases and debugging

- After reset, browse without a handoff URL: no behavioral recording.
- Omit PID, arm or category: visible setup error, not a default chat assignment.
- Change PID/arm without reset: stops with a mismatch error.
- Start signed out, sign in, then sign out again: no final confirmation while signed out.
- Empty cart: cannot finish. Pre-existing nonempty cart: no automatic finish. Multiple products: explicit selection required.
- Select a product, remove it in Amazon, then try confirming the old selection: reject on live revalidation.
- Close/reopen panel, switch tabs, resize Chrome and use 125% zoom: all buttons remain usable.
- Reload extension mid-task, then refresh Amazon too: session should survive. Reload replaces stale content scripts.
- Finish, then revisit original handoff: no tracking restart. **Stop shopping task** also stops subsequent behavioral events.
- Leave service-worker DevTools closed for part of the run: inspecting the worker can keep it awake and hide lifecycle bugs.

For errors: `chrome://extensions` → preview card → **Errors** or **Inspect views: service worker**. Inspect Amazon for content-script errors. Keep error text, Chrome version, locale, arm and stage; redact personal account details. [Chrome debugging guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug).

After source edits: rebuild, reload the extension, refresh every Amazon test tab, and reopen the panel. Editing TypeScript alone does not change the compiled files.

## D. Validate the real backend and P2 before recruitment

Preview can exercise the P2 handoff, but does not validate Firebase/Jitsu delivery. Verify saved Qualtrics fields and survey completion yourself.

1. Obtain the existing public Firebase client settings and scoped Jitsu ingestion settings from the maintainer; put them in `.env` using `.env.example`. No admin/server keys. The researcher-supplied P2 is already configured in `src/shared/StudyConfig.ts`; optional `FINAL_SURVEY_URL` overrides it at build time. No Remote Config ordering is required.
2. With Node.js 24+, open a terminal in the source folder and run:

   ```sh
   npm install
   npm run check
   npm run build
   ```

   Resolve type/dependency/build errors first. These production steps were not run here: settings/dependencies are missing from the export.
3. Disable the preview in your test profile; load **production-build/** unpacked. Its name must not say LOCAL PREVIEW. Do not upload yet.
4. Use an authorized test participant/session, ideally staging or the maintainer’s test-ID procedure. Do not send the preview dummy PID to the real backend without agreement. Start from the actual P1 flow.
5. If Qualtrics checks a hard-coded extension ID, retain it by setting `EXTENSION_PUBLIC_KEY` to the existing Store item’s **public key** and rebuilding. Alternatively use a private survey test copy set up for the test ID; do not bypass the live survey check. [Chrome key instructions](https://developer.chrome.com/docs/extensions/reference/manifest/key).
6. Complete the task: P1 submits normally, Amazon opens, P2 opens only after explicit confirmation. Verify the URL AND saved P2 fields have PID, arm, category, budget and the events’ session ID.
7. Verify actual warehouse/database rows: condition/identity, assistant text where appropriate, final ASIN/title/price, one summary, no new post-confirmation shopping events. Local success/outbox emptiness is not proof of delivery. Test offline recovery and server-side `event_id` deduplication.
8. Review schema version 3/session-level summaries with the analyst; check consent/privacy disclosures. Retain the dependency lockfile used for your pilot. Only then ZIP the contents of **production-build/** for review. Never submit the source archive or preview.

Live Chrome panel behavior, Amazon DOM/assistant coverage, login detection across locales, cart/variant/price extraction, Firebase/Jitsu delivery and P2 submission all still require these manual/integration checks. Automated tests do not guarantee Store approval.
