import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import { Cleaner } from '../src/host/cleaner.js';

const ID = 'session-12345678-1234-1234-1234-123456789abc';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cleaner-test-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const log = path.join(root, 'sessions', ID, 'v4.jsonl');
  await fs.mkdir(path.dirname(log), {recursive:true}); await fs.writeFile(log, 'conversation');
  const other = path.join(root, 'other.txt'); await fs.writeFile(other, 'preserve me');
  const state = {busy:false, indexed:true, fail:false};
  const adapter = {
    root, async inspect(id, options) {
      assert.equal(id, ID);
      return {session:{id,title:'Test',cwd:root},ids:[id],children:[],candidates:[{path:log,root,kind:'session'}],preserved:[],blockers:state.busy?['SESSION_BUSY']:[], metadata:{indexed:state.indexed}, ...options};
    },
    async acquire() { if(state.busy) throw new Error('SESSION_BUSY'); return async()=>{}; },
    async forget() { state.indexed=false; if(state.fail) throw new Error('injected registry failure'); },
    async restore() { state.indexed=true; },
    async verify() { assert.equal(state.indexed,false); },
    async broadcast() {},
  };
  const cleaner = new Cleaner(adapter);
  return {root,log,other,state,adapter,cleaner};
}
test('preview is read-only and A preserves unrelated files', async t=>{
  const f=await fixture(t);const plan=await f.cleaner.plan({sessionId:ID});
  assert.equal(plan.mode,'chat_only'); assert.equal(await fs.readFile(f.log,'utf8'),'conversation');
  const result=await f.cleaner.commit({planId:plan.planId,confirmation:plan.confirmation,acknowledged:true});
  assert.equal(result.state,'VERIFIED');await assert.rejects(fs.stat(f.log),{code:'ENOENT'});
  assert.equal(await fs.readFile(f.other,'utf8'),'preserve me');
  await f.cleaner.restore(result.operationId);assert.equal(await fs.readFile(f.log,'utf8'),'conversation');assert.equal(f.state.indexed,true);
});
test('unacknowledged request cannot delete', async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});await assert.rejects(f.cleaner.commit({planId:p.planId,confirmation:p.confirmation}),/ACK_REQUIRED/);assert.ok(await fs.stat(f.log));});
test('changed bytes invalidate plan even if size is unchanged',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});await fs.writeFile(f.log,'CONVERSATION');await assert.rejects(f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true}),/PLAN_CHANGED/);assert.ok(await fs.stat(f.log));});
test('active writer blocks transaction before mutation',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});f.state.busy=true;await assert.rejects(f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true}),/SESSION_BUSY/);assert.ok(await fs.stat(f.log));});
test('registry failure compensates files and membership',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});f.state.fail=true;await assert.rejects(f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true}),/injected registry failure/);assert.equal(await fs.readFile(f.log,'utf8'),'conversation');assert.equal(f.state.indexed,true);});
test('plan is single-use',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});const req={planId:p.planId,confirmation:p.confirmation,acknowledged:true};await f.cleaner.commit(req);await assert.rejects(f.cleaner.commit(req),/PLAN_MISSING/);});
test('expired plan is rejected',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});f.cleaner.plans.get(p.planId).expiresAt=0;await assert.rejects(f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true}),/PLAN_EXPIRED/);});
test('invalid ID never reaches adapter',async t=>{const f=await fixture(t);for(const sessionId of ['../x','C:/Windows','abc',null])await assert.rejects(f.cleaner.plan({sessionId}),/INVALID_SESSION/);});
test('unknown modes are rejected',async t=>{const f=await fixture(t);await assert.rejects(f.cleaner.plan({sessionId:ID,mode:'everything'}),/INVALID_MODE/);});
test('root directory cannot be a deletion target',async t=>{const f=await fixture(t);f.adapter.inspect=async()=>({session:{id:ID},ids:[ID],candidates:[{path:f.root,root:f.root,kind:'output'}],preserved:[],blockers:[]});await assert.rejects(f.cleaner.plan({sessionId:ID}),/UNSAFE_PATH/);});
test('B and C stage only adapter-proven candidates, retaining shared files',async t=>{for(const mode of ['chat_and_outputs','full']){const f=await fixture(t);const output=path.join(f.root,'new.txt');await fs.writeFile(output,'generated');const original=f.adapter.inspect;f.adapter.inspect=async(id,o)=>{const info=await original(id,o);info.candidates.push({path:output,root:f.root,kind:'output'});info.preserved.push({path:f.other,reason:'shared'});return info;};const p=await f.cleaner.plan({sessionId:ID,mode});await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true});await assert.rejects(fs.stat(output),{code:'ENOENT'});assert.ok(await fs.stat(f.other));}});
test('blocker in deep mode prevents even conversation deletion',async t=>{const f=await fixture(t);const original=f.adapter.inspect;f.adapter.inspect=async(id,o)=>({...await original(id,o),blockers:['PROVENANCE_UNKNOWN']});const p=await f.cleaner.plan({sessionId:ID,mode:'full'});await assert.rejects(f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true}),/PROVENANCE_UNKNOWN/);assert.ok(await fs.stat(f.log));});
test('incorrect confirmation cannot consume a valid plan',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});await assert.rejects(f.cleaner.commit({planId:p.planId,confirmation:'wrong',acknowledged:true}),/PLAN_CONFIRMATION_INVALID/);assert.ok(await fs.stat(f.log));assert.ok(f.cleaner.plans.has(p.planId));});
test('permanent deletion uses the acknowledged server-owned plan without a typed word',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});const result=await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true,permanent:true});assert.equal(result.state,'PERMANENT');assert.equal(result.restorable,false);await assert.rejects(fs.stat(f.log),{code:'ENOENT'});});
test('confirmed permanent deletion cannot be restored',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});const r=await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true,permanent:true,permanentConfirmation:'DELETE'});assert.equal(r.state,'PERMANENT');assert.equal(r.restorable,false);await assert.rejects(f.cleaner.restore(r.operationId),/NOT_RESTORABLE/);});
test('restore preflights all occupied paths before moving any file',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});const r=await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true});await fs.writeFile(f.log,'new user work');await assert.rejects(f.cleaner.restore(r.operationId),/RESTORE_PATH_OCCUPIED/);assert.equal(await fs.readFile(f.log,'utf8'),'new user work');});
test('two cleaner instances share a data-root transaction lock',async t=>{const f=await fixture(t);const release=await f.cleaner.lock();try{const other=new Cleaner(f.adapter);await assert.rejects(other.lock(),/TRANSACTION_LOCKED/);}finally{await release();}});
test('a symlink candidate is refused before mutation',async t=>{const f=await fixture(t);const link=path.join(f.root,'link.txt');try{await fs.symlink(f.other,link);}catch(e){if(e.code==='EPERM'){t.skip('Windows symlink privilege unavailable');return;}throw e;}f.adapter.inspect=async()=>({session:{id:ID},ids:[ID],candidates:[{path:link,root:f.root,kind:'output'}],preserved:[],blockers:[]});await assert.rejects(f.cleaner.plan({sessionId:ID}),/UNSAFE_LINK/);assert.equal(await fs.readFile(f.other,'utf8'),'preserve me');});
test('pre-purge permanent transaction can recover after interrupted staging',async t=>{const f=await fixture(t);const op='11111111-1111-4111-8111-111111111111',dir=path.join(f.cleaner.base,'operations',op);await fs.mkdir(dir,{recursive:true});const staged=path.join(dir,'0'),s=await fs.stat(f.log),identity=[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];await fs.rename(f.log,staged);await fs.writeFile(path.join(dir,'journal.json'),JSON.stringify({operationId:op,state:'STAGING',ids:[ID],metadata:{},permanent:true,units:[{path:f.log,root:f.root,kind:'session',identity,staged,moved:false}]}));const result=await f.cleaner.restore(op);assert.equal(result.state,'RESTORED');assert.equal(await fs.readFile(f.log,'utf8'),'conversation');});
test('missing original and staged files cannot be reported restored',async t=>{const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});const r=await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true});await fs.unlink(path.join(f.cleaner.base,'operations',r.operationId,'0'));await assert.rejects(f.cleaner.restore(r.operationId),/RESTORE_FILE_MISSING/);assert.equal(f.state.indexed,false);});
test('directory junction ancestors are refused',async t=>{const f=await fixture(t);const dir=path.join(f.root,'real');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'file.txt'),'keep');const link=path.join(f.root,'junction');await fs.symlink(dir,link,'junction');f.adapter.inspect=async()=>({session:{id:ID},ids:[ID],candidates:[{path:path.join(link,'file.txt'),root:f.root,kind:'output'}],preserved:[],blockers:[]});await assert.rejects(f.cleaner.plan({sessionId:ID}),/UNSAFE_LINK/);assert.equal(await fs.readFile(path.join(dir,'file.txt'),'utf8'),'keep');});
test('hard-linked file is not treated as exclusive ownership',async t=>{const f=await fixture(t);await fs.link(f.log,path.join(f.root,'alias'));await assert.rejects(f.cleaner.plan({sessionId:ID}),/UNSAFE_FILE/);assert.ok(await fs.stat(f.log));});
test('another process holds lock and abandoned owner can be removed offline',async t=>{
 const f=await fixture(t);const module=new URL('../src/host/cleaner.js',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import {Cleaner} from ${JSON.stringify(module)}; await new Cleaner({root:process.argv[1]}).lock();console.log('locked');process.stdin.resume();process.stdin.once('data',()=>process.exit(0));`,f.root],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 await once(child.stdout,'data');await assert.rejects(f.cleaner.lock(),/TRANSACTION_LOCKED/);
 const ended=once(child,'exit');child.stdin.write('simulate crash');await ended;
 await promisify(execFile)(process.execPath,['tools/offline-unlock.mjs',f.root,'--all-hosts-stopped'],{windowsHide:true});
 const release=await f.cleaner.lock();await release();assert.ok(await fs.stat(f.log));
});
test('verified attachment hardlink group is quarantined and restored together',async t=>{
 const f=await fixture(t),a=path.join(f.root,'object'),b=path.join(f.root,'alias');await fs.writeFile(a,'attachment');await fs.link(a,b);
 const original=f.adapter.inspect;f.adapter.inspect=async(id,o)=>{const info=await original(id,o);info.candidates.push(...[a,b].map(p=>({path:p,root:f.root,kind:'attachment',expectedLinks:2})));return info;};
 const p=await f.cleaner.plan({sessionId:ID,mode:'full'});const r=await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true});
 await assert.rejects(fs.stat(a),{code:'ENOENT'});await assert.rejects(fs.stat(b),{code:'ENOENT'});await f.cleaner.restore(r.operationId);assert.equal(await fs.readFile(a,'utf8'),'attachment');assert.equal((await fs.stat(a)).ino,(await fs.stat(b)).ino);
});
test('shared upload index is pruned and restored in the same transaction',async t=>{
 const f=await fixture(t),index=path.join(f.root,'index.json');const before=Buffer.from('{"records":["target","shared"]}'),after=Buffer.from('{"records":["shared"]}');await fs.writeFile(index,before);
 const original=f.adapter.inspect;f.adapter.inspect=async(id,o)=>({...await original(id,o),indexEdits:[{path:index,root:f.root,before,after}]});
 const p=await f.cleaner.plan({sessionId:ID,mode:'full'});assert.equal(p.candidates.some(c=>c.kind==='attachment-index'),true);
 assert.equal('indexEdits' in p,false);
 const r=await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true});assert.deepEqual(await fs.readFile(index),after);await f.cleaner.restore(r.operationId);assert.deepEqual(await fs.readFile(index),before);
});
test('registry failure restores a partially rewritten upload index',async t=>{
 const f=await fixture(t),index=path.join(f.root,'index.json');const before=Buffer.from('{"old":true}'),after=Buffer.from('{"new":true}');await fs.writeFile(index,before);f.state.fail=true;
 const original=f.adapter.inspect;f.adapter.inspect=async(id,o)=>({...await original(id,o),indexEdits:[{path:index,root:f.root,before,after}]});
 f.adapter.forget=async()=>{assert.deepEqual(await fs.readFile(index),after);f.state.indexed=false;throw new Error('injected registry failure');};
 const p=await f.cleaner.plan({sessionId:ID,mode:'full'});await assert.rejects(f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true}),/injected registry failure/);assert.deepEqual(await fs.readFile(index),before);assert.ok(await fs.stat(f.log));
});

test('recovery rejects modified quarantine files and a replacement at a missing staged path',async t=>{
 for(const replaceOriginal of [false,true]){const f=await fixture(t);const p=await f.cleaner.plan({sessionId:ID});const r=await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true});const staged=path.join(f.cleaner.base,'operations',r.operationId,'0');
  if(replaceOriginal){await fs.unlink(staged);await fs.writeFile(f.log,'conversation');}else{await fs.writeFile(staged,'CONVERSATION');await fs.utimes(staged,new Date(),new Date(Date.now()+2000));}
  await assert.rejects(f.cleaner.restore(r.operationId),e=>e.code==='RESTORE_FILE_CHANGED');assert.equal(f.state.indexed,false);
 }
});

test('real cross-volume output uses same-volume quarantine and restores without copying',async t=>{
 const f=await fixture(t);const base=path.resolve('.test-data');await fs.mkdir(base,{recursive:true});const workspace=await fs.mkdtemp(path.join(base,'cross-volume-'));t.after(()=>fs.rm(workspace,{recursive:true,force:true}));
 if((await fs.stat(workspace)).dev===(await fs.stat(f.root)).dev){t.skip('Two filesystem volumes are required');return;}
 const output=path.join(workspace,'created.txt');await fs.writeFile(output,'cross-volume result');const inspect=f.adapter.inspect;f.adapter.inspect=async(id,o)=>{const info=await inspect(id,o);info.candidates.push({path:output,root:workspace,kind:'output'});return info;};
 const p=await f.cleaner.plan({sessionId:ID,mode:'chat_and_outputs'});assert.deepEqual(p.blockers,[]);assert.equal(p.candidates.find(u=>u.path===output).crossVolume,true);const r=await f.cleaner.commit({planId:p.planId,confirmation:p.confirmation,acknowledged:true});await assert.rejects(fs.stat(output),{code:'ENOENT'});
 const journal=JSON.parse(await fs.readFile(path.join(f.cleaner.base,'operations',r.operationId,'journal.json'),'utf8'));assert.equal(path.dirname(journal.units.find(u=>u.path===output).stageRoot),workspace);await f.cleaner.restore(r.operationId);assert.equal(await fs.readFile(output,'utf8'),'cross-volume result');
});
