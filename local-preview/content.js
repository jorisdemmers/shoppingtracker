(function(){"use strict";const __modules={
0:function(module,exports,__require){
const { Content } = __require(1);
new Content().initialize();

Object.assign(exports, {});
},
1:function(module,exports,__require){
const { NotificationService } = __require(2);
const { Event } = __require(3);
const { debug } = __require(4);
const { isShoppingUrl, isCartUrl, parseAssignment } = __require(5);
const { AssistantControl, ASSISTANT_SELECTORS, isVisible } = __require(6);
class Content {
    notificationService;
    isTopFrame = window === window.top;
    arm = null;
    assistantControl = new AssistantControl();
    contextOrigin = null;
    contextExpiresAt = 0;
    hasStudyContext = false;
    assistantObserver = null;
    banner = null;
    pageCaptured = false;
    lastAssistantCapture = 0;
    RUFUS_CAPTURE_THROTTLE_MS = 1500;
    lastAssistantPayloadHash = null;
    assistantAvailableSent = false;
    lastSearchSent = 0;
    SEARCH_THROTTLE_MS = 2000;
    lastAssistantLeakTs = 0;
    ASSISTANT_LEAK_THROTTLE_MS = 10000;
    lastFilterSent = 0;
    FILTER_THROTTLE_MS = 1200;
    lastCartSnapshotTs = 0;
    lastCartSnapshotHash = '';
    CART_SNAPSHOT_THROTTLE_MS = 3000;
    taskStage = null;
    amazonLoginConfirmed = false;
    loginBlockActive = false;
    loginGuardTimer = null;
    LOGIN_GUARD_INTERVAL_MS = 1200;
    normalizePrice(raw) {
        return raw.replace(/\s+/g, '').replace(/(\.\.)+/g, '.').trim();
    }
    extractProductInfoFromDocument() {
        const titleEl = document.querySelector('#productTitle') || document.querySelector('.product-title-word-break') || document.querySelector('h1.a-size-large');
        const rawTitle = titleEl?.innerText || '';
        const title = rawTitle.replace(/\s+/g, ' ').trim() || undefined;
        const priceContainer = document.querySelector('.reinventPricePriceToPayMargin') || document.querySelector('.a-price');
        let price;
        if (priceContainer) {
            const symbol = priceContainer.querySelector('.a-price-symbol')?.innerText?.trim() || '';
            const whole = priceContainer.querySelector('.a-price-whole')?.innerText?.trim() || '';
            const fraction = priceContainer.querySelector('.a-price-fraction')?.innerText?.trim() || '';
            const combined = this.normalizePrice(`${symbol}${whole}${fraction ? '.' + fraction : ''}`);
            const offscreen = this.normalizePrice(priceContainer.querySelector('.a-offscreen')?.innerText?.trim() || '');
            price = combined || offscreen || undefined;
        } else {
            price = document.querySelector('.a-price .a-offscreen')?.innerText?.trim() || document.querySelector('#priceblock_ourprice')?.innerText?.trim() || document.querySelector('#price_inside_buybox')?.innerText?.trim() || undefined;
        }
        const brand = document.querySelector('#bylineInfo')?.innerText?.trim() || document.querySelector('.po-brand')?.innerText?.trim() || undefined;
        return {
            title,
            price,
            brand
        };
    }
    extractProductInfoFromCartItem(container) {
        const title = container.querySelector('.sc-product-title')?.innerText?.trim() || container.querySelector('.sc-product-link')?.innerText?.trim() || undefined;
        let price;
        const priceContainer = container.querySelector('.a-price');
        if (priceContainer) {
            const symbol = priceContainer.querySelector('.a-price-symbol')?.innerText?.trim() || '';
            const whole = priceContainer.querySelector('.a-price-whole')?.innerText?.trim() || '';
            const fraction = priceContainer.querySelector('.a-price-fraction')?.innerText?.trim() || '';
            const combined = this.normalizePrice(`${symbol}${whole}${fraction ? '.' + fraction : ''}`);
            price = combined || undefined;
        } else {
            price = container.querySelector('.sc-product-price')?.innerText?.trim() || container.querySelector('.sc-price')?.innerText?.trim() || undefined;
        }
        const brand = container.querySelector('.sc-product-brand')?.innerText?.trim() || undefined;
        const asin = container.getAttribute('data-asin') || undefined;
        return {
            title,
            price,
            brand,
            asin
        };
    }
    constructor(){
        this.notificationService = new NotificationService();
        const handoff = parseAssignment(location.href);
        if (handoff?.arm === 'classic') this.assistantControl.setEnabled(true);
        this.initStudyState();
        if (this.isTopFrame) this.addContentLoadedListener();
    }
    initialize() {
        if (!this.isTopFrame) return;
        this.addClickListener();
        this.addFilterListener();
        this.addSortListener();
        this.addResultClickListener();
        this.addCartRemoveListener();
        this.addBfcacheRestoreListener();
        chrome.runtime.onMessage.addListener((message, _sender, reply)=>{
            if (message?.type !== 'study_read_cart') return;
            reply(this.readCart());
        });
        if (document.readyState !== 'loading') this.onReady();
        else document.addEventListener('DOMContentLoaded', ()=>this.onReady(), {
            once: true
        });
        if (isShoppingUrl(location.href)) {
            chrome.runtime.sendMessage({
                type: 'study_context'
            }, ()=>{
                void chrome.runtime.lastError;
            });
        }
    }
    initStudyState() {
        const refresh = ()=>chrome.storage.local.get([
                'taskStage',
                'amazonLoginConfirmed',
                'studyContext',
                'studyError'
            ], (s)=>{
                this.taskStage = s.taskStage || 'initial';
                this.amazonLoginConfirmed = s.amazonLoginConfirmed === true;
                this.hasStudyContext = !!s.studyContext;
                this.contextOrigin = s.studyContext?.origin || null;
                this.contextExpiresAt = Number(s.studyContext?.expiresAt) || 0;
                this.arm = s.studyContext?.arm || null;
                const assignedPage = this.contextOrigin === location.origin;
                const pendingClassic = !s.studyContext && parseAssignment(location.href)?.arm === 'classic';
                this.assistantControl.setEnabled(pendingClassic || assignedPage && (this.taskStage === 'shopping' || this.taskStage === 'registering') && this.arm === 'classic');
                if (this.isTopFrame) {
                    this.reassertLoginGate();
                    this.updateStudyBanner(s.studyError || '');
                    if (this.trackingActive()) {
                        this.capturePageOnce();
                        this.captureCartBaselineIfNeeded();
                        this.captureAssistantText();
                        this.checkAssistantAvailability();
                    }
                }
            });
        refresh();
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, {
            once: true
        });
        chrome.storage.onChanged.addListener((changes, area)=>{
            if (area === 'local' && [
                'taskStage',
                'amazonLoginConfirmed',
                'studyContext',
                'studyError'
            ].some((k)=>k in changes)) refresh();
        });
        if (this.isTopFrame) {
            this.loginGuardTimer = setInterval(()=>{
                if (this.taskStage === 'shopping' && this.contextExpiresAt <= Date.now()) {
                    chrome.runtime.sendMessage({
                        type: 'study_expired'
                    }, ()=>{
                        void chrome.runtime.lastError;
                    });
                }
                this.reassertLoginGate();
                if (this.trackingActive()) {
                    this.captureCartBaselineIfNeeded();
                    this.captureCartSnapshot();
                    this.captureAssistantText();
                    this.checkAssistantAvailability();
                }
            }, this.LOGIN_GUARD_INTERVAL_MS);
        }
    }
    trackingActive() {
        return this.taskStage === 'shopping' && this.amazonLoginConfirmed && this.contextExpiresAt > Date.now() && this.contextOrigin === location.origin && !!this.arm && isShoppingUrl(location.href);
    }
    onReady() {
        this.updateStudyBanner('');
        if (!this.assistantObserver) {
            this.assistantObserver = new MutationObserver(()=>{
                if (!this.trackingActive()) return;
                this.captureAssistantText();
                this.checkAssistantAvailability();
            });
            this.assistantObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }
        this.capturePageOnce();
    }
    updateStudyBanner(error) {
        if (!document.body || !isShoppingUrl(location.href)) return;
        const show = this.hasStudyContext || !!parseAssignment(location.href) || !!error;
        if (!show || [
            'final',
            'stopped',
            'done'
        ].includes(this.taskStage || '')) {
            this.banner?.remove();
            this.banner = null;
            return;
        }
        if (!this.banner?.isConnected) {
            const box = document.createElement('aside');
            box.id = 'webmunk-study-banner';
            box.setAttribute('aria-label', 'Webmunk shopping study');
            box.style.cssText = 'position:relative;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.75rem;padding:.5rem 1rem;background:#fff;color:#222;border-bottom:2px solid #a41b33;';
            const label = document.createElement('p');
            label.style.cssText = 'margin:0;font:14px/1.4 system-ui,sans-serif;';
            label.textContent = 'Shopping study: instructions and final product confirmation';
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Open study panel';
            button.style.cssText = 'font:inherit;padding:.6em 1em;cursor:pointer;';
            button.addEventListener('click', ()=>{
                chrome.runtime.sendMessage({
                    type: 'study_open_panel'
                }, (result)=>{
                    if (chrome.runtime.lastError || !result?.ok) label.textContent = 'Click the Webmunk icon in Chrome’s toolbar to open the study panel.';
                    else label.textContent = 'You can close the study panel while shopping and reopen it here or from the Webmunk toolbar icon.';
                });
            });
            box.append(label, button);
            document.body.prepend(box);
            this.banner = box;
        }
    }
    capturePageOnce() {
        if (this.pageCaptured || document.readyState === 'loading' || !this.trackingActive()) return;
        this.pageCaptured = true;
        this.captureNavigationType(location.href);
        if (this.isProductDetailPage(location.href)) this.sendTelemetry(Event.PRODUCT_PAGE_VIEW, {
            asin: this.getAsinFromUrl(location.href)
        });
        this.captureCartSnapshot();
    }
    getAccountLink() {
        return document.querySelector('a#nav-link-accountList, #nav-link-accountList a');
    }
    getAmazonLoginState() {
        const link = this.getAccountLink();
        const href = link?.getAttribute('href') || '';
        if (href.includes('/ap/signin') || href.includes('/gp/sign-in')) return 'out';
        const greeting = (document.getElementById('nav-link-accountList-nav-line-1')?.textContent || link?.textContent || '').toLowerCase();
        if (/sign in|identify yourself/.test(greeting)) return 'out';
        if (link && href) return 'in';
        return 'unknown';
    }
    checkAmazonLoginStatus() {
        if (this.taskStage !== 'shopping' || this.contextOrigin !== location.origin || !isShoppingUrl(location.href)) return;
        const state = this.getAmazonLoginState();
        debug('[wm] checkAmazonLoginStatus', {
            state,
            href: this.getAccountLink()?.getAttribute('href') || null,
            url: window.location.href
        });
        if (state === 'unknown') return;
        try {
            chrome.runtime.sendMessage({
                type: 'amazon_login_status',
                loggedIn: state === 'in'
            });
        } catch (err) {
            console.warn('[wm] failed to report amazon login status', err);
        }
    }
    buildSignInUrl() {
        const navHref = this.getAccountLink()?.getAttribute('href') || '';
        if (navHref.includes('/ap/signin') || navHref.includes('/gp/sign-in')) {
            try {
                const candidate = new URL(navHref, window.location.href);
                if (candidate.origin === location.origin && candidate.protocol === 'https:') return candidate.href;
            } catch  {}
        }
        const origin = window.location.origin;
        const idSelect = 'http://specs.openid.net/auth/2.0/identifier_select';
        const params = new URLSearchParams({
            'openid.pape.max_auth_age': '0',
            'openid.return_to': `${origin}/`,
            'openid.identity': idSelect,
            'openid.assoc_handle': 'usflex',
            'openid.mode': 'checkid_setup',
            'openid.claimed_id': idSelect,
            'openid.ns': 'http://specs.openid.net/auth/2.0'
        });
        return `${origin}/ap/signin?${params.toString()}`;
    }
    isAmazonAuthPage() {
        const p = window.location.pathname;
        return p.startsWith('/ap/') || p.startsWith('/gp/sign-in') || p.startsWith('/gp/css/homepage.html/sign-out') || p.includes('/signin') || p.includes('/register');
    }
    dismissLoginBlockIfActive() {
        if (!this.loginBlockActive) return;
        this.loginBlockActive = false;
        this.notificationService.clearLoginBlock();
    }
    reassertLoginGate() {
        if (!isShoppingUrl(location.href) || this.contextOrigin !== location.origin || this.taskStage !== 'shopping') {
            this.dismissLoginBlockIfActive();
            return;
        }
        const state = this.getAmazonLoginState();
        const lock = state === 'out';
        if (state === 'out' && this.amazonLoginConfirmed) this.checkAmazonLoginStatus();
        if (lock) {
            this.notificationService.showLoginBlock(this.buildSignInUrl());
            if (!this.loginBlockActive) {
                this.loginBlockActive = true;
                this.sendTelemetry(Event.AMAZON_LOGIN_BLOCK_SHOWN, {
                    url: window.location.href
                });
            }
            return;
        }
        this.dismissLoginBlockIfActive();
        if (state === 'in' && !this.amazonLoginConfirmed) {
            this.checkAmazonLoginStatus();
        }
    }
    enforceLoginRequirement() {
        chrome.storage.local.get([
            'taskStage',
            'amazonLoginConfirmed'
        ], (r)=>{
            this.taskStage = r && r.taskStage || null;
            this.amazonLoginConfirmed = Boolean(r && r.amazonLoginConfirmed);
            this.reassertLoginGate();
        });
    }
    addContentLoadedListener() {
        document.addEventListener('DOMContentLoaded', ()=>{
            this.checkAmazonLoginStatus();
            this.reassertLoginGate();
            this.capturePageOnce();
        });
    }
    addClickListener() {
        window.addEventListener('click', (e)=>{
            const target = e.target;
            if (!target) return;
            const addToCartButton = target.closest('#add-to-cart-button, button#add-to-cart-button, input#add-to-cart-button');
            if (addToCartButton) {
                const url = window.location.href;
                const asin = this.getAsinFromUrl(url);
                const productInfo = this.extractProductInfoFromDocument();
                this.sendTelemetry(Event.ADD_TO_CART_CLICK, {
                    url,
                    asin,
                    ...productInfo
                });
                this.trackDecisionIfNeeded(url, asin, productInfo);
            }
        });
    }
    captureNavigationType(url) {
        try {
            const navEntry = performance.getEntriesByType('navigation')[0];
            if (!navEntry) return;
            if (navEntry.type === 'back_forward') {
                this.sendTelemetry(Event.BACKTRACK_NAVIGATION, {
                    url,
                    navigation_type: navEntry.type
                });
                return;
            }
            this.captureSearchFromUrl(url);
        } catch (err) {
            console.warn('failed to read navigation timing', err);
        }
    }
    isSearchResultsUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.pathname === '/s' || parsed.pathname.startsWith('/s/') ? parsed : null;
        } catch  {
            return null;
        }
    }
    captureSearchFromUrl(url) {
        const parsed = this.isSearchResultsUrl(url);
        if (!parsed) return;
        const query = (parsed.searchParams.get('k') || parsed.searchParams.get('field-keywords') || '').trim();
        if (!query) return;
        const now = Date.now();
        if (now - this.lastSearchSent < this.SEARCH_THROTTLE_MS) return;
        this.lastSearchSent = now;
        this.sendTelemetry(Event.SEARCH_SUBMITTED, {
            url,
            query
        });
    }
    addBfcacheRestoreListener() {
        window.addEventListener('pageshow', (event)=>{
            if (!event.persisted) return;
            const url = window.location.href;
            this.checkAmazonLoginStatus();
            this.enforceLoginRequirement();
            this.checkAssistantAvailability();
            this.sendTelemetry(Event.BACKTRACK_NAVIGATION, {
                url,
                navigation_type: 'bfcache_restore'
            });
            if (this.isProductDetailPage(url)) {
                const asin = this.getAsinFromUrl(url);
                this.sendTelemetry(Event.PRODUCT_PAGE_VIEW, {
                    url,
                    asin
                });
            }
        });
    }
    addFilterListener() {
        document.addEventListener('click', (e)=>{
            const target = e.target;
            if (!target) return;
            const now = Date.now();
            if (now - this.lastFilterSent < this.FILTER_THROTTLE_MS) return;
            const filterElement = target.closest('#s-refinements a, #s-refinements input[type="checkbox"], #s-refinements li, #s-refinements span');
            if (!filterElement) return;
            const rawText = filterElement.innerText || filterElement.getAttribute('aria-label') || filterElement.getAttribute('data-a-size') || '';
            const filterText = rawText.replace(/\s+/g, ' ').trim();
            if (!filterText) return;
            this.lastFilterSent = now;
            this.sendTelemetry(Event.FILTER_USED, {
                url: window.location.href,
                filter_type: 'refinement',
                filter_text: filterText
            });
        });
    }
    addSortListener() {
        document.addEventListener('change', (event)=>{
            const select = event.target;
            if (!select.matches?.('select#s-result-sort-select')) return;
            this.sendTelemetry(Event.FILTER_USED, {
                filter_type: 'sort',
                filter_text: select.options[select.selectedIndex]?.text?.trim(),
                filter_value: select.value
            });
        });
    }
    addResultClickListener() {
        document.addEventListener('click', (e)=>{
            const target = e.target;
            if (!target) return;
            const link = target.closest('a[href*="/dp/"]');
            if (!link) return;
            const container = link.closest('[data-component-type="s-search-result"]');
            if (!container) return;
            const href = link.getAttribute('href') || '';
            const absoluteUrl = href.startsWith('http') ? href : `${window.location.origin}${href}`;
            const asin = this.getAsinFromUrl(absoluteUrl);
            const title = container.querySelector('h2 span')?.innerText?.trim() || (link.innerText || '').trim() || undefined;
            this.sendTelemetry(Event.PRODUCT_RESULT_CLICK, {
                url: window.location.href,
                target_url: absoluteUrl,
                asin,
                title
            });
        });
    }
    trackDecisionIfNeeded(url, asin, productInfo) {
        chrome.storage.local.get([
            'decisionTracked',
            'shoppingTaskStartedAt',
            'amazonLoginConfirmed',
            'taskStage'
        ], (result)=>{
            const alreadyTracked = Boolean(result.decisionTracked);
            if (alreadyTracked) {
                return;
            }
            const taskStarted = result.taskStage === 'shopping' && this.trackingActive();
            if (!taskStarted || !result.amazonLoginConfirmed) {
                this.sendTelemetry(Event.PRE_TASK_ACTIVITY_SUPPRESSED, {
                    suppressed_event: Event.DECISION_MADE,
                    reason: !taskStarted ? 'not_registered' : 'not_logged_in',
                    url,
                    asin
                });
                return;
            }
            const startedAt = Number(result.shoppingTaskStartedAt || 0);
            const now = Date.now();
            const latencyMs = startedAt > 0 ? Math.max(0, now - startedAt) : null;
            this.sendTelemetry(Event.DECISION_MADE, {
                url,
                asin,
                decision_latency_ms: latencyMs,
                decision_definition: 'first_add_to_cart_click_not_final_choice',
                ...productInfo
            });
            chrome.storage.local.set({
                decisionTracked: true,
                decisionMadeAt: now
            });
        });
    }
    addCartRemoveListener() {
        document.addEventListener('click', (e)=>{
            const target = e.target;
            if (!target) return;
            const deleteButton = target.closest("input[name^='submit.delete'], button[data-action='a-stepper-decrement']");
            if (!deleteButton) return;
            const container = deleteButton.closest('#sc-active-cart .sc-list-item');
            if (!container) return;
            const info = this.extractProductInfoFromCartItem(container);
            setTimeout(()=>{
                const { text: subtotal, amount: subtotal_amount } = this.extractCartSubtotalDetails();
                this.sendTelemetry(Event.CART_REMOVE, {
                    url: window.location.href,
                    ...info,
                    subtotal,
                    subtotal_amount
                });
            }, 300);
        });
    }
    extractCartSubtotal() {
        const el = document.querySelector('#sc-subtotal-amount-activecart') || document.querySelector('.sc-subtotal-activecart') || document.querySelector("[data-name='Subtotals'] .a-size-medium");
        const txt = el?.innerText?.trim() || '';
        return txt || null;
    }
    extractCartSubtotalDetails() {
        const text = this.extractCartSubtotal();
        if (!text) {
            return {
                text: null,
                amount: null
            };
        }
        const match = text.match(/^\s*\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)\s*$/);
        return {
            text,
            amount: match ? Number(match[1].replace(/,/g, '')) : null
        };
    }
    extractCartItemCountBadge() {
        const el = document.querySelector('#nav-cart-count') || document.querySelector('#nav-cart-count-container') || document.querySelector('[data-csa-c-content-id="nav-cart-count"]');
        const raw = el?.innerText?.trim() || el?.getAttribute('aria-label') || '';
        const match = raw.match(/\d+/);
        if (!match) return null;
        const count = parseInt(match[0], 10);
        return Number.isFinite(count) ? count : null;
    }
    captureCartBaselineIfNeeded() {
        chrome.storage.local.get([
            'cartBaselineCaptured',
            'amazonLoginConfirmed',
            'taskStage',
            'cartBaselineSuppressionLogged'
        ], (result)=>{
            if (result.cartBaselineCaptured) {
                return;
            }
            const taskStarted = result.taskStage === 'shopping' && this.trackingActive();
            if (!taskStarted || !result.amazonLoginConfirmed) {
                if (!result.cartBaselineSuppressionLogged) {
                    this.sendTelemetry(Event.PRE_TASK_ACTIVITY_SUPPRESSED, {
                        suppressed_event: Event.CART_BASELINE_COUNT,
                        reason: !taskStarted ? 'not_registered' : 'not_logged_in'
                    });
                    chrome.storage.local.set({
                        cartBaselineSuppressionLogged: true
                    });
                }
                return;
            }
            const count = this.extractCartItemCountBadge();
            if (count === null) {
                return;
            }
            this.sendTelemetry(Event.CART_BASELINE_COUNT, {
                url: window.location.href,
                count
            });
            chrome.storage.local.set({
                cartBaselineCaptured: true
            });
        });
    }
    readCart() {
        if (!this.trackingActive() || !isCartUrl(location.href)) return {
            ok: false,
            items: []
        };
        const root = document.querySelector('#sc-active-cart');
        if (!root) return {
            ok: false,
            items: []
        };
        const rows = Array.from(root.querySelectorAll('.sc-list-item[data-asin], [data-itemtype="active"][data-asin]'));
        const items = rows.filter((row)=>isVisible(row) && row.getAttribute('data-removed') !== 'true').filter((row)=>!Array.from(row.querySelectorAll('.sc-list-item-removed-msg')).some((el)=>isVisible(el))).map((row)=>this.extractProductInfoFromCartItem(row)).filter((item)=>item.asin && /^[A-Z0-9]{10}$/i.test(item.asin) && item.title);
        const { text: subtotal, amount: subtotal_amount } = this.extractCartSubtotalDetails();
        return {
            ok: true,
            loggedIn: this.getAmazonLoginState() === 'in',
            items,
            item_count: items.length,
            subtotal,
            subtotal_amount
        };
    }
    captureCartSnapshot() {
        if (!this.trackingActive() || Date.now() - this.lastCartSnapshotTs < this.CART_SNAPSHOT_THROTTLE_MS) return;
        const cart = this.readCart();
        if (!cart.ok) return;
        this.lastCartSnapshotTs = Date.now();
        const hash = JSON.stringify(cart);
        if (hash === this.lastCartSnapshotHash) return;
        this.lastCartSnapshotHash = hash;
        this.sendTelemetry(Event.CART_SNAPSHOT, cart);
    }
    hideAssistantIfNeeded() {
        this.assistantControl.setEnabled(this.contextOrigin === location.origin && this.taskStage === 'shopping' && this.arm === 'classic');
    }
    checkAssistantAvailability() {
        if (!this.trackingActive()) return;
        const matches = Array.from(document.querySelectorAll(ASSISTANT_SELECTORS.join(','))).filter(isVisible);
        if (this.arm === 'classic') {
            if (matches.length && Date.now() - this.lastAssistantLeakTs > this.ASSISTANT_LEAK_THROTTLE_MS) {
                this.lastAssistantLeakTs = Date.now();
                this.sendTelemetry(Event.ASSISTANT_LEAK_DETECTED, {
                    count: matches.length
                });
            }
        } else if (matches.length && !this.assistantAvailableSent) {
            this.assistantAvailableSent = true;
            this.sendTelemetry(Event.ASSISTANT_AVAILABLE);
        }
    }
    captureAssistantText() {
        if (!this.trackingActive() || this.arm !== 'chat' && this.arm !== 'chat_no_guide') {
            return;
        }
        const normalizeText = (val)=>val.replace(/\s+/g, ' ').trim();
        const now = Date.now();
        if (now - this.lastAssistantCapture < this.RUFUS_CAPTURE_THROTTLE_MS) {
            return;
        }
        const matches = document.querySelectorAll('.rufus-papyrus-turn, .rufus-papyrus-active-turn, .alexa-papyrus-turn, .alexa-papyrus-active-turn, .rufus-sections-container, .alexa-sections-container');
        if (!matches.length) {
            return;
        }
        const userTexts = [];
        const productSuggestions = [];
        const turns = [];
        const userBubbles = document.querySelectorAll('.rufus-customer-text-wrap, .alexa-customer-text-wrap, .rufus-speech-bubble, .alexa-speech-bubble');
        userBubbles.forEach((b)=>{
            const t = (b.innerText || '').trim();
            if (t && t !== '[thinking]') {
                userTexts.push(t);
            }
        });
        matches.forEach((section)=>{
            const sequenceId = section.id || section.getAttribute('data-rufus-sequenceid') || section.getAttribute('data-alexa-sequenceid') || section.getAttribute('data-csa-c-sequence-id');
            const candidates = [];
            section.querySelectorAll('p.rufus-markdown-paragraph, p.alexa-markdown-paragraph, [data-csa-c-content-id*="-markdownSection-"]').forEach((el)=>{
                const text = normalizeText(el.innerText || '');
                if (text) {
                    candidates.push({
                        el,
                        kind: 'markdown',
                        payload: {
                            text
                        }
                    });
                }
            });
            section.querySelectorAll('.rufus-asin-faceout-header .rufus-color-onyx, .alexa-asin-faceout-header .alexa-color-onyx, [data-csa-c-content-id*="-categoryHeader-"]').forEach((el)=>{
                const text = normalizeText(el.innerText || '');
                if (text) {
                    candidates.push({
                        el,
                        kind: 'header',
                        payload: {
                            text
                        }
                    });
                }
            });
            const productEls = new Set();
            section.querySelectorAll('.rufus-asin-faceout-wrapper, .alexa-asin-faceout-wrapper').forEach((el)=>productEls.add(el));
            section.querySelectorAll('[data-section-class*="AsinFaceout"] [data-csa-c-asin], [data-section-class*="AsinFaceout"] [data-asin]').forEach((el)=>productEls.add(el));
            section.querySelectorAll('[data-csa-c-content-id*="-asinCard-"]').forEach((el)=>productEls.add(el));
            productEls.forEach((card)=>{
                const titleEl = card.querySelector('h2.a-size-base.a-spacing-none.a-color-base.a-text-normal > span') || card.querySelector('[style*="line-clamp"]') || card.querySelector('.a-color-base');
                const imgAlt = normalizeText(card.querySelector('img[alt]')?.alt || '');
                const rawTitle = imgAlt || titleEl?.innerText || '';
                const title = normalizeText(rawTitle);
                if (!title || title.length < 2) return;
                const href = (titleEl?.closest('a')?.getAttribute('href') || card.closest('a')?.getAttribute('href') || card.querySelector('a[href]')?.getAttribute('href') || card.getAttribute('href') || '').trim();
                const asinMatch = card.getAttribute('data-csa-c-asin') || card.getAttribute('data-asin') || this.getAsinFromUrl(href) || undefined;
                let price;
                const priceContainer = card.querySelector('.a-price');
                if (priceContainer) {
                    const symbol = priceContainer.querySelector('.a-price-symbol')?.textContent?.trim() || '';
                    const whole = priceContainer.querySelector('.a-price-whole')?.textContent?.trim() || '';
                    const fraction = priceContainer.querySelector('.a-price-fraction')?.textContent?.trim() || '';
                    const combined = this.normalizePrice(`${symbol}${whole}${fraction ? '.' + fraction : ''}`);
                    const offscreen = priceContainer.querySelector('.a-offscreen')?.textContent?.trim() || '';
                    price = combined || this.normalizePrice(offscreen) || undefined;
                } else {
                    const dollarEl = Array.from(card.querySelectorAll('div')).find((el)=>el.children.length === 0 && el.textContent?.trim() === '$');
                    const priceParts = dollarEl?.parentElement ? Array.from(dollarEl.parentElement.children) : [];
                    const whole = normalizeText(priceParts[1]?.textContent || '');
                    const fraction = normalizeText(priceParts[2]?.textContent || '');
                    if (whole) {
                        price = this.normalizePrice(`$${whole}${fraction ? '.' + fraction : ''}`) || undefined;
                    }
                }
                const ratingLabel = card.querySelector('[aria-label*="out of 5 stars"]')?.getAttribute('aria-label') || '';
                const ratingLabelMatch = ratingLabel.match(/([\d.]+)\s+out of 5 stars\.?\s*([\d,]+)?\s*ratings?\.?/i);
                const rating = ratingLabelMatch?.[1] || normalizeText(card.querySelector('.a-icon-alt')?.innerText || '') || undefined;
                const reviewCount = ratingLabelMatch?.[2] || normalizeText(card.querySelector('.a-size-small .a-size-base')?.innerText || '') || undefined;
                const badge = normalizeText(card.querySelector('.a-badge-text')?.innerText || '') || undefined;
                const footnote = normalizeText(card.querySelector('.rufus-asin-faceout-footer .a-color-base, .alexa-asin-faceout-footer .a-color-base')?.innerText || '') || undefined;
                const url = titleEl?.closest('a')?.getAttribute('href') || card.querySelector('a[href]')?.getAttribute('href') || href || '' || undefined;
                const product = {
                    title,
                    price,
                    asin: asinMatch,
                    rating,
                    review_count: reviewCount,
                    url,
                    badge,
                    footnote
                };
                productSuggestions.push({
                    title,
                    price,
                    asin: asinMatch
                });
                candidates.push({
                    el: card,
                    kind: 'product',
                    payload: {
                        product
                    }
                });
            });
            section.querySelectorAll('.rufus-asin-faceout-footer .a-color-base, .alexa-asin-faceout-footer .a-color-base').forEach((el)=>{
                const text = normalizeText(el.innerText || '');
                if (text) {
                    candidates.push({
                        el,
                        kind: 'footnote',
                        payload: {
                            text
                        }
                    });
                }
            });
            section.querySelectorAll('[data-rufus-action], [data-alexa-action], .rufus-action, .alexa-action, [data-action-type]').forEach((el)=>{
                const text = normalizeText(el.innerText || '');
                if (!text) return;
                const url = (el.getAttribute('href') || el.getAttribute('data-url') || el.getAttribute('data-rufus-url') || el.getAttribute('data-alexa-url') || '').trim();
                const actionType = el.getAttribute('data-rufus-action') || el.getAttribute('data-alexa-action') || el.getAttribute('data-action-type') || null;
                candidates.push({
                    el,
                    kind: 'cta',
                    payload: {
                        text,
                        action: {
                            text,
                            url: url || null,
                            action_type: actionType
                        }
                    }
                });
            });
            candidates.sort((a, b)=>{
                if (a.el === b.el) return 0;
                const pos = a.el.compareDocumentPosition(b.el);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
                if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
                return 0;
            });
            const blocks = [];
            candidates.forEach((c)=>{
                if (c.kind === 'product') {
                    blocks.push({
                        kind: 'product',
                        product: c.payload.product
                    });
                } else if (c.kind === 'cta') {
                    blocks.push({
                        kind: 'cta',
                        text: c.payload.text,
                        action: c.payload.action
                    });
                } else {
                    if (c.payload.text) {
                        blocks.push({
                            kind: c.kind,
                            text: c.payload.text
                        });
                    }
                }
            });
            if (blocks.length) {
                turns.push({
                    sequence_id: sequenceId,
                    blocks
                });
            }
        });
        const uniqueUserTexts = Array.from(new Set(userTexts.filter(Boolean)));
        const uniqueProducts = productSuggestions.filter((p, idx, arr)=>{
            const key = `${p.title}|${p.price || ''}|${p.asin || ''}`;
            return arr.findIndex((q)=>`${q.title}|${q.price || ''}|${q.asin || ''}` === key) === idx;
        }).slice(0, 10);
        const meaningfulTurns = turns.filter((t)=>t.blocks.length);
        if (!uniqueUserTexts.length && !uniqueProducts.length && !meaningfulTurns.length) {
            return;
        }
        const cappedTurns = meaningfulTurns.slice(-10);
        const flattened = {};
        uniqueProducts.forEach((p, i)=>{
            const idx = i + 1;
            flattened[`product_${idx}_title`] = p.title;
            flattened[`product_${idx}_price`] = p.price;
            flattened[`product_${idx}_asin`] = p.asin;
            flattened[`product_${idx}_brand`] = p.brand;
        });
        const truncatedUserTexts = uniqueUserTexts.map((t)=>t.slice(0, 500));
        const cappedProducts = uniqueProducts.slice(0, 5);
        const payload = {
            url: window.location.href,
            user_texts: truncatedUserTexts,
            product_suggestions: cappedProducts,
            turns: cappedTurns,
            ...flattened
        };
        const payloadHash = JSON.stringify({
            url: payload.url,
            user_texts: payload.user_texts,
            product_suggestions: payload.product_suggestions,
            turns: payload.turns
        });
        if (payloadHash === this.lastAssistantPayloadHash) {
            return;
        }
        this.lastAssistantCapture = now;
        this.lastAssistantPayloadHash = payloadHash;
        this.sendTelemetry(Event.ASSISTANT_TEXT, payload);
    }
    sendTelemetry(event, properties = {}) {
        if (!this.trackingActive()) return;
        try {
            chrome.runtime.sendMessage({
                type: 'telemetry',
                event,
                properties
            }, ()=>{
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    console.warn('telemetry send error', lastError.message);
                }
            });
        } catch (err) {
            console.error('failed to send telemetry from content', err);
        }
    }
    getAsinFromUrl(url) {
        const dpMatch = url.match(/\/dp\/([A-Z0-9]{10})/i);
        if (dpMatch && dpMatch[1]) return dpMatch[1];
        const gpMatch = url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
        if (gpMatch && gpMatch[1]) return gpMatch[1];
        return null;
    }
    isProductDetailPage(url) {
        return /\/dp\/[A-Z0-9]{10}/i.test(url) || /\/gp\/product\/([A-Z0-9]{10})/i.test(url);
    }
}

