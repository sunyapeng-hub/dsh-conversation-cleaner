import {chromium} from 'playwright';
import {expect as baseExpect} from 'playwright/test';
const expect=baseExpect.configure({timeout:120000});
import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const web=process.argv.includes('--web'),tag=web?'web-v2':'next';
const b=web?await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}):await chromium.connectOverCDP('http://127.0.0.1:39119');
const context=web?await b.newContext({viewport:{width:1280,height:960},locale:'en-US'}):b.contexts()[0],p=web?await context.newPage():context.pages().find(p=>p.url()==='dsh-app://app/');
if(web){const log=await fs.readFile('evidence/logs/web-v2.log','utf8');await p.goto(log.match(/dsh web: (http[^\s]+)/)[1]);await expect(p.getByRole('button',{name:'Plugins',exact:true})).toBeVisible();const onboarding=p.getByRole('dialog',{name:'Get started',exact:true});try{await onboarding.waitFor({timeout:3000});await onboarding.getByRole('button',{name:'Close',exact:true}).click();}catch(e){if(e.name!=='TimeoutError')throw e;}}
const prior=process.argv.includes('--resume')?JSON.parse(await fs.readFile('evidence/'+tag+'-acceptance.json','utf8')):null;
const report={host:web?'DSH Web':'DSH NEXT',shell:web?null:'2.0.20-next',dsh:'0.2.1-rc.3',dataRoot:web?'.test-data/web-v2':'.test-data/next-normal',startedAt:prior?.startedAt??new Date().toISOString(),cases:prior?.cases.filter(c=>c.status==='PASS')??[]};
const api=async(route,body)=>p.evaluate(async({route,body})=>{const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok||!data.ok)throw new Error(JSON.stringify(data));return data;},{route,body});
const fixture=body=>api('/cleaner-e2e',body);
await fs.mkdir('evidence/screenshots',{recursive:true});await fs.mkdir('evidence/traces',{recursive:true});
await context.tracing.start({screenshots:true,snapshots:true,sources:false});
try{
 await p.keyboard.press('Escape');
 const existing=p.locator('.dcc-modal');if(await existing.count()){const close=existing.locator('.dcc-footer button').first();await expect(close).toBeEnabled();await close.click();}
 for(const [kind,mode] of [['A','chat_only'],['B','chat_and_outputs'],['C','full']]) {
  if(report.cases.some(c=>c.kind===kind&&c.status==='PASS'))continue;
  const reuse=prior?.cases.find(c=>c.kind===kind)?.id??(kind==='A'&&process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:null);
  const f=reuse?((await fixture({action:'state',id:reuse})).fixture):await fixture({action:'create',kind});
  const row={kind,mode,id:f.id,survivor:f.survivor,checks:[]};report.cases.push(row);
  const before=await fixture({action:'state',id:f.id});row.before=before;assert.equal(before.session,true);
  const workspace=p.locator('[data-row-key="workspace:'+f.workspaceId+'"]');if(await workspace.getAttribute('aria-expanded')==='false')await workspace.click();
  const session=p.locator('[data-row-key="session:'+f.id+'"]');await expect(session).toBeVisible();
  const open=async()=>{await session.hover();await session.getByRole('button',{name:'Session actions for Cleaner '+kind+' populated fixture',exact:true}).click();await p.getByRole('menuitem',{name:'Delete conversation',exact:true}).click();};
  await open();let dialog=p.getByRole('dialog',{name:'Delete conversation',exact:true});
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Delete',exact:true})).toBeEnabled({timeout:20000});
  assert.equal((await fixture({action:'state',id:f.id})).session,true);row.checks.push('preview-read-only','delete-click-is-the-confirmation');
  if(kind==='A'){
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await fixture({action:'state',id:f.id})).session,true);row.checks.push('cancel-preserves-session');await open();dialog=p.getByRole('dialog',{name:'Delete conversation',exact:true});await expect(dialog.getByRole('status')).toHaveCount(0);
  }
  if(kind!=='A')await dialog.getByRole('radio').nth(kind==='B'?1:2).check();
  await expect(dialog.getByRole('status')).toHaveCount(0);await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.locator('details')).toBeVisible();await dialog.locator('summary').click();
  await p.screenshot({path:'evidence/screenshots/'+tag+'-'+kind.toLowerCase()+'-preview.png',fullPage:true});
  assert.equal(await dialog.getByRole('checkbox',{name:'I understand: deletion may be irreversible',exact:true}).count(),0);
  const response=p.waitForResponse(r=>r.url().endsWith('/dsh-conversation-cleaner/v1/commit')&&r.request().method()==='POST',{timeout:120000});
  await dialog.getByRole('button',{name:'Delete',exact:true}).click();const http=await response;row.result=await http.json();assert.equal(http.status(),200,JSON.stringify(row.result));
  await expect(dialog.getByRole('status')).toContainText('Deleted');await expect(session).toHaveCount(0);row.checks.push('live-sidebar-removal');
  row.after=await fixture({action:'state',id:f.id});
  assert.equal(row.after.session,false);assert.equal(row.after.member,false);assert.equal(row.after.survivor,true);assert.equal(row.after.keep,before.keep);assert.equal(row.after.shared.exists,true);
  assert.equal(row.after.output.exists,kind==='A');assert.equal(row.after.orphan.exists,kind!=='C');
  row.checks.push('session-removed','membership-removed','survivor-retained','existing-file-retained','shared-attachment-retained','mode-scope-correct');
  await p.screenshot({path:'evidence/screenshots/'+tag+'-'+kind.toLowerCase()+'-verified.png',fullPage:true});await dialog.locator('.dcc-footer').getByRole('button',{name:'Close',exact:true}).click();
  row.status='PASS';console.log(kind+' actual '+report.host+' UI deletion PASS: '+row.result.operationId);
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;console.error((await p.locator('body').innerText()).slice(-1800));await p.screenshot({path:'evidence/screenshots/'+tag+'-failure.png',fullPage:true});throw error;}
finally{report.finishedAt=new Date().toISOString();await fs.writeFile('evidence/'+tag+'-acceptance.json',JSON.stringify(report,null,2));await context.tracing.stop({path:'evidence/traces/'+tag+'-acceptance.zip'});await b.close();}

