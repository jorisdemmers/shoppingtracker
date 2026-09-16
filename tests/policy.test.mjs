import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './helpers.mjs';
const p=load('src/shared/StudyPolicy.ts');
const url='https://www.amazon.com/?PROLIFIC_PID=0123456789abcdef01234567&arm=classic&category=Headphones';
const c={...p.parseAssignment(url),sessionId:'session-1',expiresAt:Date.now()+3600000};
test('three arms and category budgets are strict',()=>{
  for(const arm of ['classic','chat','chat_no_guide']) assert.equal(p.parseAssignment(url.replace('classic',arm)).arm,arm);
  for(const [category,budget]of [['Headphones',350],['Backpack',150],['Robot%20Vacuum',500]]) assert.equal(p.parseAssignment(url.replace('Headphones',category)).budget,budget);
  for(const invalid of [url.replace('classic','garbage'),url.replace('Headphones','camera'),url.replace('0123456789abcdef01234567',''),url.replace('&arm=classic','')]) assert.equal(p.parseAssignment(invalid),null);
});
test('actual P1 category values normalize to canonical categories and budgets',()=>{
  for(const [raw,name,budget] of [['new Headphones','Headphones',350],['a new Backpack','Backpack',150],['a new Robot Vacuum','Robot Vacuum',500]]) {
    const result=p.parseAssignment(url.replace('Headphones',encodeURIComponent(raw)));
    assert.equal(result.category,name);assert.equal(result.budget,budget);
  }
});
test('P2 settings accept respondent links and reject editor/lookalike/insecure URLs',()=>{
  const good='https://uva.fra1.qualtrics.com/jfe/form/SV_dm4HvTdtNMHXymO';
  assert.equal(p.validateQualtricsUrl(good),good);
  for(const bad of ['http://uva.qualtrics.com/jfe/form/SV_123','https://qualtrics.com.evil.test/jfe/form/SV_123','https://uva.qualtrics.com/survey-builder/SV_123','https://user:pass@uva.qualtrics.com/jfe/form/SV_123']) assert.throws(()=>p.validateQualtricsUrl(bad));
});
test('Amazon scope rejects lookalikes and non-HTTPS; excludes account/checkout',()=>{
  for(const u of ['https://amazon.com.evil.test/','https://notamazon.com/','http://www.amazon.com/','https://user:pass@amazon.com/','https://qualtrics.com/']) assert.equal(p.isAmazonUrl(u),false,u);
  for(const u of ['https://www.amazon.com/ap/signin','https://www.amazon.com/gp/css/homepage.html','https://www.amazon.com/gp/buy/spc/handlers/display.html','https://www.amazon.com/checkout']) assert.equal(p.isShoppingUrl(u),false,u);
  assert.equal(p.isShoppingUrl('https://www.amazon.com/s?k=headphones'),true);
});
test('tracking requires active matching session, user and sign-in',()=>{
  const state={taskStage:'shopping',amazonLoginConfirmed:true,studyContext:c,user:{prolificId:c.prolificId,active:true}};
  assert.equal(p.canTrack(state,url),true);
  for(const stage of [null,'initial','registering','final','done','stopped']) assert.equal(p.canTrack({...state,taskStage:stage},url),false);
  assert.equal(p.canTrack({...state,amazonLoginConfirmed:false},url),false);
  assert.equal(p.canTrack({...state,user:{prolificId:'different'}},url),false);
  assert.equal(p.canTrack(state,'https://www.amazon.de/'),false);
  assert.equal(p.canTrack({...state,studyContext:{...c,expiresAt:Date.now()-1}},url),false);
});
test('logging strips handoff IDs, tokens and fragments',()=>{
  assert.equal(p.cleanUrl(url+'&token=secret&k=backpack#secret'),'https://www.amazon.com/?k=backpack');
  assert.equal(p.cleanUrl('https://www.amazon.com/ap/signin?password=secret'),'');
});
test('P2 URL preserves existing query/hash and attaches all join fields',()=>{
  const u=new URL(p.makeSurveyUrl('https://survey.qualtrics.com/jfe/form/ABC?x=1#part2',c));
  assert.equal(u.searchParams.get('x'),'1');assert.equal(u.hash,'#part2');
  for(const [key,value]of Object.entries({PROLIFIC_PID:c.prolificId,arm:'classic',category:'Headphones',budget:'350',session_id:'session-1'})) assert.equal(u.searchParams.get(key),value);
  assert.throws(()=>p.makeSurveyUrl('javascript:alert(1)',c));
});
test('final choice needs exactly one matching, readable cart row',()=>{
  const item={asin:'B000000001',title:'Product'};
  assert.equal(p.validateChoice([item],item.asin),item);
  for(const items of [[],[item,item],[{asin:item.asin,title:''}]]) assert.throws(()=>p.validateChoice(items,item.asin));
  assert.throws(()=>p.validateChoice([item],'B000000002'));
});
