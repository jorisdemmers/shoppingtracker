import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {bundle} from '../scripts/preview-bundle.mjs';
function fixture(width=330, inlineWidget=false) {
  const style=()=>{const v=new Map();return {getPropertyValue:k=>v.get(k)?.[0]||'',getPropertyPriority:k=>v.get(k)?.[1]||'',setProperty(k,x,p){v.set(k,[x,p]);},removeProperty(k){v.delete(k);}};};
  const node=(rect={left:0,right:330,width:330,height:850})=>({style:style(),dataset:{},parentElement:null,isConnected:true,matches:()=>false,getBoundingClientRect:()=>rect,querySelector:()=>null,getAttribute:()=>'',textContent:''});
  const html=node(),shell=node({left:0,right:width,width,height:850}),seed=node(),button=node();
  const bodyClasses=new Set();
  const body={...node(),classList:{contains:c=>bodyClasses.has(c),add:c=>bodyClasses.add(c),remove:c=>bodyClasses.delete(c)},
    get className(){return [...bodyClasses].join(' ');},set className(v){bodyClasses.clear();String(v).split(/\s+/).filter(Boolean).forEach(c=>bodyClasses.add(c));},
    setAttribute(n,v){if(n==='class')body.className=v;},removeAttribute(){},getAttribute:()=>''};
  shell.parentElement=body;seed.parentElement=shell;
  if (inlineWidget) seed.id="dpx-rex-nice-widget-container";
  let closes=0;shell.querySelector=()=>({click(){closes++;}});
  button.textContent='Alexa for shopping';
  const doc={body,documentElement:html,createElement(){return {...node(),remove(){this.isConnected=false;}};},querySelectorAll(q){if(inlineWidget) return q.split(",").includes("#dpx-rex-nice-widget-container")?[seed]:[];return q==='button,[role="button"],#nav-main a,#nav-belt a'?[button]:[seed,button];}};
  html.append=()=>{};
  const storage=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem(k,v){m.set(k,v);},removeItem(k){m.delete(k);}};};
  const {AssistantControl}=vm.runInNewContext(bundle(resolve('src/content/AssistantControl.ts')),{document:doc,window:{innerWidth:1400,innerHeight:900},MutationObserver:class{observe(){}disconnect(){}},getComputedStyle:()=>({}),sessionStorage:storage(),localStorage:storage()});
  return {control:new AssistantControl(),shell,seed,button,body,bodyClasses,closes:()=>closes};
}
test('classic hides the tall dock shell and uses its scoped close control once',()=>{
  const f=fixture();f.control.setEnabled(true);f.control.setEnabled(true);
  assert.equal(f.shell.style.getPropertyValue('display'),'none');assert.equal(f.closes(),1);
  f.control.setEnabled(false);assert.equal(f.shell.style.getPropertyValue('display'),'');
});
test('a wide page wrapper is never treated as an assistant dock',()=>{
  const f=fixture(1200);f.control.setEnabled(true);
  assert.equal(f.seed.style.getPropertyValue('display'),'none');
  assert.equal(f.shell.style.getPropertyValue('display'),'');assert.equal(f.closes(),0);
});
test('leaving classic restores inline styles and removes extension-added control markers',()=>{
  const f=fixture();f.seed.style.setProperty('display','flex','');f.control.setEnabled(true);
  assert.equal(f.button.dataset.wmAssistantControl,'true');f.control.setEnabled(false);
  assert.equal(f.seed.style.getPropertyValue('display'),'flex');assert.equal(f.button.dataset.wmAssistantControl,undefined);
});
test('classic clears the body-level rufus dock gutter, not just descendant panels',()=>{
  const f=fixture();
  f.bodyClasses.add('rufus-docked-left');f.bodyClasses.add('rufus-docked-adjustable');
  f.body.style.setProperty('padding-left','320px','');
  f.control.setEnabled(true);
  assert.equal(f.body.classList.contains('rufus-docked-left'),false);
  assert.equal(f.body.classList.contains('rufus-docked-adjustable'),false);
  assert.equal(f.body.style.getPropertyValue('padding-left'),'');
});

test('classic suppresses the complete inline Alexa widget without hiding its narrow page ancestor',()=>{
  const f=fixture(330,true);f.control.setEnabled(true);
  assert.equal(f.seed.style.getPropertyValue('display'),'none');
  assert.equal(f.seed.style.getPropertyPriority('display'),'important');
  assert.equal(f.shell.style.getPropertyValue('display'),'');
  assert.equal(f.closes(),0);
});
test('inline widget remains available when suppression is disabled and is restored after classic',()=>{
  const f=fixture(330,true);f.seed.style.setProperty('display','block','');
  f.control.setEnabled(false);
  assert.equal(f.seed.style.getPropertyValue('display'),'block');
  f.control.setEnabled(true);f.control.setEnabled(false);
  assert.equal(f.seed.style.getPropertyValue('display'),'block');
  assert.equal(f.seed.style.getPropertyPriority('display'),'');
});
