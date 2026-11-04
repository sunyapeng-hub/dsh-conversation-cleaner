// Real isolated hosts only; every mutation is bound to a newly created fixture.
import {chromium} from 'playwright';
import {expect as baseExpect} from 'playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const expect=baseExpect.configure({timeout:15000}),web=process.argv.includes('--web'),tag=web?'web':'next';
const report={version:JSON.parse(await fs.readFile('package.json','utf8')).version,host:tag,startedAt:new Date().toISOString(),checks:[],screenshots:[]};
const browser=web?await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}):await chromium.connectOverCDP('http://127.0.0.1:39119');
const context=web?await browser.newContext({locale:'en-US',viewport:{width:1280,height:800}}):browser.contexts()[0];
const page=web?await context.newPage():context.pages().find(p=>p.url()==='dsh-app://app/');assert.ok(page);
const post=(route,body)=>page.evaluate(async({route,body})=>{const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});return {status:r.status,data:await r.json()};},{route,body});
const call=async(route,body)=>{const r=await post(route,body);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.ok,true,JSON.stringify(r));return r.data;};
const fixture=body=>call('/cleaner-e2e',body),api=(action,body={})=>call('/dsh-conversation-cleaner/v1/'+action,body);
const live=async id=>(await fixture({action:'diagnose'})).rows.find(row=>row.id===id)?.live??false;
const check=(name,details={})=>{report.checks.push({name,status:'PASS',...details});console.log(tag+' PASS '+name);};
const labels={menu:/^(Delete conversation|删除对话)$/,close:/^(Close|关闭)$/,restore:/^(Restore|恢复)$/};
let root;
const safe=file=>{const rel=path.relative(path.resolve(root),path.resolve(file));assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));return file;};
try{
 if(web){const log=await fs.readFile('evidence/logs/web-v2.log','utf8'),url=log.match(/dsh web: (http[^\s]+)/)?.[1];assert.equal(new URL(url).port,'39117');await page.goto(url);const welcome=page.getByRole('dialog',{name:'Get started',exact:true});try{await welcome.waitFor({timeout:2000});await welcome.getByRole('button',{name:'Close',exact:true}).click();}catch(e){if(e.name!=='TimeoutError')throw e;}}
 await expect(page.getByRole('button',{name:/^(Plugins|插件)$/})).toBeVisible();const info=await fixture({action:'info'});root=info.root;const relative=path.relative(path.resolve('.test-data'),path.resolve(root));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));report.dataRoot=root;assert.deepEqual((await api('operations')).pending,[]);
 const existing=page.locator('.dcc-modal');if(await existing.count())await existing.locator('.dcc-footer button').first().click();
 const own=JSON.parse(await fs.readFile('evidence/fixtures/'+path.basename(root)+'-v2.json','utf8'));for(const row of (await fixture({action:'diagnose'})).rows)if(row.live&&own[row.id])await fixture({action:'release',id:row.id});
 for(const [mode,permanent]of [['chat_and_outputs',false],['full',true]]){
  const f=await fixture({action:'create',kind:'C'}),foreign=await fixture({action:'create',kind:'E'});
  const files=[f.keep,f.output,f.orphanPath,f.sharedPath],before=await Promise.all(files.map(file=>fs.readFile(safe(file))));
  await fixture({action:'unknown-proof',id:f.id});
  try{
   const held=permanent?f:foreign;await fixture({action:permanent?'hold-startup':'hold',id:held.id});
   const plan=await api('plan',{sessionId:f.id,mode});assert.deepEqual(plan.blockers,[]);assert.equal(plan.resourcePolicy,'preserve_unverified');assert.ok(plan.warnings.includes('UNVERIFIED_RESOURCES_PRESERVED'));assert.ok(plan.candidates.every(c=>c.kind==='session'));assert.equal(plan.counts.outputs,0);
   const workspace=page.locator('[data-row-key="workspace:'+f.workspaceId+'"]');if(await workspace.getAttribute('aria-expanded')==='false')await workspace.click();
   const row=page.locator('[data-row-key="session:'+f.id+'"]');await expect(row).toBeVisible();await row.hover();await row.getByRole('button',{name:/Session actions|会话.*操作/}).click();await page.getByRole('menuitem',{name:labels.menu}).click();
   const dialog=page.getByRole('dialog',{name:labels.menu});await dialog.getByRole('radio').nth(permanent?2:1).check();await expect(dialog.getByRole('note')).toContainText(/Only this conversation will be deleted|本次仅删除对话/);await expect(dialog.locator('.dcc-danger')).toBeEnabled();
   assert.equal(await live(held.id),true,'Read-only preview does not close any owner');
   if(permanent)await dialog.getByRole('checkbox').last().check();
   const image='evidence/screenshots/rc11-'+tag+'-'+(permanent?'full-permanent':'outputs-recoverable')+'.png';await page.screenshot({path:image,fullPage:true});report.screenshots.push(image);
   await dialog.locator('.dcc-danger').click();await expect(dialog.getByRole('status')).toHaveText(/^(Deleted|已删除)$/);
   const state=await fixture({action:'state',id:f.id});assert.equal(state.session,false);assert.equal(state.survivor,true);assert.equal((await fixture({action:'state',id:foreign.id})).session,true);
   for(const [i,file]of files.entries())assert.ok((await fs.readFile(safe(file))).equals(before[i]),'Retained bytes: '+file);
   if(!permanent){assert.equal(await live(foreign.id),true);await dialog.getByRole('button',{name:labels.restore}).click();await expect(dialog.getByRole('status')).toHaveText(/^(Restored|已恢复)$/);assert.equal((await fixture({action:'state',id:f.id})).session,true);}
   else{await expect(dialog.getByRole('button',{name:labels.restore})).toHaveCount(0);assert.equal(await live(f.id),false);}
   await dialog.locator('.dcc-footer').getByRole('button',{name:labels.close}).click();check(mode+' actual UI '+(permanent?'permanent delete':'delete and restore')+' succeeds with incomplete historical proof; all file/attachment bytes retained',{sessionId:f.id,foreign:foreign.id});
   await fixture({action:'release',id:held.id});
  }finally{await fixture({action:'release',id:f.id});await fixture({action:'release',id:foreign.id});await fixture({action:'repair-proof',id:f.id});}
 }
 assert.deepEqual((await api('operations')).pending,[]);check('No interrupted transactions remain');report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;throw error;}
finally{report.finishedAt=new Date().toISOString();await fs.writeFile('evidence/rc11-'+tag+'-historical.json',JSON.stringify(report,null,2));await browser.close();}
