import {chromium} from 'playwright';import {expect} from 'playwright/test';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const b=await chromium.connectOverCDP('http://127.0.0.1:39119'),p=b.contexts()[0].pages().find(p=>p.url()==='dsh-app://app/');
const report={host:'DSH NEXT 2.0.20-next/Core rc3',startedAt:new Date().toISOString(),cases:[]};
const api=(route,body)=>p.evaluate(async({route,body})=>{const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{route,body});
const fixture=async body=>{const r=await api('/cleaner-e2e',body);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
let held;
try{
 await p.waitForFunction(async()=>{try{const r=await fetch('/cleaner-e2e',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"info"}'});return r.status===200&&(await r.json()).ok;}catch{return false;}},null,{timeout:30000});
 await p.keyboard.press('Escape');
 for(const [kind,mode]of [['A','chat_only'],['B','chat_and_outputs'],['C','full']]){
  const f=await fixture({action:'create',kind});held=f.id;await fixture({action:'hold',id:f.id});
  const w=p.locator('[data-row-key="workspace:'+f.workspaceId+'"]');if(await w.getAttribute('aria-expanded')==='false')await w.click();
  const row=p.locator('[data-row-key="session:'+f.id+'"]');await row.click();await row.hover();await row.getByRole('button',{name:/Session actions/}).click();await p.getByRole('menuitem',{name:'Delete conversation',exact:true}).click();
  const d=p.getByRole('dialog',{name:'Delete conversation',exact:true});if(kind!=='A')await d.getByRole('radio').nth(kind==='B'?1:2).check();await expect(d.locator('.dcc-danger')).toBeEnabled({timeout:20000});
  const before=(await fixture({action:'diagnose'})).rows.find(r=>r.id===f.id);assert.equal(before.live,true);assert.equal(before.status,'idle');
  await d.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await fixture({action:'diagnose'})).rows.find(r=>r.id===f.id).live,true);
  const preview=await api('/dsh-conversation-cleaner/v1/plan',{sessionId:f.id,mode});assert.equal(preview.status,200,JSON.stringify(preview));assert.deepEqual(preview.data.blockers,[]);
  await row.hover();await row.getByRole('button',{name:/Session actions/}).click();await p.getByRole('menuitem',{name:'Delete conversation',exact:true}).click();if(kind!=='A')await d.getByRole('radio').nth(kind==='B'?1:2).check();await expect(d.locator('.dcc-danger')).toBeEnabled({timeout:20000});
  const response=p.waitForResponse(r=>r.url().endsWith('/dsh-conversation-cleaner/v1/commit'));await d.locator('.dcc-danger').click();const http=await response,result=await http.json();assert.equal(http.status(),200,JSON.stringify(result));await expect(d.getByRole('status')).toContainText('Deleted');
  assert.equal((await fixture({action:'diagnose'})).rows.some(r=>r.id===f.id),false);await expect(row).toHaveCount(0);
  const after=await fixture({action:'state',id:f.id});assert.equal(after.session,false);assert.equal(after.survivor,true);assert.equal(after.shared.exists,true);assert.equal(after.output.exists,kind==='A');assert.equal(after.orphan.exists,kind!=='C');
  await p.screenshot({path:'evidence/screenshots/idle-current-'+kind.toLowerCase()+'.png',fullPage:true});await d.locator('.dcc-footer').getByRole('button',{name:'Close',exact:true}).click();
  // Leave the deleted route before restoring, otherwise the host may resume
  // that restored row and legitimately block the next independent deep case.
  await p.getByRole('button',{name:'New session',exact:true}).last().click();
  const restore=await api('/dsh-conversation-cleaner/v1/restore',{operationId:result.operationId,acknowledged:true});assert.equal(restore.status,200,JSON.stringify(restore));assert.equal((await fixture({action:'state',id:f.id})).session,true);
  await fixture({action:'release',id:f.id});held=undefined;report.cases.push({mode,id:f.id,status:'PASS',checks:['current-selected','preview-and-cancel-preserve-live-owner','automatic-idle-dispose','no-extra-confirmation','mode-scope','other-session-preserved','restore']});
 }
 report.status='PASS';console.log('Current idle session: three actual NEXT deletion scopes and restore PASS.');
}catch(e){report.status='FAIL';report.error=e.stack;throw e;}finally{if(held)await fixture({action:'release',id:held});report.finishedAt=new Date().toISOString();await fs.writeFile('evidence/idle-session-check.json',JSON.stringify(report,null,2));await b.close();}
