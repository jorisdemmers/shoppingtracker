import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
test('preview has loadable resources and only sidePanel was added',()=>{
  const m=JSON.parse(readFileSync('local-preview/manifest.json'));
  assert.equal(m.minimum_chrome_version,'116');assert.equal(m.action.default_popup,undefined);
  assert.deepEqual(m.permissions,['webNavigation','storage','tabs','notifications','sidePanel']);
  for(const path of [m.background.service_worker,m.side_panel.default_path,'popup/popup.js','content.js'])assert.ok(existsSync('local-preview/'+path),path);
  assert.ok(!m.content_scripts.some(s=>s.matches.some(p=>p.includes('qualtrics'))));
  assert.ok(m.host_permissions.every(p=>p.includes('amazon.')));
  for(const p of ['background.js','content.js','popup/popup.js'])new vm.Script(readFileSync('local-preview/'+p,'utf8'));
  const bg=readFileSync('local-preview/background.js','utf8');assert.ok(!bg.includes('jitsuAnalytics'));assert.ok(!bg.includes('initializeApp'));
});
test('all TypeScript sources are syntactically transformable',()=>{
  const visit=path=>{for(const e of readdirSync(path,{withFileTypes:true})){const p=join(path,e.name);if(e.isDirectory())visit(p);else if(p.endsWith('.ts'))assert.doesNotThrow(()=>stripTypeScriptTypes(readFileSync(p,'utf8'),{mode:'transform'}),p);}};
  visit('src');
});
test('panel HTML supplies every referenced ID and guidance is chat-only',()=>{
  const ts=readFileSync('src/popup/Popup.ts','utf8'),html=readFileSync('src/popup/popup.html','utf8');
  for(const [,id]of ts.matchAll(/(?:el|show)\('([^']+)'/g))assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(ts.includes("show('guided', c.arm === 'chat')"));
  const content=readFileSync('src/content/Content.ts','utf8');
  assert.ok(!content.includes("input[type='text'], textarea"));assert.ok(!content.includes("taskStage !== 'initial'"));
});
