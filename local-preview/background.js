(function(){"use strict";const __modules={
0:function(module,exports,__require){
__require(1);

Object.assign(exports, {});
},
1:function(module,exports,__require){
const { Backend } = __require(2);
const { StudyService } = __require(3);
const { canTrack, cleanUrl, isShoppingUrl, isCartUrl, hasAssignment, validateQualtricsUrl } = __require(4);
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
const backend = new Backend();
const study = new StudyService(backend);
let work = Promise.resolve();
function enqueue(fn) {
    const next = work.then(fn, fn);
    work = next.catch(()=>{});
    return next;
}
chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
}).catch(console.error);
chrome.runtime.onInstalled.addListener(()=>{
    chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: true
    }).catch(console.error);
});
const BEHAVIOR_EVENTS = new Set([
    'product_page_view',
    'add_to_cart_click',
    'cart_remove',
    'cart_subtotal',
    'assistant_text',
    'search_submitted',
    'filter_used',
    'backtrack_navigation',
    'decision_made',
    'product_result_click',
    'cart_baseline_count',
    'cart_snapshot',
    'assistant_hidden',
    'assistant_available',
    'assistant_leak_detected'
]);
async function record(event, props, tabId, url) {
    const s = await chrome.storage.local.get(null);
    if (!canTrack(s, url)) return;
    const summary = s.studySummary || {};
    const counters = {
        nav_committed: 'nav_count',
        product_page_view: 'product_page_view_count',
        add_to_cart_click: 'add_to_cart_count',
        cart_remove: 'remove_count',
        search_submitted: 'search_count',
        filter_used: 'filter_count',
        backtrack_navigation: 'backtrack_count',
        decision_made: 'decision_count',
        product_result_click: 'product_result_click_count',
        assistant_text: 'assistant_interaction_count',
        assistant_hidden: 'assistant_hidden_count',
        assistant_leak_detected: 'assistant_leak_count'
    };
    if (counters[event]) summary[counters[event]] = (summary[counters[event]] || 0) + 1;
    if (event === 'tab_dwell') summary.dwell_ms = (summary.dwell_ms || 0) + props.dwell_ms;
    if (event === 'assistant_available') summary.assistant_available = true;
    if (event === 'decision_made' && summary.first_decision_latency_ms == null) summary.first_decision_latency_ms = props.decision_latency_ms;
    if (event === 'cart_baseline_count') summary.pre_existing_cart_count = props.count;
    if (event === 'product_result_click' || event === 'product_page_view') {
        const asins = new Set(summary.unique_product_asins || []);
        if (props.asin) asins.add(props.asin);
        summary.unique_product_asins = [
            ...asins
        ];
        summary.unique_product_asin_count = asins.size;
    }
    const extra = {};
    if (event === 'add_to_cart_click' && props.asin) extra.addedAsins = [
        ...new Set([
            ...s.addedAsins || [],
            props.asin
        ])
    ];
    if (event === 'cart_snapshot' && isCartUrl(url)) {
        extra.currentCart = {
            ...props,
            tabId,
            capturedAt: Date.now(),
            url: cleanUrl(url)
        };
        summary.final_cart_item_count = props.item_count;
        summary.final_cart_items = props.items;
        summary.final_subtotal = props.subtotal;
        summary.final_subtotal_amount = props.subtotal_amount;
    }
    summary.last_url = cleanUrl(url);
    await chrome.storage.local.set({
        studySummary: summary,
        ...extra
    });
    const payload = {
        ...props,
        url: cleanUrl(url),
        tabId,
        arm: s.studyContext.arm
    };
    if (typeof payload.target_url === 'string') payload.target_url = cleanUrl(payload.target_url);
    await backend.track(event, payload);
}
async function endDwell(now = Date.now()) {
    const { dwellContext: d } = await chrome.storage.session.get('dwellContext');
    await chrome.storage.session.remove('dwellContext');
    if (!d) return;
    const s = await chrome.storage.local.get(null);
    if (!canTrack(s, d.url) || d.sessionId !== s.studyContext.sessionId) return;
    const start = Math.max(d.since, Number(s.shoppingTaskStartedAt) || now);
    if (now > start) await record('tab_dwell', {
        dwell_ms: now - start
    }, d.tabId, d.url);
}
async function beginDwell(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(()=>null);
    if (!tab?.active || !tab.url) return;
    const win = await chrome.windows.get(tab.windowId);
    const s = await chrome.storage.local.get(null);
    if (!win.focused || !canTrack(s, tab.url)) return;
    await chrome.storage.session.set({
        dwellContext: {
            tabId,
            url: cleanUrl(tab.url),
            since: Date.now(),
            sessionId: s.studyContext.sessionId
        }
    });
}
async function finishSummary(reason) {
    const s = await chrome.storage.local.get(null);
    if (!s.studyContext || s.summarySent) return;
    const summary = {
        ...s.studySummary
    };
    delete summary.unique_product_asins;
    await backend.track('session_summary', {
        ...summary,
        reason,
        summary_scope: 'study_session',
        start_ts: s.shoppingTaskStartedAt,
        end_ts: s.shoppingTaskStoppedAt || Date.now(),
        duration_ms: s.shoppingTaskStartedAt ? (s.shoppingTaskStoppedAt || Date.now()) - s.shoppingTaskStartedAt : null,
        final_choice: s.finalChoice || null
    });
    await chrome.storage.local.set({
        summarySent: true
    });
}
chrome.tabs.onUpdated.addListener((tabId, change, tab)=>{
    if (!change.url && change.status !== 'loading' && change.status !== 'complete') return;
    void enqueue(async ()=>{
        if (change.status === 'loading' || change.url) {
            const { dwellContext } = await chrome.storage.session.get('dwellContext');
            if (dwellContext?.tabId === tabId) await endDwell();
        }
        if (tab.url && isShoppingUrl(tab.url) && hasAssignment(tab.url)) await study.enroll(tab.url, tabId);
        if (change.status === 'complete') await beginDwell(tabId);
    }).catch(console.error);
});
chrome.tabs.onActivated.addListener(({ tabId })=>{
    void enqueue(async ()=>{
        await endDwell();
        await beginDwell(tabId);
    }).catch(console.error);
});
chrome.windows.onFocusChanged.addListener((windowId)=>{
    void enqueue(async ()=>{
        await endDwell();
        if (windowId === chrome.windows.WINDOW_ID_NONE) return;
        const [tab] = await chrome.tabs.query({
            active: true,
            windowId
        });
        if (tab?.id != null) await beginDwell(tab.id);
    }).catch(console.error);
});
chrome.tabs.onRemoved.addListener((tabId)=>{
    void enqueue(async ()=>{
        const { dwellContext } = await chrome.storage.session.get('dwellContext');
        if (dwellContext?.tabId === tabId) await endDwell();
    }).catch(console.error);
});
chrome.webNavigation.onCommitted.addListener((details)=>{
    if (details.frameId !== 0 || !isShoppingUrl(details.url)) return;
    void enqueue(()=>record('nav_committed', {}, details.tabId, details.url)).catch(console.error);
});
async function activeStudyTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
    });
    const { studyContext: c } = await chrome.storage.local.get('studyContext');
    if (tab?.id == null || !isShoppingUrl(tab.url) || new URL(tab.url).origin !== c?.origin) {
        throw new Error('Switch to your Amazon study tab first.');
    }
    return tab;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse)=>{
    if (!message?.type) return;
    if (message.type === 'study_open_panel' && sender.tab?.id != null && sender.frameId === 0 && isShoppingUrl(sender.url)) {
        chrome.sidePanel.open({
            windowId: sender.tab.windowId
        }).then(()=>sendResponse({
                ok: true
            }), (e)=>sendResponse({
                ok: false,
                error: String(e)
            }));
        return true;
    }
    const fromPanel = !sender.tab && sender.url === chrome.runtime.getURL('popup/popup.html') || backend.preview && sender.url === chrome.runtime.getURL('popup/preview-tools.html');
    const tabId = sender.tab?.id;
    const content = tabId != null && isShoppingUrl(sender.url);
    const top = content && sender.frameId === 0;
    const types = new Set([
        'study_context',
        'amazon_login_status',
        'telemetry',
        'study_retry',
        'study_cart',
        'study_refresh_cart',
        'study_confirm',
        'study_continue',
        'study_stop',
        'study_preview_reset',
        'study_preview_p2',
        'study_expired'
    ]);
    if (!types.has(message.type)) return;
    void enqueue(async ()=>{
        if (top || fromPanel) {
            const current = await chrome.storage.local.get([
                'taskStage',
                'studyContext'
            ]);
            if (current.taskStage === 'shopping' && !(current.studyContext?.expiresAt > Date.now())) {
                await endDwell();
                await chrome.storage.local.set({
                    taskStage: 'stopped',
                    amazonLoginConfirmed: false,
                    shoppingTaskStoppedAt: Date.now(),
                    studyError: 'The study session has timed out and shopping tracking has stopped. Contact the researcher.'
                });
                await finishSummary('session_timeout');
            }
        }
        if (message.type === 'study_expired') return {
            ok: true
        };
        if (message.type === 'study_context' && top) {
            await study.enroll(sender.url, tabId);
            return {
                ok: true
            };
        }
        if (message.type === 'amazon_login_status' && top) {
            const s = await chrome.storage.local.get('studyContext');
            if (s.studyContext?.origin !== new URL(sender.url).origin) return {
                ok: false
            };
            if (!message.loggedIn) await endDwell();
            await study.login(message.loggedIn === true);
            if (message.loggedIn) {
                const { dwellContext } = await chrome.storage.session.get('dwellContext');
                if (!dwellContext) await beginDwell(tabId);
            }
            return {
                ok: true
            };
        }
        if (message.type === 'telemetry' && content && BEHAVIOR_EVENTS.has(message.event)) {
            if (!top && ![
                'assistant_hidden',
                'assistant_leak_detected'
            ].includes(message.event)) return {
                ok: false
            };
            await record(message.event, message.properties || {}, tabId, sender.url);
            return {
                ok: true
            };
        }
        if (!fromPanel) throw new Error('This action is only available in the study panel.');
        if (message.type === 'study_retry') {
            const [tab] = await chrome.tabs.query({
                active: true,
                lastFocusedWindow: true
            });
            if (!tab?.url || tab.id == null || !hasAssignment(tab.url)) throw new Error('Return to the survey’s original Amazon link to retry registration.');
            await study.enroll(tab.url, tab.id);
        } else if (message.type === 'study_cart') {
            const tab = await activeStudyTab();
            await chrome.storage.local.set({
                studyTabId: tab.id,
                currentCart: null
            });
            await chrome.tabs.update(tab.id, {
                url: new URL(tab.url).origin + '/gp/cart/view.html',
                active: true
            });
        } else if (message.type === 'study_refresh_cart') {
            const tab = await activeStudyTab();
            if (!isCartUrl(tab.url)) throw new Error('Click “Review my cart” first.');
            const cart = await chrome.tabs.sendMessage(tab.id, {
                type: 'study_read_cart'
            }, {
                frameId: 0
            });
            if (!cart?.ok) throw new Error('Cart rows are not readable yet. Reload Amazon and try again.');
            await record('cart_snapshot', cart, tab.id, tab.url);
        } else if (message.type === 'study_confirm') {
            const s = await chrome.storage.local.get('taskStage');
            if (s.taskStage !== 'final') {
                if (message.confirmed !== true) throw new Error('Please confirm that this is your final study choice.');
                const tab = await activeStudyTab();
                await endDwell();
                try {
                    await study.confirm(message.asin, tab.id);
                } catch (e) {
                    await beginDwell(tab.id);
                    throw e;
                }
            }
            await study.ensureFinalChoiceEvent();
            await finishSummary('confirmed');
            await study.openSurvey();
        } else if (message.type === 'study_continue') {
            await study.ensureFinalChoiceEvent();
            await finishSummary('confirmed');
            await study.openSurvey();
        } else if (message.type === 'study_stop') {
            await endDwell();
            await chrome.storage.local.set({
                taskStage: 'stopped',
                amazonLoginConfirmed: false,
                shoppingTaskStoppedAt: Date.now()
            });
            await finishSummary('participant_stopped');
        } else if (message.type === 'study_preview_p2' && backend.preview) {
            const url = message.url ? validateQualtricsUrl(String(message.url)) : '';
            await chrome.storage.local.set({
                previewP2Url: url
            });
        } else if (message.type === 'study_preview_reset' && backend.preview) {
            await chrome.storage.local.clear();
            await chrome.storage.session.clear();
            await chrome.storage.local.set({
                buildMode: 'preview'
            });
        } else throw new Error('Unknown study action.');
        return {
            ok: true
        };
    }).then(sendResponse, (e)=>sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e)
        }));
    return true;
});
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse)=>{
    if (message?.type !== 'webmunk_ping') return;
    sendResponse({
        ok: true,
        id: chrome.runtime.id,
        version: chrome.runtime.getManifest().version
    });
});

