import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DshAdapter, descendants } from '../src/adapters/dsh.js';
const id='session-12345678-1234-1234-1234-123456789abc';
test('forks are excluded from child deletion',()=>{
 const child={id:'child',origin:'subagent',parentSession:id};const fork={id:'fork',origin:'fork',parentSession:id};
 assert.deepEqual(descendants([{id},child,fork],id),[child]);
});
test('restoration broadcasts added summaries rather than removal',async()=>{
 const events=[];const services={sessionPersistence:{root:'C:/test/sessions',locate(){},open(){}},workspaceRegistry:{},sessionController:{async list(){return {items:[{sessionId:id,title:'Recovered'}]};}}};
 const adapter=new DshAdapter({get:k=>services[k],emit:(...args)=>events.push(args)});
 await adapter.broadcast([id],{restored:true});assert.deepEqual(events,[['api-session/added',{sessionId:id,title:'Recovered'}]]);
});
test('adapter locates stored log through host and blocks historical outputs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adapter-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const sessions=path.join(root,'sessions');const dir=path.join(sessions,'project',id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'v4.jsonl'),'log');
 const header={id,cwd:root,createdAt:1};
 const services={sessionPersistence:{root:sessions,async stat(){return {header};},async list(){return [{header}];},locate(){return {path:path.join(dir,'v4.jsonl')};},async open(){return {async read(){return {events:[]};},async close(){}};}},sessions:{get(){},list(){return [];}},workspaceRegistry:{list(){return [];},archivedSessionIds:[],pinnedSessionIds:[]},storageDomain:{get(){}}};
 const adapter=new DshAdapter({get:k=>services[k],emit(){}},{exclusiveDataRoot:true});
 const a=await adapter.inspect(id,{mode:'chat_only'});assert.equal(a.candidates[0].path,path.join(dir,'v4.jsonl'));assert.deepEqual(a.blockers,[]);
 const defaultAdapter=new DshAdapter({get:k=>services[k],emit(){}});assert.ok((await defaultAdapter.inspect(id,{mode:'chat_only'})).blockers.includes('DATA_ROOT_EXCLUSIVITY_REQUIRED'));
 const b=await adapter.inspect(id,{mode:'chat_and_outputs'});assert.ok(b.blockers.includes('ROOT_COORDINATION_REQUIRED'));
 services.sessions.get=()=>({});const busy=await adapter.inspect(id,{mode:'chat_only'});assert.ok(busy.blockers.includes('SESSION_BUSY'));
});
