# Verification record

Run in this workspace using Node.js 24.19.0:

- Dependency-free preview builds successfully; 39 automated checks pass, including P1 category phrases, the exact P2 destination and test marker, configurable preview navigation, dock-shell bounds, and suppression cleanup, guided-only reminder visibility, close sequencing/window targeting, retry after navigation failure, graceful closure failure, duplicate-navigation prevention, and the minimal completion view.
- The production build's missing-configuration guard was exercised: it rejects the build and lists the required setting names, without fabricating a configured package.
- Automated checks cover assignment/PID parsing, domain restrictions, tracking gates, telemetry URL cleanup, P2 join fields, registration timing/retries, mismatched/legacy sessions, live-cart revalidation, explicit/idempotent completion, final-event failure recovery, worker restart, empty carts, explicit stop, post-final suppression, sender authorization and synchronous side-panel opening invocation.
- Build checks validate manifest resources/permissions, parse compiled bundles, transform every TypeScript source for syntax, and check panel element IDs and chat-only guidance.

Run `npm run build:preview` followed by `npm test` to reproduce and see the current test count. These are Node tests using mocked Chrome APIs, not real browser/API executions.

Not performed: live Chrome/Amazon testing, visual/accessibility QA in Chrome, production dependency installation/type-check/bundling, authenticated registration, warehouse receipt, Qualtrics end-to-end testing, or Store submission/review. No usable local Chromium binary or backend settings were available here. Outer-dock tests use a simulated DOM and do not establish that current Amazon markup is covered. The public P2 page could not be inspected through web access; its destination is configured and tested from the researcher-supplied link, not verified by survey submission.

No changes were made to the uploaded Qualtrics JSON or remote services.
