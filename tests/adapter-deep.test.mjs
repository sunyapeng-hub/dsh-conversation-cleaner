import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DshAdapter,fileIdentity} from '../src/adapters/dsh.js';
const run=promisify(execFile),id='session-11111111-1111-4111-8111-111111111111',other='session-22222222-2222-4222-8222-222222222222';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'deep-adapter-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const sessions=path.join(root,'sessions'),storages=path.join(root,'storages');await fs.mkdir(storages,{recursive:true});
 const state={initialized:true,workspaceIds:[],archivedSessionIds:[],pinnedSessionIds:[]},records={};
 const writeRegistry=()=>fs.writeFile(path.join(storages,'workspace.json'),JSON.stringify({unit:{name:'workspace',version:2},global:state,tables:{workspaces:records}}));await writeRegistry();
 const rows=[],events=new Map(),reads=new Map(),writes=[],closed=[],live=new Map(),pending=new Set();
 const add=async(sid,{toolEvents=[],cwd=path.join(root,sid),materialized=true}={})=>{await fs.mkdir(cwd,{recursive:true});const row={header:{id:sid,cwd,createdAt:1},revision:'revision-'+sid,...materialized?{sizeBytes:4}:{}};rows.push(row);events.set(sid,toolEvents);if(materialized){const loc=path.join(sessions,'project',sid,'v4.jsonl');await fs.mkdir(path.dirname(loc),{recursive:true});await fs.writeFile(loc,'log\n');}else pending.add(sid);return row;};await add(id);
 const services={sessionPersistence:{root:sessions,async stat(sid){return rows.find(r=>r.header.id===sid);},async list(){return [...rows];},locate(h){return {path:path.join(sessions,'project',h.id,'v4.jsonl')};},hasPendingSession(sid){return pending.has(sid);},async open(sid,access){if(access==='write')writes.push(sid);return {async read(){reads.set(sid,(reads.get(sid)??0)+1);return {events:events.get(sid)??[]};},async close(){if(access==='write')closed.push(sid);}};},async acquireWriteLease(h){writes.push(h.id);return {async release(){closed.push(h.id);}};}},workspaceRegistry:{list(){return [];},archivedSessionIds:[],pinnedSessionIds:[]},storageDomain:{get(name){if(name==='workspace')return {global:{get:()=>structuredClone(state)},table:()=>({entries:()=>Object.entries(records)[Symbol.iterator]()})};}},storage:{backend:{get:name=>name==='json'?{root:storages}:undefined}},sessions:{get:sid=>live.get(sid),list:()=>[...live.values()]},sessionController:{async list(){return {items:[{sessionId:id,title:'Authoritative latest title'}]};}}};
 const ctx={get:key=>services[key],emit(){}};const coordinator={supported:true};const adapter=new DshAdapter(ctx,{coordinator});
 const proof=async(sid,record)=>{await fs.mkdir(path.dirname(adapter.recordPath(sid)),{recursive:true});await fs.writeFile(adapter.recordPath(sid),JSON.stringify(record));};
 return {root,storages,state,records,writeRegistry,services,adapter,coordinator,rows,events,reads,writes,closed,live,pending,add,proof};
}
const call=(callId,name='write',argumentsValue={})=>({type:'tool/call',data:{callId,name,arguments:JSON.stringify(argumentsValue)}});
test('coordinated plain historical sessions support B and C and expose the current public title',async t=>{
 const f=await fixture(t);await f.add(other);const b=await f.adapter.inspect(id,{mode:'chat_and_outputs'});assert.deepEqual(b.blockers,[]);assert.equal(b.session.title,'Authoritative latest title');assert.equal(f.reads.get(id),1);assert.equal(f.reads.get(other),1);
 const c=await f.adapter.inspect(id,{mode:'full'});assert.deepEqual(c.blockers,[]);assert.equal(c.session.attachmentCount,0);assert.equal(c.candidates.length,1);
});
test('untracked target and survivor operations block strict deep deletion',async t=>{
 const f=await fixture(t);f.events.set(id,[call('target-call')]);const b=await f.adapter.inspect(id,{mode:'chat_and_outputs'});assert.ok(b.blockers.includes('PROVENANCE_UNKNOWN'));
 f.events.set(id,[]);await f.add(other,{toolEvents:[call('unrecorded','bash')]});const survivor=await f.adapter.inspect(id,{mode:'chat_and_outputs'});assert.ok(survivor.blockers.includes('OTHER_SESSION_PROVENANCE_UNKNOWN'));
});
test('complete call ownership in a different cwd preserves structural cross-session references',async t=>{
 const f=await fixture(t);const output=path.join(f.rows[0].header.cwd,'generated.txt');await fs.writeFile(output,'created');f.events.set(id,[call('created')]);await f.proof(id,{complete:true,unknown:false,seenCallIds:['created'],references:[output],outputs:[{path:output,identity:fileIdentity(await fs.stat(output))}]});
 await f.add(other,{toolEvents:[call('read-other','read',{file_path:output})]});await f.proof(other,{complete:true,unknown:false,seenCallIds:['read-other'],references:[],outputs:[]});
 const shared=await f.adapter.inspect(id,{mode:'chat_and_outputs'});assert.deepEqual(shared.blockers,[]);assert.ok(shared.preserved.some(p=>p.path===output&&p.reason==='SHARED_OUTPUT'));assert.ok(!shared.candidates.some(c=>c.path===output));
 f.events.set(other,[call('different-call','read')]);const stale=await f.adapter.inspect(id,{mode:'chat_and_outputs'});assert.ok(stale.blockers.includes('OTHER_SESSION_PROVENANCE_UNKNOWN'));
});
test('unshared proven generated output is planned while Git tracked output is preserved',async t=>{
 const f=await fixture(t);const cwd=f.rows[0].header.cwd,output=path.join(cwd,'generated.txt');await fs.writeFile(output,'created');f.events.set(id,[call('created')]);await f.proof(id,{complete:true,unknown:false,seenCallIds:['created'],references:[output],outputs:[{path:output,identity:fileIdentity(await fs.stat(output))}]});
 const clean=await f.adapter.inspect(id,{mode:'chat_and_outputs'});assert.deepEqual(clean.blockers,[]);assert.ok(clean.candidates.some(c=>c.path===output&&c.kind==='output'));
 await run('git',['init',cwd],{windowsHide:true});await run('git',['-C',cwd,'add','generated.txt'],{windowsHide:true});const tracked=await f.adapter.inspect(id,{mode:'chat_and_outputs'});assert.deepEqual(tracked.blockers,[]);assert.ok(tracked.preserved.some(p=>p.path===output&&p.reason==='GIT_TRACKED'));
});
test('C integrates file attachment planner and preserves unselected attachment refs',async t=>{
 const f=await fixture(t);const {Context}=await import('../research/installed-next/node_modules/@deepseek-ai/cordis/lib/index.js');const {LocalAttachmentStore}=await import('../research/installed-next/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js');const store=new LocalAttachmentStore(new Context(),{dshHome:f.root});f.services.attachments=store;const file=await store.saveFile({data:Buffer.from('test attachment'),name:'selected.txt'});f.events.set(id,[{type:'user/message',data:{content:[{type:'file',attachment:file}]}}]);
 const orphan=await f.adapter.inspect(id,{mode:'full'});assert.deepEqual(orphan.blockers,[]);assert.equal(orphan.session.attachmentCount,1);assert.equal(orphan.candidates.filter(c=>c.kind==='attachment').length,2);
 await f.add(other,{toolEvents:[{type:'user/message',data:{content:[{type:'file',attachment:file}]}}]});const shared=await f.adapter.inspect(id,{mode:'full'});assert.deepEqual(shared.blockers,[]);assert.equal(shared.candidates.filter(c=>c.kind==='attachment').length,0);
});
test('deep acquire leases every materialized session and ignores an empty unmaterialized pending session',async t=>{
 const f=await fixture(t);await f.add(other);const blank='session-33333333-3333-4333-8333-333333333333';await f.add(blank,{materialized:false});const release=await f.adapter.acquire([id],{mode:'full'});assert.deepEqual(f.writes,[id,other]);await release();assert.deepEqual(f.closed,[other,id]);
});
test('deep acquisition closes acquired handles if a foreign writer owns a survivor',async t=>{
 const f=await fixture(t);await f.add(other);const open=f.services.sessionPersistence.open;f.services.sessionPersistence.open=async(sid,access)=>{if(sid===other&&access==='write')throw Object.assign(new Error('owned'),{name:'SessionAlreadyOwnedError'});return open(sid,access);};await assert.rejects(f.adapter.acquire([id],{mode:'full'}),e=>e.code==='SESSION_BUSY');assert.ok(f.closed.includes(id));
});

