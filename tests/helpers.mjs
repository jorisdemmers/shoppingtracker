import vm from 'node:vm';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { bundle } from '../scripts/preview-bundle.mjs';
export function hook() { const listeners=[]; return {listeners,addListener(fn){listeners.push(fn);},removeListener(fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);}}; }
export function mockChrome(seed = {}) {
  const local=structuredClone(seed), session={}, calls=[], changes=hook();
  function area(data,name) {
    return {
      async get(keys,cb) {
        const value=structuredClone(keys==null ? data : Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]])));
        if(cb)cb(value); return value;
      },
      async set(values,cb) {
        const changed={};
        for(const [k,v]of Object.entries(values)){changed[k]={oldValue:data[k],newValue:structuredClone(v)};data[k]=structuredClone(v);}
        for(const fn of changes.listeners) fn(changed,name);
        if(cb)cb();
      },
      async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];},
      async clear(){for(const k of Object.keys(data))delete data[k];},
    };
  }
  const tab={id:7,url:'https://www.amazon.com/gp/cart/view.html',active:true,windowId:1};
  const chrome={
    storage:{local:area(local,'local'),session:area(session,'session'),onChanged:changes},
    runtime:{onMessage:hook(),onMessageExternal:hook(),onInstalled:hook(),getURL:p=>'chrome-extension://test/'+p,
      getManifest:()=>({name:'Webmunk LOCAL PREVIEW',version:'2.0.0'}),id:'test'},
    sidePanel:{async setPanelBehavior(p){calls.push(['behavior',p]);},async open(p){calls.push(['panel',p]);}},
    tabs:{onUpdated:hook(),onActivated:hook(),onRemoved:hook(),
      async get(){return {...tab};},async query(){return [{...tab}];},async update(id,p){calls.push(['update',id,p]);Object.assign(tab,p);return tab;},
      async create(p){calls.push(['create',p]);return {id:8,...p};},
      async sendMessage(){return {ok:true,loggedIn:true,items:[{asin:'B000000001',title:'Chosen headphones',price:'$120.00'}]};}},
    windows:{WINDOW_ID_NONE:-1,onFocusChanged:hook(),async get(){return {focused:true};}},
    webNavigation:{onCommitted:hook()},
  };
  return {chrome,local,session,calls,tab};
}
export function load(relative,chrome,globals={}) {
  return vm.runInNewContext(bundle(resolve(relative)), {chrome,URL,URLSearchParams,crypto:webcrypto,console,setTimeout,clearTimeout,structuredClone,Error,...globals});
}
export function send(chrome,message,sender={url:'chrome-extension://test/popup/popup.html'}) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('message timed out: '+message.type)),2000);
    const reply=value=>{clearTimeout(timer);resolve(value);};
    const handled=chrome.runtime.onMessage.listeners.some(fn=>fn(message,sender,reply)===true);
    if(!handled){clearTimeout(timer);resolve(undefined);}
  });
}
