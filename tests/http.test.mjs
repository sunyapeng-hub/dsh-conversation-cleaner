import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeHandler } from '../src/host/index.js';
async function serve(t){const cleaner={async plan(input){return {sessionId:input.sessionId};}};const ctx={get:k=>k==='connection'?{requestRejection:r=>r.headers.authorization==='Bearer test-owner'?undefined:401}:undefined};const server=http.createServer(makeHandler(ctx,cleaner,'plan'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return 'http://127.0.0.1:'+server.address().port;}
test('HTTP rejects anonymous requests',async t=>{const url=await serve(t);assert.equal((await fetch(url,{method:'POST'})).status,401);});
test('HTTP rejects cross-origin requests despite valid login',async t=>{const url=await serve(t);assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer test-owner',origin:'https://evil.example'}})).status,403);});
test('HTTP rejects wrong method and media type',async t=>{const url=await serve(t);assert.equal((await fetch(url,{headers:{authorization:'Bearer test-owner'}})).status,405);assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer test-owner'}})).status,415);});
test('HTTP rejects malformed JSON and oversized input',async t=>{const url=await serve(t);const headers={authorization:'Bearer test-owner','content-type':'application/json'};assert.equal((await fetch(url,{method:'POST',headers,body:'{'})).status,400);assert.equal((await fetch(url,{method:'POST',headers,body:'x'.repeat(17000)})).status,413);});
test('authenticated same-origin JSON request succeeds',async t=>{const url=await serve(t);const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer test-owner','content-type':'application/json',origin:url},body:JSON.stringify({sessionId:'test'})});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,sessionId:'test'});});

async function recoveryServer(t,action){
 const calls=[],cleaner={async restore(id,options){calls.push({action,id,options});return {operationId:id,state:'RESTORED'};},async purge(id){calls.push({action,id});return {operationId:id,state:'PERMANENT'};},async compact(id){calls.push({action,id});return {operationId:id,compacted:true};},async operations(){return {pending:['selected'],operations:[{operationId:'selected',state:'PURGING',canResumePurge:true}]};}};
 const ctx={get:key=>key==='connection'?{requestRejection:r=>r.headers.authorization==='Bearer test-owner'?undefined:401}:undefined},server=http.createServer(makeHandler(ctx,cleaner,action));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return {url:'http://127.0.0.1:'+server.address().port,calls};
}
test('restore, purge and compact remain authenticated, same-origin and explicitly acknowledged',async t=>{
 for(const action of ['restore','purge','compact']){const {url,calls}=await recoveryServer(t,action),body=JSON.stringify({operationId:'selected',acknowledged:true});assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body})).status,401);assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer test-owner','content-type':'application/json',origin:'https://invalid.example'},body})).status,403);assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer test-owner','content-type':'application/json'},body:'{"operationId":"selected"}'})).status,400);assert.deepEqual(calls,[]);
  const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer test-owner','content-type':'application/json'},body});assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0].id,'selected');
 }
});
test('recovery operations list exposes action capabilities under the existing authentication gate',async t=>{
 const {url}=await recoveryServer(t,'operations');assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);const r=await fetch(url,{method:'POST',headers:{authorization:'Bearer test-owner','content-type':'application/json'},body:'{}'});assert.deepEqual(await r.json(),{ok:true,pending:['selected'],operations:[{operationId:'selected',state:'PURGING',canResumePurge:true}]});
});
