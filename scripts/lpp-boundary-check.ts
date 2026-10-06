/*
 * LPP Boundary Regression
 *
 * Verifies version ordering and TypeScript dependency validation in isolated packages.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {packPluginDirectory,satisfiesVersion,validateLpp} from '../src/services/lpp-package.js';
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'linearpress-package-check-'));
try{
 assert.throws(()=>satisfiesVersion('3.0.0+a..b','*'));
 assert.equal(satisfiesVersion('1.0.0-9007199254740993','>1.0.0-9007199254740992'),true);
 const source=path.join(fixture,'plugin');fs.mkdirSync(source);const write=(name:string,content:string)=>{const file=path.join(source,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);};
 write('plugin.json',JSON.stringify({id:'regression-fixture',name:'Regression fixture',version:'1.0.0',type:'both',main:'index.ts'}));
 for(const entry of ["import {type Unknown} from 'types-not-at-runtime'; export default function(){}", "export {type Unknown} from 'types-not-at-runtime'; export default function(){}"]){write('index.ts',entry);await validateLpp(await packPluginDirectory(source));}
 write('index.ts',"import Missing = require('missing-runtime-package'); export default function(){return Missing}");await assert.rejects(()=>packPluginDirectory(source),/non-host/);
 for(const [runtime,typed]of[['mjs','mts'],['cjs','cts']]){write('index.ts',`import {ok} from './module.${runtime}'; export default function(){return ok}`);write(`module.${typed}`,'export const ok=true;');await packPluginDirectory(source);}
 write('index.ts','export default function(){}');write('plugin.json',JSON.stringify({id:'regression-fixture',name:'Regression fixture',version:'1.0.0',type:'both',main:'index.ts',public:'public',styles:['dist/missing.css']}));write('public/dist/missing.css','body{color:red}');await assert.rejects(()=>packPluginDirectory(source),/Declared (asset|resource)/);
 console.log('LPP boundary regressions passed; no application/database started.');
}finally{fs.rmSync(fixture,{recursive:true,force:true});}