Object.assign(exports, {Content});
},
2:function(module,exports,__require){
class NotificationService {
    loginBlockWanted = false;
    loginBlockEl = null;
    loginBlockStyleEl = null;
    loginBlockObserver = null;
    loginBlockKeyHandler = null;
    loginBlockSignInUrl = '';
    constructor(){}
    async handleMessage(message, sender, sendResponse) {
        if (message.action === 'webmunkExt.notificationService.extensionNotificationRequest') {
            this.showNotification(message.text);
        } else if (message.action === 'webmunkExt.worker.notifyAdPersonalization') {
            await chrome.runtime.sendMessage({
                action: 'webmunkExt.popup.checkSettingsReq',
                data: message.data
            });
        } else if (message.action === 'webmunkExt.worker.notifyCookiesModule') {
            await chrome.runtime.sendMessage({
                action: 'webmunkExt.worker.recordCookies'
            });
        } else if (message.action === 'webmunkExt.screenshotService.isThereNotificationReq') {
            this.checkIfWebmunkNotificationExists();
        }
    }
    showLoginBlock(signInUrl) {
        this.loginBlockWanted = true;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ()=>this.mountLoginBlock(signInUrl), {
                once: true
            });
        } else {
            this.mountLoginBlock(signInUrl);
        }
    }
    clearLoginBlock() {
        this.loginBlockWanted = false;
        if (this.loginBlockObserver) {
            this.loginBlockObserver.disconnect();
            this.loginBlockObserver = null;
        }
        if (this.loginBlockKeyHandler) {
            window.removeEventListener('keydown', this.loginBlockKeyHandler, true);
            window.removeEventListener('keypress', this.loginBlockKeyHandler, true);
            window.removeEventListener('keyup', this.loginBlockKeyHandler, true);
            this.loginBlockKeyHandler = null;
        }
        this.loginBlockEl?.remove();
        this.loginBlockStyleEl?.remove();
        this.loginBlockEl = null;
        this.loginBlockStyleEl = null;
        document.documentElement.style.overflow = '';
    }
    buildLoginBlockElements(signInUrl) {
        const styles = document.createElement('style');
        styles.textContent = `
      .webmunk-block-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;

        display: flex;
        justify-content: center;
        align-items: center;

        background: rgba(17, 17, 17, 0.85);
        pointer-events: all;
      }

      .webmunk-block-card {
        width: 420px;
        max-width: 90vw;
        padding: 28px 24px;

        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        text-align: center;
      }

      .webmunk-block-signin-button {
        display: inline-block;
        margin-top: 18px;
        padding: 12px 24px;

        background: #a41b33;
        color: #ffffff !important;
        text-decoration: none !important;
        border-radius: 6px;
        font-weight: 700;
        font-size: 15px;
      }

      .webmunk-block-signin-button:hover {
        background: #7f1527;
      }

      .webmunk-block-recheck {
        display: block;
        margin-top: 14px;
        background: none;
        border: none;
        color: #555 !important;
        font-size: 13px;
        text-decoration: underline;
        cursor: pointer;
      }
    `;
        const backdrop = document.createElement('div');
        backdrop.id = 'webmunk-login-block';
        backdrop.classList.add('webmunk-block-backdrop');
        backdrop.innerHTML = `
      <div class="webmunk-block-card">
        <img style="width: 32px; height: 32px;" src="${chrome.runtime.getURL('images/UvA.png')}" alt="logo">
        <h2 style="font-size: 20px; color: #111; margin: 12px 0 8px;">Sign in required</h2>
        <p style="font-size: 15px; color: #333; margin: 0; line-height: 1.5;">
          You must be signed in to your Amazon account (on this Amazon site) to do the
          shopping task. Sign in and this page unlocks on its own.
        </p>
        <a class="webmunk-block-signin-button">Sign in to Amazon</a>
        <button type="button" class="webmunk-block-recheck">Already signed in? Reload this page</button>
      </div>
    `;
        backdrop.querySelector('.webmunk-block-recheck')?.addEventListener('click', ()=>{
            window.location.reload();
        });
        this.loginBlockStyleEl = styles;
        this.loginBlockEl = backdrop;
    }
    mountLoginBlock(signInUrl) {
        if (!this.loginBlockWanted) return;
        if (signInUrl) {
            this.loginBlockSignInUrl = signInUrl;
        }
        if (!this.loginBlockEl || !this.loginBlockStyleEl) {
            this.buildLoginBlockElements(this.loginBlockSignInUrl);
        }
        if (this.loginBlockStyleEl && !this.loginBlockStyleEl.isConnected) {
            (document.head || document.documentElement).appendChild(this.loginBlockStyleEl);
        }
        if (this.loginBlockEl && !this.loginBlockEl.isConnected) {
            document.documentElement.appendChild(this.loginBlockEl);
        }
        document.documentElement.style.overflow = 'hidden';
        const btn = this.loginBlockEl?.querySelector('.webmunk-block-signin-button');
        if (btn && this.loginBlockSignInUrl && btn.getAttribute('href') !== this.loginBlockSignInUrl) {
            btn.setAttribute('href', this.loginBlockSignInUrl);
        }
        if (!this.loginBlockKeyHandler) {
            this.loginBlockKeyHandler = (e)=>{
                if (!this.loginBlockWanted) return;
                const card = this.loginBlockEl?.querySelector('.webmunk-block-card') || null;
                const path = typeof e.composedPath === 'function' && e.composedPath() || [];
                if (card && (path.indexOf(card) !== -1 || card.contains(e.target))) return;
                e.stopImmediatePropagation();
                e.preventDefault();
            };
            window.addEventListener('keydown', this.loginBlockKeyHandler, true);
            window.addEventListener('keypress', this.loginBlockKeyHandler, true);
            window.addEventListener('keyup', this.loginBlockKeyHandler, true);
        }
        if (!this.loginBlockObserver) {
            this.loginBlockObserver = new MutationObserver(()=>{
                if (!this.loginBlockWanted) return;
                if (!document.getElementById('webmunk-login-block')) {
                    this.mountLoginBlock(this.loginBlockSignInUrl);
                }
            });
            this.loginBlockObserver.observe(document.documentElement, {
                childList: true
            });
        }
    }
    showNotification(text) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ()=>this.displayNotification(text));
        } else {
            this.displayNotification(text);
        }
    }
    displayNotification(text) {
        if (document.getElementById('webmunk-rate-notification')) return;
        document.getElementById('webmunk-notification')?.remove();
        this.sendResponseToService();
        const styles = document.createElement('style');
        styles.textContent = `
      .notification-wrapper {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 10000;

        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
        height: 100%;

        pointer-events: none;
      }

      .notification-container {
        position: fixed;
        z-index: 10000;

        display: flex;
        flex-direction: column;
        gap: 15px;
        width: 480px;
        padding: 15px 20px;

        background-color: #ffffff;
        border: 1px solid transparent;
        color: black;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        font-weight: 700 !important;
        border-radius: 10px;
        opacity: 0;
        box-shadow: 0 0 10px rgba(0,0,0,0.2);
        animation: appear 0.5s linear forwards;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        pointer-events: all;
      }

      @keyframes appear {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }

      .close-button {
        background-color: transparent;
        cursor: pointer;
        fill: rgb(175, 175, 175);

        &:hover {
          fill: black;
        }
      }

      .open-extensions-link {
        color: blue !important;
        text-decoration: none !important;

        &:hover {
          text-decoration: underline !important;
        }
      }
    `;
        document.head.appendChild(styles);
        const wrapper = document.createElement('div');
        wrapper.classList.add('notification-wrapper');
        wrapper.id = 'webmunk-notification';
        const notificationContainer = document.createElement('div');
        notificationContainer.classList.add('notification-container');
        const notificationContent = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <img style="width: 25px; height: 25px;" src="${chrome.runtime.getURL('images/UvA.png')}" alt="logo">
          <p style="font-size: 22px; color: black; margin: 0; line-height: 1.3;">Webmunk Study</p>
        </div>
        <svg id="close-button" class="close-button" height="20px" viewBox="0 0 384 512">
          <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z">
          </path>
        </svg>
      </div>
      <p style="font-size: 18px; color: black; margin: 0; line-height: 1.3; text-align: center; white-space: break-spaces;">${text}</p>
    `;
        notificationContainer.innerHTML = notificationContent;
        wrapper.appendChild(notificationContainer);
        document.documentElement.appendChild(wrapper);
        document.getElementById('close-button').addEventListener('click', ()=>{
            wrapper.remove();
        });
        document.querySelector('.open-extensions-link')?.addEventListener('click', (event)=>{
            event.preventDefault();
            chrome.runtime.sendMessage({
                action: 'webmunkExt.notificationService.removeExtension'
            });
            wrapper.remove();
        });
    }
    sendResponseToService() {
        chrome.runtime.sendMessage({
            action: 'webmunkExt.notificationService.extensionNotificationResponse'
        });
    }
    checkIfWebmunkNotificationExists() {
        const notifications = Array.from(document.querySelectorAll('[id="webmunk-notification"], [id="webmunk-rate-notification"], [id="webmunk-login-block"]'));
        const isExist = !!notifications.length;
        chrome.runtime.sendMessage({
            action: 'webmunkExt.notificationService.isThereNotificationRes',
            result: isExist
        });
    }
}

Object.assign(exports, {NotificationService});
},
3:function(module,exports,__require){
var NotificationText = /*#__PURE__*/ function(NotificationText) {
    NotificationText["FILL_OUT"] = "It`s time to complete a survey. Please click on your extension to continue.";
    NotificationText["REMOVE"] = 'Please uninstall <a class="open-extensions-link" href="#">the Webmunk Study extension</a>!';
    NotificationText["AMAZON_LOGIN"] = "Please sign in to your Amazon account (top of the page) to begin the shopping task.";
    NotificationText["AMAZON_LOGIN_REQUIRED_AT_CART"] = "You're not signed in yet, so this doesn't count as finishing the shopping task. Please sign in to your Amazon account (top of the page), then return to your cart to continue.";
    return NotificationText;
}({});
var UrlParameters = /*#__PURE__*/ function(UrlParameters) {
    UrlParameters["ONLY_INFORMATION"] = "oi";
    UrlParameters["AD_BLOCKER"] = "ab";
    UrlParameters["FACEBOOK"] = "fad";
    UrlParameters["GOOGLE_AND_YOUTUBE"] = "gyta";
    UrlParameters["AMAZON"] = "aap";
    UrlParameters["ARM"] = "arm";
    UrlParameters["PROLIFIC_ID"] = "PROLIFIC_PID";
    UrlParameters["PRODUCT_CATEGORY"] = "category";
    return UrlParameters;
}({});
var Event = /*#__PURE__*/ function(Event) {
    Event["URL_TRACKING"] = "url_tracking";
    Event["EXCLUDED_DOMAINS_VISIT"] = "excluded_domains_visit";
    Event["INSTALLED_EXTENSIONS"] = "installed_extensions";
    Event["USER_MAPPING"] = "user_mapping";
    Event["SCREEN_ANALYSIS"] = "screen_analysis";
    Event["ADS_RATED"] = "ads_rated";
    Event["INSTALLED"] = "installed";
    Event["PAGE_VIEW"] = "page_view";
    Event["CONTENT_LOADED"] = "content_loaded";
    Event["HEARTBEAT"] = "heartbeat";
    Event["NAV_COMMITTED"] = "nav_committed";
    Event["ASSISTANT_HIDDEN"] = "assistant_hidden";
    Event["ASSISTANT_AVAILABLE"] = "assistant_available";
    Event["ASSISTANT_LEAK_DETECTED"] = "assistant_leak_detected";
    Event["PRODUCT_PAGE_VIEW"] = "product_page_view";
    Event["ADD_TO_CART_CLICK"] = "add_to_cart_click";
    Event["CART_REMOVE"] = "cart_remove";
    Event["CART_SUBTOTAL"] = "cart_subtotal";
    Event["TAB_DWELL"] = "tab_dwell";
    Event["ASSISTANT_TEXT"] = "assistant_text";
    Event["SEARCH_SUBMITTED"] = "search_submitted";
    Event["SESSION_SUMMARY"] = "session_summary";
    Event["FILTER_USED"] = "filter_used";
    Event["BACKTRACK_NAVIGATION"] = "backtrack_navigation";
    Event["DECISION_MADE"] = "decision_made";
    Event["PRODUCT_RESULT_CLICK"] = "product_result_click";
    Event["CART_BASELINE_COUNT"] = "cart_baseline_count";
    Event["CART_SNAPSHOT"] = "cart_snapshot";
    Event["AMAZON_LOGIN_CONFIRMED"] = "amazon_login_confirmed";
    Event["AUTO_REGISTRATION_FAILED"] = "auto_registration_failed";
    Event["REGISTRATION_COMPLETED"] = "registration_completed";
    Event["AMAZON_LOGIN_BLOCK_SHOWN"] = "amazon_login_block_shown";
    Event["AMAZON_LOGIN_BLOCKED_AT_CART"] = "amazon_login_blocked_at_cart";
    Event["PRE_TASK_ACTIVITY_SUPPRESSED"] = "pre_task_activity_suppressed";
    return Event;
}({});

