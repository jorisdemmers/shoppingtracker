# Verification record

2.0.4: added two simulated-DOM checks for the supplied inline-widget root: whole-root suppression without touching a narrow page ancestor, and preservation/restoration when suppression is disabled. Live Amazon coverage still requires the focused retest in LOCAL_TESTING.md.

Run in this workspace using Node.js 24.19.0:

- Dependency-free preview builds successfully; 42 automated checks pass, including P1 category phrases, the exact P2 destination and test marker, configurable preview navigation, dock-shell bounds, body-level dock-gutter clearing, and suppression cleanup, guided-only reminder visibility, close sequencing/window targeting, retry after navigation failure, graceful closure failure, duplicate-navigation prevention, and the minimal completion view.
- First live-Chrome walkthrough of `arm=classic` on real amazon.com (2026-09) found the assistant trigger (`#nav-rufus-disco`) and its body-level docking gutter were not suppressed; root-caused and fixed in 2.0.3. See UX_REVIEW.md incident section. `npm run check` was also run for the first time here and found 81 pre-existing TypeScript errors (traced to the pinned `@types/chrome@0.1.43` devDependency mistyping `chrome.storage.local.get(null)`); not fixed, left for the maintainer to triage.
- The production build's missing-configuration guard was exercised: it rejects the build and lists the required setting names, without fabricating a configured package.
- Automated checks cover assignment/PID parsing, domain restrictions, tracking gates, telemetry URL cleanup, P2 join fields, registration timing/retries, mismatched/legacy sessions, live-cart revalidation, explicit/idempotent completion, final-event failure recovery, worker restart, empty carts, explicit stop, post-final suppression, sender authorization and synchronous side-panel opening invocation.
- Build checks validate manifest resources/permissions, parse compiled bundles, transform every TypeScript source for syntax, and check panel element IDs and chat-only guidance.

Run `npm run build:preview` followed by `npm test` to reproduce and see the current test count. These are Node tests using mocked Chrome APIs, not real browser/API executions.

Not performed: live Chrome/Amazon testing, visual/accessibility QA in Chrome, production dependency installation/type-check/bundling, authenticated registration, warehouse receipt, Qualtrics end-to-end testing, or Store submission/review. No usable local Chromium binary or backend settings were available here. Outer-dock tests use a simulated DOM and do not establish that current Amazon markup is covered. The public P2 page could not be inspected through web access; its destination is configured and tested from the researcher-supplied link, not verified by survey submission.

No changes were made to the uploaded Qualtrics JSON or remote services.
