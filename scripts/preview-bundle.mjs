// Dependency-free LOCAL PREVIEW bundler for this project's relative-only modules.
// Node 24 transforms TS; production uses esbuild, not this deliberately limited packer.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

export function bundle(entry, {preview = true} = {}) {
  const sources = new Map();
  function visit(file) {
    file = resolve(file);
    if (preview && file.replace(/\\/g, '/').endsWith('/worker/Backend.ts')) file = file.replace(/Backend\.ts$/, 'PreviewBackend.ts');
    if (sources.has(file)) return sources.get(file).id;
    const record = {id:sources.size,code:''}; sources.set(file,record);
    let code = readFileSync(file,'utf8');
    if (file.endsWith('.ts')) code = stripTypeScriptTypes(code, {mode:'transform'});
    const dep = name => {
      if (!name.startsWith('.')) throw new Error('Preview cannot bundle external dependency: ' + name);
      const base = resolve(dirname(file),name);
      const target = [base,base+'.ts',base+'.js'].find(existsSync);
      if (!target) throw new Error('Missing module ' + base);
      return visit(target);
    };
    code = code.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/gm,
      (_, names, name) => 'const {' + names.replace(/\s+as\s+/g,':') + '} = __require(' + dep(name) + ');');
    code = code.replace(/^import\s*['"]([^'"]+)['"];?/gm, (_,name) => '__require('+dep(name)+');');
    const names = [...code.matchAll(/^export\s+(?:async\s+)?(?:class|function|const|let|var)\s+(\w+)/gm)].map(m => m[1]);
    code = code.replace(/^export\s+(?=(?:async\s+)?(?:class|function|const|let|var)\b)/gm,'');
    if (/^(?:import|export)\s/m.test(code)) throw new Error('Unsupported preview module syntax in '+relative(process.cwd(),file));
    record.code = code + '\nObject.assign(exports, {'+names.join(',')+'});';
    return record.id;
  }
  const id = visit(entry);
  return '(function(){"use strict";const __modules={\n' + [...sources.values()].map(r =>
    r.id+':function(module,exports,__require){\n'+r.code+'\n}').join(',\n') +
    '\n};const __cache={};function __require(id){if(__cache[id])return __cache[id].exports;const m={exports:{}};__cache[id]=m;__modules[id](m,m.exports,__require);return m.exports;}return __require('+id+');})();\n';
}
