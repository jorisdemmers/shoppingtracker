(function(){"use strict";const __modules={
0:function(module,exports,__require){
const { isCartUrl } = __require(1);
const { FINAL_SURVEY_URL } = __require(2);
const el = (id)=>document.getElementById(id);
const show = (id, yes)=>{
    el(id).hidden = !yes;
};
const preview = chrome.runtime.getManifest().name.includes('LOCAL PREVIEW');
const previewTools = preview && location.pathname.endsWith('/preview-tools.html');
let selected = '';
let itemsKey = '';
let busy = false;
let actionError = '';
let state = {};
function updateConfirm() {
    el('confirm').disabled = busy || !selected || !el('confirmed').checked || !state.amazonLoginConfirmed;
}
async function action(type, extra = {}) {
    if (busy) return;
    busy = true;
    actionError = '';
    updateConfirm();
    show('error', false);
    document.querySelectorAll('button').forEach((b)=>{
        b.disabled = true;
    });
    try {
        const result = await chrome.runtime.sendMessage({
            type,
            ...extra
        });
        if (!result?.ok) throw new Error(result?.error || 'The extension did not respond. Reload Amazon and try again.');
    } catch (e) {
        actionError = e instanceof Error ? e.message : String(e);
        el('error').textContent = actionError;
        show('error', true);
    } finally{
        busy = false;
        document.querySelectorAll('button').forEach((b)=>{
            b.disabled = false;
        });
        await render();
        updateConfirm();
    }
}
async function render() {
    state = await chrome.storage.local.get(null);
    const stage = state.taskStage || 'initial', c = state.studyContext;
    const completed = stage === 'final' && !!state.surveyOpenedAt;
    show('completedOnly', completed && !previewTools);
    show('studyUi', !completed || previewTools);
    if (completed && !previewTools) return;
    show('preview', preview);
    show('testTools', preview);
    const p2Url = state.previewP2Url ?? FINAL_SURVEY_URL;
    if (document.activeElement !== el('p2Url')) el('p2Url').value = p2Url;
    el('p2Status').textContent = p2Url ? 'P2 is connected. Confirmation will open Qualtrics with a test marker.' : 'P2 disabled; completion stays local.';
    show('waiting', stage === 'initial' || stage === 'registering');
    el('retry').disabled = busy || stage === 'registering';
    show('task', stage === 'shopping');
    show('finished', stage === 'final');
    show('stopped', stage === 'stopped' || stage === 'done');
    el('status').textContent = stage === 'registering' ? 'Registering your study session…' : stage === 'shopping' ? 'Shopping task in progress' : stage === 'final' ? 'Final product confirmed' : stage === 'stopped' || stage === 'done' ? 'Shopping task stopped' : 'Waiting for the study’s Amazon link';
    el('error').textContent = state.studyError || actionError;
    show('error', !!(state.studyError || actionError));
    if (state.dataUploadError) el('upload').textContent = state.dataUploadError;
    show('upload', !!state.dataUploadError);
    if (c) {
        el('assignment').textContent = 'Your task: ' + c.category + ' · Budget: $' + c.budget;
        el('pid').textContent = 'Participant ID: ' + c.prolificId;
        show('guided', c.arm === 'chat');
    }
    show('login', stage === 'shopping' && !state.amazonLoginConfirmed);
    const cart = state.currentCart;
    show('cartReview', !!cart && isCartUrl(cart.url));
    const items = cart?.items || [];
    const key = JSON.stringify(items);
    if (key !== itemsKey) {
        itemsKey = key;
        selected = '';
        el('confirmed').checked = false;
        el('items').replaceChildren();
        items.forEach((item)=>{
            const label = document.createElement('label');
            label.className = 'product';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'product';
            radio.value = item.asin;
            radio.addEventListener('change', ()=>{
                selected = item.asin;
                el('confirmed').checked = false;
                updateConfirm();
            });
            const text = document.createElement('span');
            text.textContent = item.title + ' — ' + (item.price || 'Price not detected; check the Amazon page') + ' (' + item.asin + ')';
            label.append(radio, text);
            el('items').append(label);
        });
    }
    show('cartHelp', items.length === 0);
    el('cartHelp').textContent = cart && isCartUrl(cart.url) ? 'No readable active-cart products were found. Add your choice, reload Amazon, then refresh this list. Do not continue if the wrong product is shown.' : 'Open your Amazon cart to see the products available for confirmation.';
    if (state.finalChoice) el('choice').textContent = 'Chosen product: ' + state.finalChoice.title;
    show('previewDone', preview && stage === 'final');
    el('continue').textContent = preview && !p2Url ? 'Verify preview completion' : 'Continue to follow-up survey';
    if (previewTools) {
        for (const id of [
            'waiting',
            'task',
            'finished',
            'stopped',
            'status'
        ])show(id, false);
    }
    updateConfirm();
}
el('retry').addEventListener('click', ()=>void action('study_retry'));
el('saveP2').addEventListener('click', ()=>void action('study_preview_p2', {
        url: el('p2Url').value.trim()
    }));
el('cart').addEventListener('click', ()=>void action('study_cart'));
el('refresh').addEventListener('click', ()=>void action('study_refresh_cart'));
el('confirm').addEventListener('click', ()=>void action('study_confirm', {
        asin: selected,
        confirmed: el('confirmed').checked
    }));
el('confirmed').addEventListener('change', updateConfirm);
el('continue').addEventListener('click', ()=>void action('study_continue'));
el('stop').addEventListener('click', ()=>{
    if (window.confirm('Stop the shopping task and stop collecting shopping activity? This cannot be undone for this session.')) void action('study_stop');
});
el('reset').addEventListener('click', ()=>{
    if (window.confirm('Clear this preview session and its local test events? Download events first if you want to keep them.')) void action('study_preview_reset');
});
el('export').addEventListener('click', async ()=>{
    const s = await chrome.storage.local.get([
        'previewEvents',
        'studyContext',
        'finalChoice',
        'studySummary',
        'taskStage'
    ]);
    const url = URL.createObjectURL(new Blob([
        JSON.stringify(s, null, 2)
    ], {
        type: 'application/json'
    }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'webmunk-local-test.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
});
chrome.storage.onChanged.addListener((_changes, area)=>{
    if (area === 'local') void render();
});
void render();

Object.assign(exports, {});
},
1:function(module,exports,__require){
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
2:function(module,exports,__require){
const FINAL_SURVEY_URL = 'https://uva.fra1.qualtrics.com/jfe/form/SV_dm4HvTdtNMHXymO';

Object.assign(exports, {FINAL_SURVEY_URL});
}
};const __cache={};function __require(id){if(__cache[id])return __cache[id].exports;const m={exports:{}};__cache[id]=m;__modules[id](m,m.exports,__require);return m.exports;}return __require(0);})();
