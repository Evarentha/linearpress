/*
 * Managed Plugin Configuration Jobs
 *
 * Applies plugin enablement and ordering through verified supervised restarts.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import type {PluginManager} from './plugin-manager.js';import {validatePluginId} from './plugin-validation.js';import {maintenance} from './maintenance.js';import {hasPendingInstall} from './plugin-install-jobs.js';import {requestRestart} from './restart.js';import {db,sqliteTransaction} from './database.js';
interface Row {id:string;enabled:number;load_order:number;}
export interface PluginChangeJob {id:string;phase:'installing'|'restarting'|'verifying'|'recovering'|'completed'|'failed';message:string;createdAt:string;updatedAt:string;restartRequested:boolean;errors?:string[];}
interface Journal extends PluginChangeJob {schema:1;before:Row[];after:Row[];expectedIds:string[];loadedBefore:string[];}
const root=path.resolve('data');const current=path.join(root,'plugin-change-job.json');const history=path.join(root,'plugin-change-jobs');const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;const terminal=(j:Journal)=>j.phase==='completed'||j.phase==='failed';let busy=false;
function atomic(file:string,value:unknown){fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.lstatSync(path.dirname(file)).isSymbolicLink())throw Error('Unsafe change journal directory');const temp=file+'.'+randomUUID()+'.tmp';let fd:number|undefined;try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.rmSync(temp,{force:true});}catch(error){console.error('[plugin-change] temporary cleanup deferred',error);}}}
function read():Journal|undefined{if(!fs.existsSync(current))return;if(fs.lstatSync(current).isSymbolicLink())throw Error('Unsafe change journal');const j=JSON.parse(fs.readFileSync(current,'utf8')) as Journal;if(j.schema!==1||!uuid.test(j.id)||!['installing','restarting','verifying','recovering','completed','failed'].includes(j.phase)||!Array.isArray(j.before)||!Array.isArray(j.after)||!Array.isArray(j.expectedIds)||!Array.isArray(j.loadedBefore))throw Error('Invalid plugin change journal');for(const row of [...j.before,...j.after]){validatePluginId(row.id);if(![0,1].includes(row.enabled)||!Number.isSafeInteger(row.load_order))throw Error('Invalid plugin change row');}for(const id of [...j.expectedIds,...j.loadedBefore])validatePluginId(id);return j;}
function archive(j:Journal){try{atomic(path.join(history,j.id+'.json'),j);if(terminal(j))fs.rmSync(current,{force:true});}catch(error){console.error('[plugin-change] terminal history deferred',error);}}
function save(j:Journal,phase:Journal['phase'],message:string){const next={...j,phase,message,updatedAt:new Date().toISOString()};atomic(current,next);Object.assign(j,next);if(terminal(j))archive(j);}
export function hasPendingPluginChange(){const j=read();return busy||!!j&&!terminal(j);}
export function getPluginChangeJob(id:string):PluginChangeJob|undefined{if(!uuid.test(id))return;let j=read();if(j?.id!==id){const file=path.join(history,id+'.json');if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())return;j=JSON.parse(fs.readFileSync(file,'utf8'));}if(!j)return;if(terminal(j)&&read()?.id===id)archive(j);const{id:jobId,phase,message,createdAt,updatedAt,restartRequested,errors}=j;return{id:jobId,phase,message,createdAt,updatedAt,restartRequested,errors};}
async function apply(rows:Row[]){await sqliteTransaction(db,()=>{const update=db.prepare('UPDATE plugins SET enabled=?,load_order=? WHERE id=?');for(const row of rows)update.run(row.enabled,row.load_order,row.id);});}
export async function beginPluginChange(manager:PluginManager,change:{id:string;enabled:boolean}|{ids:string[]}){
 if(process.env.LINEARPRESS_WORKER!=='1'||!process.connected)throw Object.assign(Error('请使用 npm start 受管启动后应用插件变更'),{status:409});
 if(busy||hasPendingInstall()||hasPendingPluginChange()||maintenance.isEnabled())throw Object.assign(Error('已有安装或维护任务，请稍后重试'),{status:409});const previous=read();if(previous){archive(previous);if(read())throw Object.assign(Error('前一任务终态尚待归档，请恢复任务目录写权限后重试'),{status:409});}busy=true;let j:Journal|undefined;let applied=false;
 try{const before=manager.database.prepare('SELECT id,enabled,load_order FROM plugins').all() as Row[];const after=before.map(row=>({...row}));
 if('id'in change){validatePluginId(change.id);const row=after.find(r=>r.id===change.id);if(!row)throw Error('插件不存在');row.enabled=change.enabled?1:0;}
 else{if(!Array.isArray(change.ids)||change.ids.length!==before.length||new Set(change.ids).size!==before.length||change.ids.some(id=>!before.some(r=>r.id===id)))throw Error('插件排序必须包含全部且不重复的插件ID');change.ids.forEach((id,index)=>{after.find(r=>r.id===id)!.load_order=(index+1)*10;});}
 const now=new Date().toISOString();const enabled=new Set(after.filter(r=>r.enabled).map(r=>r.id));const expected=new Set(manager.getLoadedIds().filter(id=>enabled.has(id)));for(const row of after)if(row.enabled&&!before.find(r=>r.id===row.id)?.enabled)expected.add(row.id);
 j={schema:1,id:randomUUID(),phase:'installing',message:'正在保存插件变更',before,after,expectedIds:[...expected],loadedBefore:manager.getLoadedIds(),createdAt:now,updatedAt:now,restartRequested:true};save(j,'installing','正在保存插件变更');maintenance.enter('plugin');await apply(after);applied=true;save(j,'restarting','正在自动重启并验证插件状态');setTimeout(requestRestart,500).unref();return{job:getPluginChangeJob(j.id)!,statusUrl:'/admin/plugins/change-jobs/'+j.id};
 }catch(error){if(j){if(applied)await apply(j.before);j.errors=[String(error)];save(j,'failed','插件变更未应用，原配置已恢复');maintenance.exit();}throw error;}finally{busy=false;}}
export async function recoverPendingPluginChange(reason:string):Promise<boolean>{const j=read();if(!j)return false;if(terminal(j)){archive(j);return false;}await apply(j.before);j.errors=[...(j.errors??[]),reason.slice(0,2000)];save(j,'recovering','启动失败，正在恢复原插件配置');return true;}
export async function verifyPendingPluginChange(manager:PluginManager):Promise<void>{const j=read();if(!j)return;if(terminal(j)){archive(j);maintenance.exit();return;}maintenance.enter('plugin');if(j.phase==='recovering'){const expected=j.loadedBefore.filter(id=>j.before.some(r=>r.id===id&&r.enabled));if(expected.some(id=>!manager.isLoaded(id)))throw Error('原插件配置恢复验证失败');save(j,'failed','插件变更失败，已恢复原配置和站点');maintenance.exit();return;}
 const expectedRows=j.after;const rows=manager.database.prepare('SELECT id,enabled,load_order FROM plugins').all() as Row[];const missing=j.expectedIds.filter(id=>!manager.isLoaded(id));const undesired=expectedRows.filter(r=>!r.enabled&&manager.isLoaded(r.id));const mismatch=expectedRows.some(r=>!rows.some(v=>v.id===r.id&&v.enabled===r.enabled&&v.load_order===r.load_order));if(missing.length||undesired.length||mismatch){await recoverPendingPluginChange('插件运行状态与目标配置不一致');throw Error('插件状态验证失败，准备恢复原配置');}save(j,'completed','插件变更已自动重启并验证生效');maintenance.exit();}