test('host-owned empty draft with only initial policy events is exempt, queued input is not',async t=>{
 const f=await fixture(t);await f.add(other,{toolEvents:['permission/preset','sandbox/mode','approval/policy','session/end-seed'].map(type=>({type,data:{}}))});f.live.set(other,{});let pending=false;f.services.agents={get:()=>({status:'idle',inbox:{get hasPending(){return pending;}}})};
 const release=await f.adapter.acquire([id],{mode:'full'});await release();assert.deepEqual(f.writes,[id]);pending=true;await assert.rejects(f.adapter.acquire([id],{mode:'full'}),e=>e.code==='SESSION_BUSY');
});

test('staged unsent upload receipts and recoverable quarantined references retain attachments',async t=>{
 const f=await fixture(t);const {Context}=await import('../research/installed-next/node_modules/@deepseek-ai/cordis/lib/index.js');const {LocalAttachmentStore}=await import('../research/installed-next/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js');const store=new LocalAttachmentStore(new Context(),{dshHome:f.root});f.services.attachments=store;const ref=await store.saveFile({data:Buffer.from('shared staged file'),name:'pending.txt'});f.events.set(id,[{type:'user/message',data:{content:[{type:'file',attachment:ref}]}}]);
 const agent={id:other,session:{}};const stagedFiles=new WeakMap([[agent.session,new Map([['receipt',{file:ref}]])]]);f.services.fileUploads={stagedFiles};f.services.agents={list:()=>[agent]};f.coordinator.receiptBridgeSupported=true;
 const pending=await f.adapter.inspect(id,{mode:'full'});assert.deepEqual(pending.blockers,[]);assert.equal(pending.candidates.filter(c=>c.kind==='attachment').length,0);
 stagedFiles.delete(agent.session);const op=path.join(f.root,'.conversation-cleaner','operations','11111111-1111-4111-8111-111111111111');await fs.mkdir(op,{recursive:true});await fs.writeFile(path.join(op,'journal.json'),JSON.stringify({state:'VERIFIED',metadata:{recoveryReferences:[{id:other,cwd:f.root,references:[ref.attachmentId]}]}}));
 const quarantined=await f.adapter.inspect(id,{mode:'full'});assert.deepEqual(quarantined.blockers,[]);assert.equal(quarantined.candidates.filter(c=>c.kind==='attachment').length,0);
 await fs.writeFile(path.join(op,'journal.json'),JSON.stringify({state:'VERIFIED',metadata:{}}));await assert.rejects(f.adapter.inspect(id,{mode:'full'}),e=>e.code==='QUARANTINE_REFERENCE_UNKNOWN');
});
test('registry comparison detects stale foreign globals and records before any overwrite',async t=>{
 const f=await fixture(t);assert.equal(typeof f.adapter.checkRegistry,'function');await f.adapter.checkRegistry();const file=path.join(f.storages,'workspace.json');const disk=JSON.parse(await fs.readFile(file,'utf8'));disk.global.pinnedSessionIds=[other];await fs.writeFile(file,JSON.stringify(disk));await assert.rejects(f.adapter.checkRegistry(),e=>e.code==='REGISTRY_EXTERNAL_CHANGE_RESTART_REQUIRED');
 disk.global=structuredClone(f.state);disk.tables.workspaces.foreign={id:'foreign',sessionIds:[other]};await fs.writeFile(file,JSON.stringify(disk));await assert.rejects(f.adapter.checkRegistry(),e=>e.code==='REGISTRY_EXTERNAL_CHANGE_RESTART_REQUIRED');assert.equal(f.services.workspaceRegistry.list().length,0);
});
test('coordinated cleanup blocks unknown registry backend and snapshots the persisted corpus',async t=>{
 const f=await fixture(t);const first=await f.adapter.inspect(id);assert.deepEqual(first.blockers,[]);assert.deepEqual(first.metadata.corpus.map(r=>r.id),[id]);await f.add(other);const next=await f.adapter.inspect(id,{locked:true});assert.notDeepEqual(next.metadata.corpus,first.metadata.corpus);
 f.services.storage.backend.get=()=>undefined;const blocked=await f.adapter.inspect(id);assert.ok(blocked.blockers.includes('REGISTRY_BACKEND_UNSUPPORTED'));
});

