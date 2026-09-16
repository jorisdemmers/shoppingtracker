import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from './preview-bundle.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preview = process.argv.includes('--preview');
const out = resolve(root, preview ? 'local-preview' : 'production-build');
const manifest = JSON.parse(readFileSync(resolve(root,'src/chrome/baseManifest.json'),'utf8'));
const entries = { 'background.js':'src/worker/index.ts', 'content.js':'src/content/index.ts', 'popup/popup.js':'src/popup/Popup.ts' };
mkdirSync(resolve(out,'popup'),{recursive:true}); mkdirSync(resolve(out,'images'),{recursive:true});
if (preview) {
  manifest.name = 'Webmunk Shopping Study — LOCAL PREVIEW';
  manifest.version_name = manifest.version + ' LOCAL PREVIEW — NOT FOR PARTICIPANTS';
  manifest.host_permissions = manifest.host_permissions.filter(p => p.includes('amazon.'));
  for (const [target,source] of Object.entries(entries)) writeFileSync(resolve(out,target),bundle(resolve(root,source)));
} else {
  if (existsSync(resolve(root,'.env'))) process.loadEnvFile(resolve(root,'.env'));
  const required = ['FIREBASE_API_KEY','FIREBASE_PROJECT_ID','FIREBASE_MESSAGING_SENDER_ID','FIREBASE_APP_ID','JITSU_WRITE_KEY','JITSU_INGEST_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error('Production build needs the existing study settings: '+missing.join(', '));
  const allowed = [...required,'STUDY_ID','WEBMUNK_URL','UNINSTALL_URL','REMOTE_CONFIG_FETCH_INTERVAL','USER_FETCH_INTERVAL','DEBUG_LOGGING','FINAL_SURVEY_URL'];
  const env = Object.fromEntries(allowed.filter(k => process.env[k] != null).map(k => [k,process.env[k]]));
  env.REMOTE_CONFIG_FETCH_INTERVAL ||= '3600000'; env.USER_FETCH_INTERVAL ||= '3600000';
  const ingest = new URL(env.JITSU_INGEST_URL);
  if (ingest.protocol !== 'https:') throw new Error('Jitsu ingestion must use HTTPS.');
  const hostAllowed = manifest.host_permissions.some(p => {
    const host = p.slice('https://'.length).split('/')[0];
    return host.startsWith('*.') ? ingest.hostname === host.slice(2) || ingest.hostname.endsWith(host.slice(1)) : ingest.hostname === host;
  });
  if (!hostAllowed) throw new Error('Jitsu host is not in the manifest. Add its exact HTTPS host after reviewing permissions.');
  if (env.FIREBASE_PROJECT_ID !== 'uva-webmunk') throw new Error('A different Firebase project also needs its exact Cloud Functions host in the manifest.');
  const { build } = await import('esbuild');
  for (const [target,source] of Object.entries(entries)) await build({entryPoints:[resolve(root,source)],
    outfile:resolve(out,target), bundle:true, platform:'browser', format:'iife', target:'chrome116',
    define:{'process.env':JSON.stringify(env)}, sourcemap:false, minify:false });
  if (process.env.EXTENSION_PUBLIC_KEY) manifest.key = process.env.EXTENSION_PUBLIC_KEY;
}
copyFileSync(resolve(root,'src/popup/popup.html'),resolve(out,'popup/popup.html'));
if (preview) copyFileSync(resolve(root,'src/popup/popup.html'),resolve(out,'popup/preview-tools.html'));
copyFileSync(resolve(root,'src/popup/popup.css'),resolve(out,'popup/popup.css'));
copyFileSync(resolve(root,'images/UvA.png'),resolve(out,'images/UvA.png'));
writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(preview ? 'Built local-preview/. No Firebase/Jitsu calls. Confirmed choices open the configured Qualtrics P2 with webmunk_test=1.' : 'Built production-build/. Test end-to-end before uploading.');
