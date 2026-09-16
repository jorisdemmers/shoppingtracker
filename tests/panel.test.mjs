import test from 'node:test';
import assert from 'node:assert/strict';
import {load,mockChrome} from './helpers.mjs';
async function render(seed,path='/popup/popup.html') {
  const f=mockChrome(seed),els=new Map();
  const element=id=>{if(!els.has(id))els.set(id,{hidden:false,value:'',checked:false,disabled:false,textContent:'',addEventListener(){},replaceChildren(){}});return els.get(id);};
  const document={getElementById:element,activeElement:null,querySelectorAll:()=>[]};
  load('src/popup/Popup.ts',f.chrome,{document,location:{pathname:path}});
  await new Promise(resolve=>setTimeout(resolve,0));
  return {element};
}
test('panel reminder is visible only in the guided chat arm',async()=>{
  for(const arm of ['classic','chat_no_guide','chat']) {
    const {element}=await render({taskStage:'shopping',studyContext:{arm,category:'Headphones',budget:350}});
    assert.equal(element('guided').hidden,arm!=='chat');
  }
});
test('successful P2 handoff hides the entire panel interface except completion text',async()=>{
  const {element}=await render({taskStage:'final',surveyOpenedAt:123});
  assert.equal(element('studyUi').hidden,true);assert.equal(element('completedOnly').hidden,false);
});
test('before successful P2 handoff, retry interface remains visible',async()=>{
  const {element}=await render({taskStage:'final',surveyOpenedAt:null});
  assert.equal(element('studyUi').hidden,false);assert.equal(element('finished').hidden,false);
  assert.equal(element('completedOnly').hidden,true);
});
test('separate preview tools remain available after completion without changing participant panel',async()=>{
  const {element}=await render({taskStage:'final',surveyOpenedAt:123},'/popup/preview-tools.html');
  assert.equal(element('testTools').hidden,false);assert.equal(element('studyUi').hidden,false);
  assert.equal(element('finished').hidden,true);assert.equal(element('completedOnly').hidden,true);
});