test('deep modes refuse an unreadable physical log omitted by the persistence list',async t=>{
 const f=await fixture(t);const unreadable=path.join(f.services.sessionPersistence.root,'project','unreadable-session');await fs.mkdir(unreadable,{recursive:true});await fs.writeFile(path.join(unreadable,'session.v4.jsonl.zstd'),'invalid compressed data');
 for(const mode of ['chat_and_outputs','full'])await assert.rejects(f.adapter.inspect(id,{mode}),e=>e.code==='CORPUS_REFERENCE_UNREADABLE');const a=await f.adapter.inspect(id,{mode:'chat_only'});assert.deepEqual(a.blockers,[]);
});

test('ordinary reference scans support a corpus larger than 32 MiB without dropping survivors',async t=>{
 const f=await fixture(t);await f.add(other);const text='x'.repeat(17*1024*1024);f.events.set(id,[{type:'user/message',data:{text}}]);f.events.set(other,[{type:'user/message',data:{text}}]);
 const plan=await f.adapter.inspect(id,{mode:'chat_and_outputs'});assert.deepEqual(plan.blockers,[]);assert.equal(f.reads.get(id),1);assert.equal(f.reads.get(other),1);assert.equal(plan.metadata.corpus.length,2);
});

test('selected idle local handle is releasable at commit; preview never closes it',async t=>{
 const f=await fixture(t);f.live.set(id,{});let closes=0;
 f.adapter.releaseBridge={blocker:()=>undefined,async release(ids){assert.deepEqual(ids,[id]);closes++;f.live.delete(id);}};
 const plan=await f.adapter.inspect(id);assert.deepEqual(plan.blockers,[]);assert.equal(closes,0);
 await f.adapter.releaseTargets([id]);const release=await f.adapter.acquire([id],plan);await release();assert.equal(closes,1);
});
