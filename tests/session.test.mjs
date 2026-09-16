import test from 'node:test';
import assert from 'node:assert/strict';
import {load,mockChrome,send} from './helpers.mjs';
const pid='0123456789abcdef01234567';
const handoff='https://www.amazon.com/?PROLIFIC_PID='+pid+'&arm=classic&category=Headphones';
function fixture(seed={}) {
  const m=mockChrome(seed), events=[];
  const backend={preview:false,async register(id){return {prolificId:id,uid:'u1',sessionUid:'canonical-session',active:true};},
    async track(e,p){events.push([e,p]);},async surveyUrl(){return 'https://study.qualtrics.com/jfe/form/P2';}};
  const {StudyService}=load('src/worker/StudyService.ts',m.chrome);
  return {...m,events,backend,service:new StudyService(backend)};
}
test('assignment is stored before registration resolves; no tracking during registration',async()=>{
  const f=fixture(); let release;
  f.backend.register=()=>new Promise(r=>{release=r;});
  const pending=f.service.enroll(handoff,7);
  while(!release)await new Promise(r=>setTimeout(r,0));
  assert.equal(f.local.taskStage,'registering');assert.equal(f.local.uva_study_arm,'classic');assert.equal(f.local.amazonLoginConfirmed,false);
  release({prolificId:pid,uid:'u',sessionUid:'server-session',active:true});await pending;
  assert.equal(f.local.taskStage,'shopping');assert.equal(f.local.studyContext.sessionId,'server-session');
});
test('valid handoff auto-registers PID and repeated page load does not restart',async()=>{
  const f=fixture();await f.service.enroll(handoff,7);await f.service.login(true);
  const started=f.local.shoppingTaskStartedAt;await f.service.enroll(handoff,7);
  assert.equal(f.local.user.prolificId,pid);assert.equal(f.local.amazonLoginConfirmed,true);assert.equal(f.local.shoppingTaskStartedAt,started);
  assert.equal(f.events.filter(e=>e[0]==='registration_completed').length,1);
});
test('missing PID/arm fails closed with visible error',async()=>{
  const f=fixture();await f.service.enroll(handoff.replace('&arm=classic',''),7);
  assert.equal(f.local.taskStage,'initial');assert.ok(f.local.studyError);assert.equal(f.events.length,0);
});
test('different PID or condition cannot reuse a live session',async()=>{
  for(const u of [handoff.replace(pid,'abcdef0123456789abcdef01'),handoff.replace('classic','chat')]) {
    const f=fixture();await f.service.enroll(handoff,7);await f.service.enroll(u,7);
    assert.equal(f.local.taskStage,'stopped');assert.equal(f.local.studyContext.arm,'classic');assert.ok(f.local.studyError);
  }
});
test('legacy stored registration cannot silently become a new session on update',async()=>{
  const f=fixture({user:{prolificId:pid,uid:'old',active:true},taskStage:'final'});
  await f.service.enroll(handoff,7);assert.equal(f.local.taskStage,'stopped');assert.ok(f.local.studyError);
  assert.equal(f.local.studyContext,undefined);assert.equal(f.events.length,0);
});
test('registration failure stays non-shopping and is retryable',async()=>{
  const f=fixture();const register=f.backend.register;f.backend.register=async()=>{throw Error('offline');};
  await f.service.enroll(handoff,7);assert.equal(f.local.taskStage,'initial');assert.equal(f.local.studyError,'offline');
  f.backend.register=register;await f.service.enroll(handoff,7);assert.equal(f.local.taskStage,'shopping');
});
test('login before enrollment and after completion cannot start the clock',async()=>{
  const f=fixture();await f.service.login(true);assert.equal(f.local.amazonLoginConfirmed,undefined);
  await f.service.enroll(handoff,7);await f.service.login(true);await f.service.confirm('B000000001',7);
  await f.service.login(true);assert.equal(f.local.amazonLoginConfirmed,false);assert.equal(f.local.taskStage,'final');
});
test('live cart revalidation rejects missing row and logged-out cart',async()=>{
  const f=fixture();await f.service.enroll(handoff,7);await f.service.login(true);
  await assert.rejects(()=>f.service.confirm('B000000099',7));assert.equal(f.local.taskStage,'shopping');
  f.chrome.tabs.sendMessage=async()=>({ok:true,loggedIn:false,items:[{asin:'B000000001',title:'A'}]});
  await assert.rejects(()=>f.service.confirm('B000000001',7));assert.equal(f.local.taskStage,'shopping');
});
test('explicit confirmation stops tracking before event submission; retry is idempotent',async()=>{
  const f=fixture();await f.service.enroll(handoff,7);await f.service.login(true);
  f.backend.track=async(e,p)=>{if(e==='final_choice_confirmed'){assert.equal(f.local.taskStage,'final');assert.equal(f.local.amazonLoginConfirmed,false);}f.events.push([e,p]);};
  await f.service.confirm('B000000001',7);await f.service.confirm('B000000001',7);
  assert.equal(f.events.filter(e=>e[0]==='final_choice_confirmed').length,1);
  assert.equal(f.local.finalChoice.asin,'B000000001');assert.equal(f.local.finalChoice.add_click_observed,false);
  await f.service.openSurvey();const u=new URL(f.calls.find(c=>c[0]==='create')[1].url);
  assert.equal(u.searchParams.get('session_id'),'canonical-session');assert.equal(u.searchParams.get('PROLIFIC_PID'),pid);
});
test('P2 configuration failure does not reactivate tracking',async()=>{
  const f=fixture();await f.service.enroll(handoff,7);await f.service.login(true);await f.service.confirm('B000000001',7);
  f.backend.surveyUrl=async()=>{throw Error('unavailable');};await assert.rejects(()=>f.service.openSurvey());
  assert.equal(f.local.taskStage,'final');assert.equal(f.local.amazonLoginConfirmed,false);assert.equal(f.calls.length,0);
});
test('failed final event queueing can be retried without restarting shopping',async()=>{
  const f=fixture();await f.service.enroll(handoff,7);await f.service.login(true);
  const track=f.backend.track;f.backend.track=async()=>{throw Error('storage failure');};
  await assert.rejects(()=>f.service.confirm('B000000001',7));assert.equal(f.local.taskStage,'final');
  assert.equal(f.local.finalChoiceEventQueued,false);f.backend.track=track;
  await f.service.confirm('B000000001',7);assert.equal(f.local.finalChoiceEventQueued,true);
  assert.equal(f.events.filter(e=>e[0]==='final_choice_confirmed').length,1);
});
test('worker suspension preserves summary; replayed messages do not restart completed session',async()=>{
  const f=mockChrome();load('src/worker/Worker.ts',f.chrome);
  const sender={url:handoff,frameId:0,tab:{id:7,windowId:1,url:handoff}};
  await send(f.chrome,{type:'study_context'},sender);await send(f.chrome,{type:'amazon_login_status',loggedIn:true},sender);
  await send(f.chrome,{type:'telemetry',event:'search_submitted',properties:{query:'headphones'}},sender);
  const restored=mockChrome(f.local);load('src/worker/Worker.ts',restored.chrome);
  await send(restored.chrome,{type:'telemetry',event:'search_submitted',properties:{query:'wireless'}},sender);
  assert.equal(restored.local.studySummary.search_count,2);
  await send(restored.chrome,{type:'study_confirm',asin:'B000000001',confirmed:true});
  await send(restored.chrome,{type:'study_context'},sender);assert.equal(restored.local.taskStage,'final');
  assert.equal(restored.local.previewEvents.filter(e=>e.event_type==='session_summary').length,1);
});
test('empty cart cannot finish; an explicit stop stops collection',async()=>{
  const f=mockChrome();load('src/worker/Worker.ts',f.chrome);
  const sender={url:handoff,frameId:0,tab:{id:7,windowId:1}};
  await send(f.chrome,{type:'study_context'},sender);await send(f.chrome,{type:'amazon_login_status',loggedIn:true},sender);
  f.chrome.tabs.sendMessage=async()=>({ok:true,loggedIn:true,items:[]});
  assert.equal((await send(f.chrome,{type:'study_confirm',asin:'B000000001',confirmed:true})).ok,false);
  assert.equal(f.local.taskStage,'shopping');await send(f.chrome,{type:'study_stop'});
  const count=f.local.previewEvents.length;await send(f.chrome,{type:'telemetry',event:'search_submitted',properties:{}},sender);
  assert.equal(f.local.previewEvents.length,count);assert.equal(f.local.taskStage,'stopped');
});
test('worker: nonempty cart is not completion, explicit choice creates summary, no post-final telemetry',async()=>{
  const f=mockChrome();load('src/worker/Worker.ts',f.chrome);
  const sender={url:handoff,frameId:0,tab:{id:7,windowId:1,url:handoff}};
  assert.equal((await send(f.chrome,{type:'study_context'},sender)).ok,true);
  assert.equal((await send(f.chrome,{type:'amazon_login_status',loggedIn:true},sender)).ok,true);
  const cartSender={...sender,url:f.tab.url};
  await send(f.chrome,{type:'telemetry',event:'cart_snapshot',properties:{items:[{asin:'B000000001',title:'A'}],item_count:1}},cartSender);
  assert.equal(f.local.taskStage,'shopping');assert.equal(f.local.previewEvents.some(e=>e.event_type==='final_choice_confirmed'),false);
  const finish=await send(f.chrome,{type:'study_confirm',asin:'B000000001',confirmed:true});assert.equal(finish.ok,true,finish.error);
  assert.equal(f.local.taskStage,'final');assert.equal(f.local.previewSurveyReady,true);
  const p2=new URL(f.calls.find(c=>c[0]==='create')[1].url);
  assert.equal(p2.origin+p2.pathname,'https://uva.fra1.qualtrics.com/jfe/form/SV_dm4HvTdtNMHXymO');
  assert.equal(p2.searchParams.get('webmunk_test'),'1');
  assert.equal(p2.searchParams.get('PROLIFIC_PID'),pid);
  assert.equal(p2.searchParams.get('session_id'),f.local.studyContext.sessionId);
  assert.equal(p2.searchParams.get('arm'),'classic');
  assert.equal(p2.searchParams.get('category'),'Headphones');
  assert.equal(p2.searchParams.get('budget'),'350');
  assert.equal(f.local.previewEvents.filter(e=>e.event_type==='session_summary').length,1);
  const count=f.local.previewEvents.length;
  await send(f.chrome,{type:'telemetry',event:'search_submitted',properties:{query:'after stop'}},sender);
  await send(f.chrome,{type:'amazon_login_status',loggedIn:true},sender);
  assert.equal(f.local.previewEvents.length,count);assert.equal(f.local.amazonLoginConfirmed,false);
});
test('worker side panel opens synchronously from user-gesture message',async()=>{
  const f=mockChrome();load('src/worker/Worker.ts',f.chrome);
  const result=send(f.chrome,{type:'study_open_panel'},{url:'https://www.amazon.com/',frameId:0,tab:{id:7,windowId:1}});
  assert.equal(f.calls.some(c=>c[0]==='panel'),true);assert.equal((await result).ok,true);
});
test('abandoned sessions expire without collecting another event',async()=>{
  const f=mockChrome();load('src/worker/Worker.ts',f.chrome);
  const sender={url:handoff,frameId:0,tab:{id:7,windowId:1}};
  await send(f.chrome,{type:'study_context'},sender);await send(f.chrome,{type:'amazon_login_status',loggedIn:true},sender);
  f.local.studyContext.expiresAt=Date.now()-1;
  await send(f.chrome,{type:'telemetry',event:'search_submitted',properties:{query:'too late'}},sender);
  assert.equal(f.local.taskStage,'stopped');assert.equal(f.local.amazonLoginConfirmed,false);
  assert.equal(f.local.previewEvents.some(e=>e.query==='too late'),false);
});
test('content script cannot impersonate the panel and finish the task',async()=>{
  const f=mockChrome();load('src/worker/Worker.ts',f.chrome);
  const result=await send(f.chrome,{type:'study_confirm',asin:'B000000001',confirmed:true},{url:handoff,frameId:0,tab:{id:7,windowId:1}});
  assert.equal(result.ok,false);assert.equal(f.local.finalChoice,undefined);
});
test('tester can disable P2; content scripts cannot change the P2 destination',async()=>{
  const f=mockChrome();load('src/worker/Worker.ts',f.chrome);
  const sender={url:handoff,frameId:0,tab:{id:7,windowId:1}};
  assert.equal((await send(f.chrome,{type:'study_preview_p2',url:''},sender)).ok,false);
  assert.equal((await send(f.chrome,{type:'study_preview_p2',url:'https://evil.test/'})).ok,false);
  assert.equal((await send(f.chrome,{type:'study_preview_p2',url:''})).ok,true);
  await send(f.chrome,{type:'study_context'},sender);await send(f.chrome,{type:'amazon_login_status',loggedIn:true},sender);
  await send(f.chrome,{type:'study_confirm',asin:'B000000001',confirmed:true});
  assert.equal(f.calls.some(c=>c[0]==='create'),false);
});
test('P2 opens in the study window before its panel closes; repeats do not duplicate P2',async()=>{
  const f=fixture();await f.service.enroll(handoff,7);await f.service.login(true);await f.service.confirm('B000000001',7);
  f.chrome.sidePanel.close=async options=>{
    assert.ok(f.local.surveyOpenedAt);assert.equal(f.calls.at(-1)[0],'create');
    f.calls.push(['close',options]);
  };
  await f.service.openSurvey();await f.service.openSurvey();
  assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
  assert.equal(f.calls.find(c=>c[0]==='create')[1].windowId,1);
  assert.equal(f.calls.find(c=>c[0]==='close')[1].windowId,1);
  assert.equal(f.local.panelCloseStatus,'closed');
});
test('unsupported or rejected panel closure preserves completion and never restarts tracking',async()=>{
  for(const fail of [false,true]) {
    const f=fixture();await f.service.enroll(handoff,7);await f.service.login(true);await f.service.confirm('B000000001',7);
    if(fail)f.chrome.sidePanel.close=async()=>{throw Error('unsupported browser behavior');};
    await f.service.openSurvey();
    assert.ok(f.local.surveyOpenedAt);assert.equal(f.local.panelCloseStatus,fail?'failed':'unavailable');
    assert.equal(f.local.taskStage,'final');assert.equal(f.local.amazonLoginConfirmed,false);
  }
});
test('failed P2 navigation keeps completion retryable and does not close the panel',async()=>{
  const f=fixture();await f.service.enroll(handoff,7);await f.service.login(true);await f.service.confirm('B000000001',7);
  const create=f.chrome.tabs.create;let closed=false;
  f.chrome.sidePanel.close=async()=>{closed=true;};f.chrome.tabs.create=async()=>{throw Error('tab failed');};
  await assert.rejects(()=>f.service.openSurvey());assert.equal(f.local.surveyOpenedAt,null);assert.equal(closed,false);
  assert.equal(f.local.taskStage,'final');f.chrome.tabs.create=create;
  await f.service.openSurvey();assert.ok(f.local.surveyOpenedAt);assert.equal(closed,true);
});
