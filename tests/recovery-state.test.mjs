import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {Cleaner,CleanerError} from '../src/host/cleaner.js';
const ID='session-11111111-1111-4111-8111-111111111111',OTHER='session-22222222-2222-4222-8222-222222222222',SECRET='SYNTHETIC_RECOVERY_BODY_DO_NOT_RETAIN';
async function fixture(t){
 const base=path.resolve('.test-data/recovery-tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));
 t.after(async()=>{if(!root.startsWith(base+path.sep))throw Error('Fixture escaped');await fs.rm(root,{recursive:true,force:true});});
 const indexed=new Set(),files=new Map(),state={missingWorkspace:false,failRestore:false};
 const add=async(id=ID)=>{const log=path.join(root,'sessions',id,'v4.jsonl');await fs.mkdir(path.dirname(log),{recursive:true});await fs.writeFile(log,'synthetic selected conversation');files.set(id,log);indexed.add(id);return log;};const log=await add();
 const adapter={root,async inspect(id,options){return {session:{id,title:'Synthetic recovery fixture'},ids:[id],children:[],candidates:[{path:files.get(id),root,kind:'session'}],preserved:[],blockers:[],metadata:{recoveryReferences:[{id,references:[SECRET]}],domains:[{value:{messages:[SECRET]}}],workspace:[{id:'old-workspace',sessionIds:[id]}]},...options};},async acquire(){return async()=>{};},async forget(ids){for(const id of ids)indexed.delete(id);},async preflightRestore(_ids,_metadata,{ungrouped=false}={}){if(state.missingWorkspace&&!ungrouped)throw new CleanerError('RESTORE_WORKSPACE_MISSING');},async restore(ids,_metadata,options){if(state.failRestore)throw Error('injected restore failure');state.restoreOptions=options;for(const id of ids)indexed.add(id);},async verify(ids){for(const id of ids)assert.equal(indexed.has(id),false);},async broadcast(){}};
 const cleaner=new Cleaner(adapter),read=async op=>JSON.parse(await fs.readFile(path.join(cleaner.base,'operations',op,'journal.json'),'utf8'));
 const remove=async(permanent=false)=>{const p=await cleaner.plan({sessionId:ID});return cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true,permanent});};
 return {root,log,state,files,indexed,adapter,cleaner,add,read,remove};
}
test('permanent terminal record contains no body, projections, ids, paths or recovery units',async t=>{
 const f=await fixture(t),r=await f.remove(true),journal=await f.read(r.operationId),json=JSON.stringify(journal);assert.equal(journal.state,'PERMANENT');assert.ok(!json.includes(SECRET));assert.ok(!json.includes(f.log));for(const key of ['metadata','units','ids','summary'])assert.equal(key in journal,false);assert.equal(r.restorable,false);
});
test('successful restoration also compacts its obsolete recovery payload',async t=>{
 const f=await fixture(t),r=await f.remove();await f.cleaner.restore(r.operationId);const j=await f.read(r.operationId);assert.equal(j.state,'RESTORED');assert.ok(!JSON.stringify(j).includes(SECRET));assert.equal('units' in j,false);assert.ok(await fs.stat(f.log));await assert.rejects(f.cleaner.restore(r.operationId),/ALREADY_RESTORED/);
});
test('missing workspace is rejected before moving files, remains pending, and explicit ungrouped retry succeeds',async t=>{
 const f=await fixture(t),r=await f.remove();f.state.missingWorkspace=true;await assert.rejects(f.cleaner.restore(r.operationId),/RESTORE_WORKSPACE_MISSING/);await assert.rejects(fs.stat(f.log),{code:'ENOENT'});assert.equal((await f.read(r.operationId)).state,'RESTORE_FAILED');assert.deepEqual(await f.cleaner.pending(),[r.operationId]);
 await f.cleaner.restore(r.operationId,{ungrouped:true});assert.ok(await fs.stat(f.log));assert.equal(f.state.restoreOptions.ungrouped,true);assert.deepEqual(await f.cleaner.pending(),[]);
});
test('a registry failure after file restoration is pending and can be retried without overwriting',async t=>{
 const f=await fixture(t),r=await f.remove();f.state.failRestore=true;await assert.rejects(f.cleaner.restore(r.operationId),/injected restore failure/);assert.ok(await fs.stat(f.log));assert.equal((await f.read(r.operationId)).state,'RESTORE_FAILED');assert.deepEqual(await f.cleaner.pending(),[r.operationId]);f.state.failRestore=false;await f.cleaner.restore(r.operationId);assert.deepEqual(await f.cleaner.pending(),[]);assert.equal(f.indexed.has(ID),true);
});
test('an interrupted permanent purge can resume after some or all exact staged paths are already absent',async t=>{
 for(const allGone of [false,true]){const f=await fixture(t),r=await f.remove(),file=path.join(f.cleaner.base,'operations',r.operationId,'journal.json'),j=await f.read(r.operationId);j.state='PURGING';j.permanent=true;await fs.writeFile(file,JSON.stringify(j));if(allGone)await fs.unlink(j.units[0].staged);
  const done=await f.cleaner.purge(r.operationId);assert.equal(done.state,'PERMANENT');assert.deepEqual(await f.cleaner.pending(),[]);assert.ok(!JSON.stringify(await f.read(r.operationId)).includes(SECRET));assert.equal((await f.cleaner.purge(r.operationId)).state,'PERMANENT');
 }
});
test('purge and compaction cannot turn an ordinary recoverable deletion into a permanent one',async t=>{
 const f=await fixture(t),r=await f.remove();await assert.rejects(f.cleaner.purge(r.operationId),/NOT_PURGING/);await assert.rejects(f.cleaner.compact(r.operationId),/NOT_TERMINAL/);assert.equal((await f.read(r.operationId)).state,'VERIFIED');await f.cleaner.restore(r.operationId);
});
test('legacy terminal compaction removes only metadata and never touches restored live files',async t=>{
 const f=await fixture(t),r=await f.remove();await f.cleaner.restore(r.operationId);const file=path.join(f.cleaner.base,'operations',r.operationId,'journal.json'),j=await f.read(r.operationId);j.metadata={body:SECRET};j.ids=[ID];j.summary={title:SECRET};await fs.writeFile(file,JSON.stringify(j));const history=await f.cleaner.operations();assert.equal(history.operations.find(x=>x.operationId===r.operationId).canCompact,true);await f.cleaner.compact(r.operationId);assert.ok(await fs.stat(f.log));assert.ok(!JSON.stringify(await f.read(r.operationId)).includes(SECRET));
});
test('resume purge refuses a staged path changed to an unrelated file',async t=>{
 const f=await fixture(t),r=await f.remove(),file=path.join(f.cleaner.base,'operations',r.operationId,'journal.json'),j=await f.read(r.operationId),unrelated=path.join(f.root,'user-file.txt');await fs.writeFile(unrelated,'preserve');j.state='PURGING';j.permanent=true;j.units[0].staged=unrelated;await fs.writeFile(file,JSON.stringify(j));await assert.rejects(f.cleaner.purge(r.operationId),/UNSAFE_PURGE_PATH/);assert.equal(await fs.readFile(unrelated,'utf8'),'preserve');
});
test('permanent deletion removes the complete known hardlink group without relaxing alias checks',async t=>{
 const f=await fixture(t),one=path.join(f.root,'attachment-object'),two=path.join(f.root,'attachment-alias');await fs.writeFile(one,'synthetic attachment');await fs.link(one,two);const inspect=f.adapter.inspect;f.adapter.inspect=async(id,o)=>{const info=await inspect(id,o);info.candidates.push(...[one,two].map(file=>({path:file,root:f.root,kind:'attachment',expectedLinks:2})));return info;};const r=await f.remove(true);assert.equal(r.state,'PERMANENT');await assert.rejects(fs.stat(one),{code:'ENOENT'});await assert.rejects(fs.stat(two),{code:'ENOENT'});
});
test('real Windows purge sharing violation remains actionable and resume clears the blocker',async t=>{
 if(process.platform!=='win32'){t.skip('Windows sharing violation case');return;}const f=await fixture(t),spill=path.join(path.dirname(f.log),'spill.txt');await fs.writeFile(spill,'synthetic second file');const inspect=f.adapter.inspect;f.adapter.inspect=async(id,o)=>{const result=await inspect(id,o);if(id===ID)result.candidates.push({path:spill,root:f.root,kind:'session'});return result;};let locker;
 const verify=f.adapter.verify;f.adapter.verify=async ids=>{await verify(ids);const [op]=await fs.readdir(path.join(f.cleaner.base,'operations')),j=await f.read(op),target=j.units.at(-1).staged;locker=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$s=[System.IO.File]::Open($env:CLEANER_TEST_LOCK,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::None);[Console]::WriteLine('LOCKED');[Console]::Out.Flush();[Console]::ReadLine()|Out-Null;$s.Dispose()"],{windowsHide:true,env:{...process.env,CLEANER_TEST_LOCK:target},stdio:['pipe','pipe','pipe']});const [ready]=await once(locker.stdout,'data',{signal:AbortSignal.timeout(5000)});assert.match(String(ready),/LOCKED/);};
 try{await assert.rejects(f.remove(true),/PURGE_INCOMPLETE/);}finally{if(locker){const ended=once(locker,'exit',{signal:AbortSignal.timeout(5000)});locker.stdin.end('\n');await ended;}}
 const [op]=await f.cleaner.pending();assert.equal((await f.read(op)).state,'PURGING');await f.cleaner.purge(op);assert.deepEqual(await f.cleaner.pending(),[]);await f.add(OTHER);f.adapter.verify=verify;const p=await f.cleaner.plan({sessionId:OTHER});assert.equal((await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true})).state,'VERIFIED');
});
