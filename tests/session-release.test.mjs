import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionReleaseBridge} from '../src/host/session-release.js';
function fixture(t){
 const agents=new Map(),sessions=new Map(),disposers=[],closed=[],stagedFiles=new WeakMap();
 const factory={async createAgent(owner,options){return this.resume(owner,options);},async resume(owner,{id}){const agent={id,session:{},phase:{kind:'idle'},status:'idle',inbox:{hasPending:false},owner};agents.set(id,agent);sessions.set(id,agent.session);return {agent,async dispose(){closed.push(id);agents.delete(id);sessions.delete(id);}};}};
 const original=factory.resume,services={agents:{requireFactory:()=>({target:factory}),get:id=>agents.get(id)},sessions:{get:id=>sessions.get(id)},fileUploads:{stagedFiles}};
 const ctx={get:key=>services[key],effect(fn){disposers.push(fn());},on(){return ()=>{};}};
 const bridge=new SessionReleaseBridge(ctx,{supported:true,receiptBridgeSupported:true,agentLoopVersion:'0.2.1-rc.3'});bridge.install();t.after(()=>disposers.reverse().forEach(f=>f()));
 return {bridge,factory,agents,sessions,closed,stagedFiles,disposers,original};
}
test('capture the original handle, preserve caller ownership, preview without closing, release only selected idle agent',async t=>{
 const f=fixture(t),owner={name:'host'},a=await f.factory.resume(owner,{id:'a'}),b=await f.factory.createAgent(owner,{id:'b'});
 assert.equal(a.agent.owner,owner);assert.equal(f.bridge.blocker('a'),undefined);assert.deepEqual(f.closed,[]);
 await f.bridge.release(['a']);assert.deepEqual(f.closed,['a']);assert.equal(f.agents.get('b'),b.agent);
});
test('running, maintenance, queued input and unsent uploads are never automatically closed',async t=>{
 const f=fixture(t),{agent}=await f.factory.resume({}, {id:'a'});
 for(const kind of ['running','maintenance']){agent.phase.kind=kind;assert.equal(f.bridge.blocker('a'),'SESSION_BUSY');await assert.rejects(f.bridge.release(['a']),e=>e.code==='SESSION_BUSY');}
 agent.phase.kind='idle';agent.inbox.hasPending=true;assert.equal(f.bridge.blocker('a'),'SESSION_BUSY');agent.inbox.hasPending=false;
 f.stagedFiles.set(agent.session,new Map([['draft',{}]]));assert.equal(f.bridge.blocker('a'),'SESSION_BUSY');assert.deepEqual(f.closed,[]);
});
test('uncaptured existing owner is refused and uninstall restores the original factory methods',async t=>{
 const f=fixture(t);f.agents.set('old',{id:'old'});f.sessions.set('old',{});assert.equal(f.bridge.blocker('old'),'SESSION_RELEASE_UNAVAILABLE');
 f.disposers.pop()();assert.equal(f.factory.resume,f.original);assert.equal(f.bridge.blocker('old'),'SESSION_RELEASE_UNAVAILABLE');
});
test('all selected owners are checked before closing any; failures leave ownership observable',async t=>{
 const f=fixture(t);await f.factory.resume({}, {id:'a'});const b=await f.factory.resume({}, {id:'b'});b.agent.phase.kind='running';
 await assert.rejects(f.bridge.release(['a','b']),e=>e.code==='SESSION_BUSY');assert.deepEqual(f.closed,[]);
 b.agent.phase.kind='idle';b.dispose=async()=>{throw new Error('close failed');};await assert.rejects(f.bridge.release(['b']),/close failed/);assert.ok(f.sessions.has('b'));
});
