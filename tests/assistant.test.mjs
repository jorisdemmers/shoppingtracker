import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {bundle} from '../scripts/preview-bundle.mjs';
function fixture(width=330) {
  const style=()=>{const v=new Map();return {getPropertyValue:k=>v.get(k)?.[0]||'',getPropertyPriority:k=>v.get(k)?.[1]||'',setProperty(k,x,p){v.set(k,[x,p]);},removeProperty(k){v.delete(k);}};};
  const node=(rect={left:0,right:330,width:330,height:850})=>({style:style(),dataset:{},parentElement:null,isConnected:true,matches:()=>false,getBoundingClientRect:()=>rect,querySelector:()=>null,getAttribute:()=>'',textContent:''});
  const html=node(),body=node(),shell=node({left:0,right:width,width,height:850}),seed=node(),button=node();
  shell.parentElement=body;seed.parentElement=shell;
  let closes=0;shell.querySelector=()=>({click(){closes++;}});
  button.textContent='Alexa for shopping';
  const doc={body,documentElement:html,createElement(){return {...node(),remove(){this.isConnected=false;}};},querySelectorAll(q){return q==='button,[role="button"],#nav-main a,#nav-belt a'?[button]:[seed,button];}};
  html.append=()=>{};
  const {AssistantControl}=vm.runInNewContext(bundle(resolve('src/content/AssistantControl.ts')),{document:doc,window:{innerWidth:1400,innerHeight:900},MutationObserver:class{observe(){}disconnect(){}},getComputedStyle:()=>({})});
  return {control:new AssistantControl(),shell,seed,button,closes:()=>closes};
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