Object.assign(exports, {NotificationText,UrlParameters,Event});
},
4:function(module,exports,__require){
const DEBUG_LOGGING = typeof process !== 'undefined' && process.env.DEBUG_LOGGING === 'true';
function debug(...args) {
    if (DEBUG_LOGGING) {
        console.log(...args);
    }
}

Object.assign(exports, {debug});
},
5:function(module,exports,__require){
const AMAZON_DOMAINS = [
    'amazon.com',
    'amazon.co.uk',
    'amazon.de',
    'amazon.nl',
    'amazon.fr',
    'amazon.it',
    'amazon.es',
    'amazon.ca',
    'amazon.com.au',
    'amazon.co.jp',
    'amazon.in',
    'amazon.com.mx',
    'amazon.com.br'
];
function isAmazonUrl(raw) {
    try {
        const u = new URL(String(raw));
        return u.protocol === 'https:' && !u.username && !u.password && AMAZON_DOMAINS.some((d)=>u.hostname === d || u.hostname.endsWith(`.${d}`));
    } catch  {
        return false;
    }
}
function isShoppingUrl(raw) {
    if (!isAmazonUrl(raw)) return false;
    const path = new URL(String(raw)).pathname;
    return !/^\/(ap|ax|cpe|hz\/contact-us)\b/i.test(path) && !/signin|sign-in|signout|sign-out|register|checkout|buy\/|your-account|your-orders|order-history|gp\/css|gp\/help|gp\/yourstore|hz\/mycd/i.test(path);
}
function isCartUrl(raw) {
    return isShoppingUrl(raw) && /\/(?:gp\/)?cart(?:\/|$)/i.test(new URL(String(raw)).pathname);
}
function parseArm(raw) {
    return raw === 'classic' || raw === 'chat_no_guide' || raw === 'chat' ? raw : null;
}
const SESSION_MAX_MS = 60 * 60 * 1000;
function parseAssignment(raw) {
    if (!isShoppingUrl(raw)) return null;
    const u = new URL(raw), p = u.searchParams;
    const pid = p.get('PROLIFIC_PID') || '';
    const arm = parseArm(p.get('arm'));
    const rawCategory = (p.get('category') || '').trim();
    const normalized = rawCategory.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').replace(/^(?:a )?new /, '');
    const budgets = {
        headphones: 350,
        backpack: 150,
        'robot vacuum': 500
    };
    if (!/^[a-f\d]{24}$/i.test(pid) || !arm || !budgets[normalized]) return null;
    const category = {
        headphones: 'Headphones',
        backpack: 'Backpack',
        'robot vacuum': 'Robot Vacuum'
    }[normalized];
    return {
        prolificId: pid.toLowerCase(),
        arm,
        category,
        budget: budgets[normalized],
        origin: u.origin
    };
}
function hasAssignment(raw) {
    try {
        const p = new URL(raw).searchParams;
        return [
            'PROLIFIC_PID',
            'arm',
            'category'
        ].some((k)=>p.has(k));
    } catch  {
        return false;
    }
}
function canTrack(state, raw) {
    const c = state.studyContext;
    return state.taskStage === 'shopping' && state.amazonLoginConfirmed === true && !!c?.sessionId && Number(c.expiresAt) > Date.now() && !!parseArm(c.arm) && state.user?.prolificId === c.prolificId && state.user?.active !== false && isShoppingUrl(raw) && new URL(raw).origin === c.origin;
}
function cleanUrl(raw) {
    if (!isShoppingUrl(raw)) return '';
    const u = new URL(raw);
    const p = new URLSearchParams();
    for (const key of [
        'k',
        'field-keywords',
        'rh',
        's',
        'page',
        'node'
    ]){
        if (u.searchParams.has(key)) p.set(key, u.searchParams.get(key).slice(0, 500));
    }
    const query = p.toString();
    return `${u.origin}${u.pathname}${query ? `?${query}` : ''}`;
}
function makeSurveyUrl(base, c) {
    const u = new URL(base);
    if (u.protocol !== 'https:' || u.username || u.password) throw new Error('The final survey URL must use HTTPS.');
    for (const [k, v] of Object.entries({
        PROLIFIC_PID: c.prolificId,
        arm: c.arm,
        category: c.category,
        budget: String(c.budget),
        session_id: c.sessionId
    }))u.searchParams.set(k, v);
    return u.href;
}
function validateQualtricsUrl(raw) {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.username || u.password || !(u.hostname === 'qualtrics.com' || u.hostname.endsWith('.qualtrics.com')) || !/^\/jfe\/form\/SV_[a-zA-Z0-9]+\/?$/.test(u.pathname)) {
        throw new Error('Enter the HTTPS Qualtrics respondent link containing /jfe/form/SV_ (not the editor link).');
    }
    return u.href;
}
function validateChoice(items, asin) {
    if (typeof asin !== 'string' || !/^[A-Z0-9]{10}$/i.test(asin)) throw new Error('Select a product from your current cart.');
    const matches = items.filter((i)=>i.asin === asin && i.title?.trim());
    if (matches.length !== 1) throw new Error('Your cart changed or could not be read. Refresh the cart and select your product again.');
    return matches[0];
}