Object.assign(exports, {});
},
2:function(module,exports,__require){
class Backend {
    preview = true;
    async register(pid) {
        const user = {
            prolificId: pid,
            uid: `preview-${pid}`,
            sessionUid: crypto.randomUUID(),
            active: true
        };
        await chrome.storage.local.set({
            user
        });
        return user;
    }
    async surveyUrl() {
        return 'https://example.invalid/local-preview';
    }
    async track(event, properties) {
        const { previewEvents = [], studyContext: c } = await chrome.storage.local.get([
            'previewEvents',
            'studyContext'
        ]);
        const payload = {
            ...properties,
            event_type: event,
            ts: Date.now(),
            user_id: c?.prolificId,
            session_id: c?.sessionId,
            arm: c?.arm,
            product_category: c?.category,
            preview: true
        };
        await chrome.storage.local.set({
            previewEvents: [
                ...previewEvents,
                payload
            ].slice(-500)
        });
    }
}

Object.assign(exports, {Backend});
},
3:function(module,exports,__require){
const { Backend } = __require(2);
const { hasAssignment, parseAssignment, makeSurveyUrl, validateChoice, isCartUrl, isShoppingUrl, SESSION_MAX_MS, validateQualtricsUrl } = __require(4);
const { FINAL_SURVEY_URL } = __require(5);
class StudyService {
    backend;
    constructor(backend){
        this.backend = backend;
    }
    async enroll(url, tabId) {
        if (!isShoppingUrl(url) || !hasAssignment(url)) return;
        const assignment = parseAssignment(url);
        const s = await chrome.storage.local.get(null);
        if (!assignment) {
            if (s.taskStage !== 'final' && s.taskStage !== 'stopped') {
                await chrome.storage.local.set({
                    taskStage: 'initial',
                    amazonLoginConfirmed: false,
                    studyError: 'Study details are missing or invalid. Return to the study survey and use its Amazon link again.'
                });
            }
            return;
        }
        const old = s.studyContext;
        if (s.user && !old) {
            await chrome.storage.local.set({
                taskStage: 'stopped',
                amazonLoginConfirmed: false,
                studyError: 'This installation has a registration from an older study session. Contact the researcher before continuing.'
            });
            return;
        }
        if (old && (old.prolificId !== assignment.prolificId || old.arm !== assignment.arm || old.category.toLowerCase() !== assignment.category.toLowerCase() || old.origin !== assignment.origin)) {
            await chrome.storage.local.set({
                taskStage: 'stopped',
                amazonLoginConfirmed: false,
                studyError: 'This browser already has a different study session. Do not continue; contact the researcher.'
            });
            return;
        }
        if (s.user?.prolificId && s.user.prolificId !== assignment.prolificId) {
            await chrome.storage.local.set({
                taskStage: 'stopped',
                amazonLoginConfirmed: false,
                studyError: 'The participant ID does not match this browser’s registration. Contact the researcher.'
            });
            return;
        }
        if (old && [
            'shopping',
            'final',
            'done',
            'stopped'
        ].includes(s.taskStage)) return;
        const context = {
            ...assignment,
            sessionId: old?.sessionId || crypto.randomUUID(),
            expiresAt: old?.expiresAt || Date.now() + SESSION_MAX_MS
        };
        await chrome.storage.local.set({
            studyContext: context,
            studyTabId: tabId,
            uva_study_arm: context.arm,
            uva_study_product_category: context.category,
            taskStage: 'registering',
            amazonLoginConfirmed: false,
            studyError: '',
            buildMode: this.backend.preview ? 'preview' : 'production'
        });
        try {
            const user = s.user || await this.backend.register(context.prolificId);
            if (!user || user.prolificId !== context.prolificId || user.active === false) {
                throw new Error('Registration is unavailable for this participant. Contact the researcher.');
            }
            context.sessionId = user.sessionUid || context.sessionId;
            await chrome.storage.local.set({
                user,
                studyContext: context,
                taskStage: 'shopping',
                shoppingTaskStartedAt: null,
                shoppingTaskStoppedAt: null,
                finalChoice: null,
                finalChoiceEventQueued: false,
                surveyOpenedAt: null,
                surveyTabId: null,
                panelCloseStatus: null,
                decisionTracked: false,
                decisionMadeAt: null,
                cartBaselineCaptured: false,
                cartBaselineSuppressionLogged: false,
                currentCart: null,
                surveys: [],
                studySummary: {},
                addedAsins: [],
                summarySent: false,
                studyError: '',
                registrationCompletedAt: Date.now()
            });
            await this.backend.track('registration_completed', {
                source: 'amazon_handoff'
            });
        } catch (e) {
            await chrome.storage.local.set({
                taskStage: 'initial',
                amazonLoginConfirmed: false,
                studyError: e instanceof Error ? e.message : 'Registration failed. Check your connection and retry.'
            });
        }
    }
    async login(loggedIn) {
        const s = await chrome.storage.local.get([
            'taskStage',
            'amazonLoginConfirmed',
            'shoppingTaskStartedAt'
        ]);
        if (s.taskStage !== 'shopping' || s.amazonLoginConfirmed === loggedIn) return;
        await chrome.storage.local.set({
            amazonLoginConfirmed: loggedIn,
            ...loggedIn ? {
                shoppingTaskStartedAt: s.shoppingTaskStartedAt || Date.now()
            } : {}
        });
        if (loggedIn) await this.backend.track('amazon_login_confirmed', {});
    }
    async confirm(asin, tabId) {
        const s = await chrome.storage.local.get(null);
        if (s.taskStage === 'final' && s.finalChoice) {
            await this.ensureFinalChoiceEvent();
            return;
        }
        if (s.taskStage !== 'shopping' || !s.amazonLoginConfirmed || !s.studyContext || s.studyContext.expiresAt <= Date.now()) {
            throw new Error('The shopping task must be active and you must be signed into Amazon.');
        }
        const tab = await chrome.tabs.get(tabId);
        if (!isCartUrl(tab.url) || new URL(tab.url).origin !== s.studyContext.origin) {
            throw new Error('Open your Amazon cart in the study tab first.');
        }
        const cart = await chrome.tabs.sendMessage(tabId, {
            type: 'study_read_cart'
        }, {
            frameId: 0
        });
        if (!cart?.ok || cart.loggedIn !== true) throw new Error('Your cart could not be verified. Sign in and refresh the cart.');
        const selected = validateChoice(cart.items, asin);
        const now = Date.now();
        const choice = {
            ...selected,
            confirmedAt: now,
            source: 'explicit_panel_confirmation',
            add_click_observed: (s.addedAsins || []).includes(asin),
            selection_latency_ms: s.shoppingTaskStartedAt ? now - s.shoppingTaskStartedAt : null
        };
        await chrome.storage.local.set({
            taskStage: 'final',
            amazonLoginConfirmed: false,
            shoppingTaskStoppedAt: now,
            finalChoice: choice,
            studyTabId: tabId,
            studyError: ''
        });
        await this.ensureFinalChoiceEvent();
    }
    async ensureFinalChoiceEvent() {
        const s = await chrome.storage.local.get([
            'finalChoice',
            'finalChoiceEventQueued',
            'taskStage'
        ]);
        if (s.taskStage !== 'final' || !s.finalChoice || s.finalChoiceEventQueued) return;
        await this.backend.track('final_choice_confirmed', s.finalChoice);
        await chrome.storage.local.set({
            finalChoiceEventQueued: true
        });
    }
    async openSurvey() {
        const s = await chrome.storage.local.get(null);
        if (s.taskStage !== 'final' || !s.finalChoice) throw new Error('Confirm your chosen product first.');
        if (s.surveyOpenedAt) return;
        await this.ensureFinalChoiceEvent();
        if (this.backend.preview) {
            await chrome.storage.local.set({
                previewSurveyReady: true
            });
            const base = s.previewP2Url ?? FINAL_SURVEY_URL;
            if (base) {
                const url = new URL(makeSurveyUrl(validateQualtricsUrl(base), s.studyContext));
                url.searchParams.set('webmunk_test', '1');
                await this.navigateToSurvey(url.href, s.studyTabId);
            }
            return;
        }
        const url = makeSurveyUrl(await this.backend.surveyUrl(), s.studyContext);
        await chrome.storage.local.set({
            surveys: [
                {
                    name: 'Follow-up survey',
                    url
                }
            ]
        });
        await this.navigateToSurvey(url, s.studyTabId);
    }
    async navigateToSurvey(url, studyTabId) {
        const source = studyTabId == null ? null : await chrome.tabs.get(studyTabId).catch(()=>null);
        const tab = await chrome.tabs.create({
            url,
            active: true,
            ...source?.windowId != null ? {
                windowId: source.windowId
            } : {}
        });
        await chrome.storage.local.set({
            surveyOpenedAt: Date.now(),
            surveyTabId: tab.id
        });
        const panel = chrome.sidePanel;
        const windowId = tab.windowId ?? source?.windowId;
        if (typeof panel.close !== 'function' || windowId == null) {
            await chrome.storage.local.set({
                panelCloseStatus: 'unavailable'
            });
            return;
        }
        try {
            await panel.close({
                windowId
            });
            await chrome.storage.local.set({
                panelCloseStatus: 'closed'
            });
        } catch  {
            await chrome.storage.local.set({
                panelCloseStatus: 'failed'
            });
        }
    }
}

Object.assign(exports, {StudyService});
},
4:function(module,exports,__require){
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
5:function(module,exports,__require){
const FINAL_SURVEY_URL = 'https://uva.fra1.qualtrics.com/jfe/form/SV_dm4HvTdtNMHXymO';

Object.assign(exports, {FINAL_SURVEY_URL});
}
};const __cache={};function __require(id){if(__cache[id])return __cache[id].exports;const m={exports:{}};__cache[id]=m;__modules[id](m,m.exports,__require);return m.exports;}return __require(0);})();
