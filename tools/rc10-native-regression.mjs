// Real isolated-host regression; never starts or installs DSH. Web uses real Edge.
// node tools/rc10-native-regression.mjs [--web] [--ownership]
import {chromium} from 'playwright';
import {expect as baseExpect} from 'playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const expect=baseExpect.configure({timeout:15000}),web=process.argv.includes('--web'),tag=web?'web':'next';
const report={host:web?'DSH Web in Microsoft Edge':'DSH NEXT',version:JSON.parse(await fs.readFile('package.json','utf8')).version,startedAt:new Date().toISOString(),checks:[],screenshots:[]};
const browser=web?await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}):await chromium.connectOverCDP('http://127.0.0.1:39119');
const context=web?await browser.newContext({locale:'en-US',viewport:{width:1280,height:960}}):browser.contexts()[0];
const page=web?await context.newPage():context.pages().find(p=>p.url()==='dsh-app://app/');assert.ok(page,'Expected isolated native app page');
const prefix='/dsh-conversation-cleaner/v1/';
const request=(route,body)=>page.evaluate(async({route,body})=>{const response=await fetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});return {status:response.status,data:await response.json()};},{route,body});
const api=async(action,body={})=>{const result=await request(prefix+action,body);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.ok,true,JSON.stringify(result));return result.data;};
const fixture=async(body)=>{const result=await request('/cleaner-e2e',body);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.ok,true,JSON.stringify(result));return result.data;};
const check=(name,details={})=>{report.checks.push({name,status:'PASS',...details});console.log(tag+' PASS '+name);};
const summary=(f,op)=>fixture({action:'journal-summary',id:f.id,operationId:op});
const registry=f=>fixture({action:'registry-state',id:f.id});
const assertCompact=record=>{for(const present of Object.values(record.payload))assert.equal(present,false);assert.equal(record.containsSyntheticMarker,false);assert.equal(record.stagedPresent,0);};
const screenshot=async name=>{const file='evidence/screenshots/rc10-'+tag+'-'+name+'.png';await page.screenshot({path:file,fullPage:true});report.screenshots.push(file);};
const plan=async(f,mode)=>{const p=await api('plan',{sessionId:f.id,mode});assert.deepEqual(p.blockers,[]);return p;};
const commit=async p=>api('commit',{planId:p.planId,confirmation:p.confirmation,acknowledged:true});
const remove=async(f,mode='chat_only')=>{const result=await commit(await plan(f,mode));await summary(f,result.operationId);return result.operationId;};
const labels={history:/^(Deletion history and recovery|删除记录与恢复)$/,restore:/^(Restore|恢复)$/,ungrouped:/^(Restore as ungrouped conversation|恢复为未分组对话)$/,compact:/^(Clean old remnants|清理旧残留)$/,close:/^(Close|关闭)$/};
let foreign;
async function openHistory(operationId){
 await page.keyboard.press('Escape');const existing=page.locator('.dcc-modal');if(await existing.count())await existing.locator('.dcc-footer').getByRole('button',{name:labels.close}).click();
 // Recovery remains reachable even without any surviving session row.
 await page.getByRole('button',{name:/^(Plugins|插件)$/}).click();
 const entry=page.getByRole('button',{name:labels.history});
 if(!await entry.count())await page.getByRole('button',{name:/^View dsh-conversation-cleaner$|^查看 dsh-conversation-cleaner$/}).click();
 await entry.click();
 const dialog=page.getByRole('dialog',{name:labels.history});await dialog.getByRole('combobox').selectOption(operationId);return dialog;
}
try {
 if(web){const log=await fs.readFile('evidence/logs/web-v2.log','utf8'),url=log.match(/dsh web: (http[^\s]+)/)?.[1];assert.ok(url&&new URL(url).port==='39117','Expected isolated Web host on 39117');await page.goto(url);const welcome=page.getByRole('dialog',{name:'Get started',exact:true});try{await welcome.waitFor({timeout:2000});await welcome.getByRole('button',{name:'Close',exact:true}).click();}catch(e){if(e.name!=='TimeoutError')throw e;}}
 await expect(page.getByRole('button',{name:/^(Plugins|插件)$/})).toBeVisible();
 const info=await fixture({action:'info'}),testBase=path.resolve('.test-data'),relative=path.relative(testBase,path.resolve(info.root));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Host must use this project .test-data');report.dataRoot=info.root;console.log(tag+' connected to isolated host');
 await fs.mkdir('evidence/screenshots',{recursive:true});const initial=await api('operations');assert.deepEqual(initial.pending,[],'Resolve prior isolated pending operations before this run');
 foreign=await fixture({action:'create',kind:'E'});const selected=await fixture({action:'create',kind:'E'});assert.notEqual(selected.cwd,foreign.cwd);await fixture({action:'mark-pin',id:selected.id});
 let restoredOperation;
 for(const mode of ['chat_only','chat_and_outputs','full']){
  if(mode!=='chat_only')await fixture({action:'mark-archive',id:selected.id});
  console.log(tag+' checking '+mode+' with unrelated native revision changes');const before=await registry(selected);assert.deepEqual(before.memberships,[selected.workspaceId]);assert.equal(before.pinned,mode==='chat_only');assert.equal(before.archived,mode!=='chat_only');
  const p=await plan(selected,mode);assert.equal(p.counts.outputs,0);if(mode==='full')assert.equal(p.attachmentCount,0);
  await fixture({action:'hold',id:foreign.id});try{await fixture({action:'rename-held',id:foreign.id});}finally{await fixture({action:'release',id:foreign.id});}
  const result=await commit(p),after=await registry(selected);assert.deepEqual(after.memberships,[]);assert.equal(after.pinned,false);assert.equal(after.archived,false);const removed=await fixture({action:'state',id:selected.id});assert.equal(removed.session,false);assert.equal(removed.survivor,true);assert.equal((await fixture({action:'state',id:foreign.id})).session,true);assert.deepEqual((await registry(foreign)).memberships,[foreign.workspaceId]);
  const quarantined=await summary(selected,result.operationId);assert.equal(quarantined.state,'VERIFIED');assert.equal(quarantined.payload.metadata,true);
  await api('restore',{operationId:result.operationId,acknowledged:true});assert.equal((await fixture({action:'state',id:selected.id})).session,true);assert.deepEqual(await registry(selected),before);const terminal=await summary(selected,result.operationId);assert.equal(terminal.state,'RESTORED');assertCompact(terminal);restoredOperation=result.operationId;
  check(mode+' ignores unrelated revision; pins/archive/workspace restore; terminal has no payload',{operationId:result.operationId});
 }
 // A single session belongs to its cwd workspace; the two fixtures use distinct cwds.
 check('different cwd workspaces coexist and foreign membership remains',{selected:selected.id,foreign:foreign.id});
 const missing=await fixture({action:'create',kind:'E'});await fixture({action:'mark-pin',id:missing.id});await fixture({action:'mark-archive',id:missing.id});const missingOperation=await remove(missing);await fixture({action:'drop-workspace',id:missing.id});
 const refused=await request(prefix+'restore',{operationId:missingOperation,acknowledged:true});assert.equal(refused.data.code,'RESTORE_WORKSPACE_MISSING');const failed=await summary(missing,missingOperation);assert.equal(failed.state,'RESTORE_FAILED');assert.ok(failed.stagedPresent>0);assert.equal((await fixture({action:'state',id:missing.id})).session,false);check('missing workspace restore fails before moving staged files',{operationId:missingOperation});
 let dialog=await openHistory(missingOperation);await dialog.getByRole('button',{name:labels.restore}).click();await expect(dialog.getByRole('button',{name:labels.ungrouped})).toBeVisible();await screenshot('missing-workspace');await dialog.getByRole('button',{name:labels.ungrouped}).click();await expect(dialog.getByRole('status')).toHaveText(/^(Restored|已恢复)$/);await screenshot('ungrouped-restored');await dialog.locator('.dcc-footer').getByRole('button',{name:labels.close}).click();
 assert.equal((await fixture({action:'state',id:missing.id})).session,true);const ungrouped=await registry(missing);assert.deepEqual(ungrouped.memberships,[]);assert.equal(ungrouped.pinned,false);assert.equal(ungrouped.archived,true);assertCompact(await summary(missing,missingOperation));check('actual recovery UI explicitly restores missing-workspace session ungrouped');
 const purged=await fixture({action:'create',kind:'C'});const purgeOperation=await remove(purged,'full');const simulated=await fixture({action:'simulate-purge',id:purged.id,operationId:purgeOperation});assert.equal(simulated.state,'PURGING');assert.equal(simulated.removed,1);assert.ok(simulated.stagedPresent>0);assert.ok((await api('operations')).pending.includes(purgeOperation));
 await api('purge',{operationId:purgeOperation,acknowledged:true});const purgedSummary=await summary(purged,purgeOperation);assert.equal(purgedSummary.state,'PERMANENT');assertCompact(purgedSummary);assert.ok(!(await api('operations')).pending.includes(purgeOperation));assert.equal((await fixture({action:'state',id:purged.id})).shared.exists,true);check('interrupted multi-file purge resumes; no staged payload; pending released',{operationId:purgeOperation});
 const probe=await fixture({action:'create',kind:'E'}),probeOperation=await remove(probe);await api('restore',{operationId:probeOperation,acknowledged:true});check('another native conversation can delete and restore after resumed purge');
 for(const [f,operationId]of [[selected,restoredOperation],[purged,purgeOperation]]){
  const old=await fixture({action:'legacy-terminal',id:f.id,operationId});assert.equal(old.payload.metadata,true);assert.equal(old.containsSyntheticMarker,true);const operations=await api('operations');assert.equal(operations.operations.find(op=>op.operationId===operationId).canCompact,true);
  dialog=await openHistory(operationId);await expect(dialog.getByRole('button',{name:labels.compact})).toBeVisible();await screenshot('legacy-'+old.state.toLowerCase());await dialog.getByRole('button',{name:labels.compact}).click();await expect(dialog.getByRole('button',{name:labels.compact})).toHaveCount(0);await dialog.locator('.dcc-footer').getByRole('button',{name:labels.close}).click();assertCompact(await summary(f,operationId));check('actual history UI compacts own legacy '+old.state+' payload',{operationId});
 }
 if(process.argv.includes('--ownership')){
  const replaced=await fixture({action:'create',kind:'A'});const edited=await fixture({action:'replace-and-edit',id:replaced.id});assert.equal(edited.outputText,'Edited independent user replacement.');const b=await plan(replaced,'chat_and_outputs');assert.equal(b.counts.outputs,0);const operation=await commit(b);await summary(replaced,operation.operationId);assert.equal((await fixture({action:'state',id:replaced.id})).output.exists,true);await api('restore',{operationId:operation.operationId,acknowledged:true});check('actual native read/edit preserves independently replaced user output',{operationId:operation.operationId});
 }else report.ownership='Not requested; automatic unit regression is separate';
 await screenshot('final');report.status='PASS';console.log(tag+' all native rc10 checks passed');
}catch(error){report.status='FAIL';report.error=error.stack;await screenshot('failure').catch(()=>{});console.error(tag+' FAIL '+error.message);throw error;}
finally{report.finishedAt=new Date().toISOString();try{await fs.writeFile('evidence/rc10-'+tag+'-native.json',JSON.stringify(report,null,2));}finally{await browser.close();}}
