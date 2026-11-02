import {chromium} from 'playwright';
import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const log=await fs.readFile('evidence/logs/shared-web.log','utf8'),launch=log.match(/dsh web: (http[^\s]+)/)[1],origin=new URL(launch).origin;
const auth=await fetch(launch,{redirect:'manual'});assert.equal(auth.status,303);const cookie=auth.headers.getSetCookie()[0].split(';')[0];
const b=await chromium.connectOverCDP('http://127.0.0.1:39119'),p=b.contexts()[0].pages().find(p=>p.url()==='dsh-app://app/');
const next=async(route,body)=>p.evaluate(async({route,body})=>{const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{route,body});
const web=async(route,body)=>{const r=await fetch(origin+route,{method:'POST',headers:{'content-type':'application/json',cookie,origin},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
const report={hosts:['DSH NEXT 2.0.20-next/Core rc3 desktop','Official DSH Core rc3 web'],root:'.test-data/next-normal',startedAt:new Date().toISOString(),cases:[]};
const fixtures=JSON.parse(await fs.readFile('evidence/next-acceptance.json','utf8')).cases;
const plan=(host,id)=>host('/dsh-conversation-cleaner/v1/plan',{sessionId:id,mode:'chat_only'});
const commit=(host,plan)=>host('/dsh-conversation-cleaner/v1/commit',{planId:plan.data.planId,confirmation:plan.data.confirmation,acknowledged:true});
try{
 for(const [id,holder,deleting,label] of [[fixtures[0].id,next,web,'NEXT owns session; DSH refuses'],[fixtures[1].id,web,next,'DSH owns session; NEXT refuses']]){
  const held=await holder('/cleaner-e2e',{action:'hold',id});assert.equal(held.status,200,JSON.stringify(held));
  try{const preview=await plan(deleting,id);assert.equal(preview.status,200,JSON.stringify(preview));const result=await commit(deleting,preview);assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.data.code,'SESSION_BUSY');report.cases.push({label,id,status:'PASS',result});}
  finally{const released=await holder('/cleaner-e2e',{action:'release',id});assert.equal(released.status,200,JSON.stringify(released));}
  console.log(label+': PASS');
 }
 const id=fixtures[2].id,plans=await Promise.all([plan(next,id),plan(web,id)]);for(const preview of plans){assert.equal(preview.status,200,JSON.stringify(preview));assert.deepEqual(preview.data.blockers,[]);}
 const results=await Promise.all([commit(next,plans[0]),commit(web,plans[1])]);assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));const lost=results.find(r=>r.status!==200);assert.ok([409,503,404].includes(lost.status),JSON.stringify(lost));
 const winner=results[0].status===200?next:web,result=results.find(r=>r.status===200);const state=await winner('/cleaner-e2e',{action:'state',id});assert.equal(state.data.session,false);assert.equal(state.data.survivor,true);assert.equal(state.data.output.exists,true);assert.equal(state.data.orphan.exists,true);assert.equal(state.data.shared.exists,true);
 const restore=await winner('/dsh-conversation-cleaner/v1/restore',{operationId:result.data.operationId,acknowledged:true});assert.equal(restore.status,200,JSON.stringify(restore));
 report.cases.push({label:'Concurrent deletion serializes; one winner, stale competing host refuses; winner restores',id,status:'PASS',results,restore});report.status='PASS';console.log('Concurrent two-real-host deletion + recovery: PASS');
}catch(e){report.status='FAIL';report.error=e.stack;throw e;}finally{report.finishedAt=new Date().toISOString();await fs.writeFile('evidence/shared-host-check.json',JSON.stringify(report,null,2));await b.close();}
