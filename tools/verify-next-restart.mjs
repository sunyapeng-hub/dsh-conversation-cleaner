import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const web=process.argv.includes('--web'),tag=web?'web-v2':'next';
const b=web?await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}):await chromium.connectOverCDP('http://127.0.0.1:39119');
const p=web?await(await b.newContext({locale:'en-US',viewport:{width:1280,height:960}})).newPage():b.contexts()[0].pages().find(p=>p.url()==='dsh-app://app/');
if(web){const log=await fs.readFile('evidence/logs/web-v2.log','utf8');await p.goto(log.match(/dsh web: (http[^\s]+)/)[1]);const onboarding=p.getByRole('dialog',{name:'Get started',exact:true});try{await onboarding.waitFor({timeout:3000});await onboarding.getByRole('button',{name:'Close',exact:true}).click();}catch(e){if(e.name!=='TimeoutError')throw e;}}
const api=async(route,body)=>p.evaluate(async({route,body})=>{const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{route,body});
const previous=JSON.parse(await fs.readFile('evidence/'+tag+'-acceptance.json','utf8'));
const report={host:web?'DSH Web':'DSH NEXT',startedAt:new Date().toISOString(),cases:[]};
try{
 for(const c of previous.cases){assert.equal(c.status,'PASS');const state=(await api('/cleaner-e2e',{action:'state',id:c.id})).data;assert.equal(state.session,false);assert.equal(state.member,false);assert.equal(state.survivor,true);assert.equal(state.keep,c.before.keep);assert.equal(state.output.exists,c.kind==='A');assert.equal(state.orphan.exists,c.kind!=='C');assert.equal(state.shared.exists,true);
  const row={kind:c.kind,id:c.id,restartState:state,restart:'PASS'};report.cases.push(row);
  const w=p.locator('[data-row-key="workspace:'+state.fixture.workspaceId+'"]');if(await w.getAttribute('aria-expanded')==='false')await w.click();
  assert.equal(await p.locator('[data-row-key="session:'+c.id+'"]').count(),0);
  const response=await api('/dsh-conversation-cleaner/v1/restore',{operationId:c.result.operationId,acknowledged:true});assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.data.state,'RESTORED');
  const restored=(await api('/cleaner-e2e',{action:'state',id:c.id})).data;assert.equal(restored.session,true);assert.equal(restored.member,true);assert.equal(restored.output.exists,true);assert.equal(restored.orphan.exists,true);assert.equal(restored.orphan.links,2);assert.equal(restored.shared.exists,true);assert.equal(restored.survivor,true);assert.equal(restored.keep,c.before.keep);
  await expect(p.locator('[data-row-key="session:'+c.id+'"]')).toBeVisible();row.restoreState=restored;row.restore='PASS';
  const deep=await api('/dsh-conversation-cleaner/v1/plan',{sessionId:c.id,mode:'full'});assert.equal(deep.status,200,JSON.stringify(deep));assert.deepEqual(deep.data.blockers,[]);row.restoredProvenance='PASS';
  await p.screenshot({path:'evidence/screenshots/'+tag+'-'+c.kind.toLowerCase()+'-restored.png',fullPage:true});console.log(c.kind+' '+report.host+' restart absence + restoration + live row + restored ownership PASS');
 }
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.stack;throw e;}finally{report.finishedAt=new Date().toISOString();await fs.writeFile('evidence/'+tag+'-restart-restore.json',JSON.stringify(report,null,2));await b.close();}