Object.assign(exports, {AMAZON_DOMAINS,isAmazonUrl,isShoppingUrl,isCartUrl,parseArm,SESSION_MAX_MS,parseAssignment,hasAssignment,canTrack,cleanUrl,makeSurveyUrl,validateQualtricsUrl,validateChoice});
},
6:function(module,exports,__require){
const ASSISTANT_SELECTORS = [
    '#nav-rufus',
    '#nav-rufus-plus',
    '#nav-alexa',
    '#nav-alexa-plus',
    '[id^="nav-rufus-disco"]',
    '[class^="nav-rufus-disco"]',
    '#rufus-container',
    '#rufus-docked-container',
    '#alexa-shopping-container',
    '.rufus-docked',
    '.rufus-sections-container',
    '.alexa-sections-container',
    '[role="dialog"][data-csa-c-content-id*="rufus" i]',
    '[role="dialog"][data-csa-c-content-id*="alexa" i]',
    'button[aria-label*="rufus" i]',
    '[role="button"][aria-label*="rufus" i]',
    'button[aria-label*="ask alexa" i]',
    '[role="button"][aria-label*="ask alexa" i]',
    'a[aria-label="Alexa Shopping" i]',
    'a[aria-label="Alexa for Shopping" i]',
    'a[aria-label^="Ask Alexa" i]',
    'button[aria-label="Alexa Shopping" i]',
    '#nile-inline_feature_div',
    '[data-feature-name="nile-inline"]',
    '[data-wm-assistant-control="true"]'
];
function isVisible(el) {
    const style = getComputedStyle(el);
    return el.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}
class AssistantControl {
    style = null;
    observer = null;
    enabled = false;
    marked = new Set();
    saved = new Map();
    bodySaved = null;
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.observer?.disconnect();
            this.observer = null;
            this.style?.remove();
            this.style = null;
            for (const [el, old] of this.saved){
                if (el.style.getPropertyValue('display') === 'none') {
                    if (old.value) el.style.setProperty('display', old.value, old.priority);
                    else el.style.removeProperty('display');
                }
            }
            this.saved.clear();
            for (const el of this.marked)delete el.dataset.wmAssistantControl;
            this.marked.clear();
            if (this.bodySaved && document.body) {
                document.body.setAttribute('class', this.bodySaved.className);
                if (this.bodySaved.style) document.body.setAttribute('style', this.bodySaved.style);
                else document.body.removeAttribute('style');
                this.bodySaved = null;
            }
            return;
        }
        if (!document.documentElement) return;
        if (!this.style?.isConnected) {
            this.style = document.createElement('style');
            this.style.id = 'webmunk-assistant-policy';
            this.style.textContent = ASSISTANT_SELECTORS.join(',') + '{display:none!important;pointer-events:none!important;}';
            document.documentElement.append(this.style);
        }
        this.hide();
        if (!this.observer) {
            this.observer = new MutationObserver(()=>{
                if (this.enabled) this.hide();
            });
            this.observer.observe(document.documentElement, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: [
                    'aria-label',
                    'style',
                    'class',
                    'id'
                ]
            });
        }
    }
    clearBodyDock() {
        const body = document.body;
        if (!body) return;
        const dockClasses = [
            'rufus-docked-left',
            'rufus-docked-right',
            'rufus-docked-adjustable',
            'rufus-docked-only',
            'rufus-docked-opening-transition',
            'rufus-cl-alexa-plus'
        ];
        if (!dockClasses.some((c)=>body.classList.contains(c))) return;
        if (!this.bodySaved) this.bodySaved = {
            className: body.className,
            style: body.getAttribute('style') || ''
        };
        for (const c of dockClasses)body.classList.remove(c);
        for (const prop of [
            'padding-left',
            'padding-right',
            'padding-top',
            '--rufus-docked-panel-width',
            '--total-rufus-panel-full-width',
            '--total-rufus-panel-half-width'
        ]){
            body.style.removeProperty(prop);
        }
        try {
            sessionStorage.removeItem('rufus:panel:dockedState');
        } catch  {}
        try {
            localStorage.removeItem('rufus:panel:dockedState');
        } catch  {}
    }
    hide() {
        if (!this.style?.isConnected && this.enabled) {
            this.setEnabled(true);
            return;
        }
        this.clearBodyDock();
        for (const el of document.querySelectorAll('button,[role="button"],#nav-main a,#nav-belt a')){
            const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (/^(?:ask alexa|alexa (?:for )?shopping|ask rufus|rufus|chat with (?:alexa|rufus)|open (?:alexa|rufus)(?: panel)?)(?:[.!?])?$/i.test(label)) {
                if (el.dataset.wmAssistantControl !== 'true') {
                    el.dataset.wmAssistantControl = 'true';
                    this.marked.add(el);
                }
            }
        }
        const targets = new Set(document.querySelectorAll(ASSISTANT_SELECTORS.join(',')));
        for (const seed of [
            ...targets
        ]){
            for(let parent = seed.parentElement, depth = 0; parent && depth < 7; parent = parent.parentElement, depth++){
                if (parent === document.body || parent === document.documentElement || parent.matches('main,nav,header,#nav-main,#nav-belt')) break;
                const rect = parent.getBoundingClientRect();
                const edge = rect.left <= 8 || rect.right >= window.innerWidth - 8;
                if (edge && rect.width >= 180 && rect.width <= Math.min(560, window.innerWidth * .45) && rect.height >= window.innerHeight * .6) {
                    targets.add(parent);
                    const close = parent.querySelector('button[aria-label="Close" i],button[aria-label^="Close Alexa" i],button[aria-label^="Close Rufus" i],[role="button"][aria-label="Close" i]');
                    if (!this.saved.has(parent)) close?.click();
                }
            }
        }
        for (const el of targets){
            if (!this.saved.has(el)) this.saved.set(el, {
                value: el.style.getPropertyValue('display'),
                priority: el.style.getPropertyPriority('display')
            });
            if (el.style.getPropertyValue('display') !== 'none' || el.style.getPropertyPriority('display') !== 'important') {
                el.style.setProperty('display', 'none', 'important');
            }
        }
    }
}

Object.assign(exports, {ASSISTANT_SELECTORS,isVisible,AssistantControl});
}
};const __cache={};function __require(id){if(__cache[id])return __cache[id].exports;const m={exports:{}};__cache[id]=m;__modules[id](m,m.exports,__require);return m.exports;}return __require(0);})();
