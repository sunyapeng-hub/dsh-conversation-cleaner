import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RootCoordinator, CONTROL_ID } from '../src/host/coordinator.js';

const installed=path.resolve('research/installed-next');
const moduleUrl=name=>pathToFileURL(path.join(installed,'node_modules',name,'lib/index.js')).href;
const {Context}=await import(moduleUrl('@deepseek-ai/cordis'));
const persistence=await import(moduleUrl('@deepseek-ai/dsh-session-persistence-jsonl'));
const {WebServer}=await import(moduleUrl('@deepseek-ai/dsh-host-webserver'));
const metadata={webServerVersion:'0.2.1-rc.3'};
async function fixture(t,{web=false}={}) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cleaner-coordination-'));
 const ctx=new Context();
 await ctx.plugin(persistence,{root,compression:'none'});
 if(web)await ctx.plugin(WebServer,{host:'127.0.0.1',port:0,compression:'none'});
 const coordinator=new RootCoordinator(ctx);
 t.after(async()=>{await coordinator.dispose();await ctx.fiber.dispose();await fs.rm(root,{recursive:true,force:true});});
 return {root,ctx,coordinator};
}

test('native root ownership serializes competitors and nested calls keep one lease',async t=>{
 const {ctx,coordinator}=await fixture(t);const other=new RootCoordinator(ctx);
 t.after(()=>other.dispose());const entered=Promise.withResolvers(),release=Promise.withResolvers();
 const first=coordinator.run(async()=>{entered.resolve();await coordinator.run(()=>release.promise);});
 await entered.promise;
 assert.deepEqual(await ctx.sessionPersistence.list({}),[],'control lease is not a conversation');
 const controlDir=path.dirname(ctx.sessionPersistence.locate({id:CONTROL_ID}).path);
 assert.deepEqual(await fs.readdir(controlDir),process.platform==='win32'?[]:['session.lock']);
 let secondEntered=false;const second=other.run(()=>{secondEntered=true;});
 await delay(80);assert.equal(secondEntered,false);
 release.resolve();await first;await second;assert.equal(secondEntered,true);
});

test('real child process blocks on the same native root lock and can enter after release',async t=>{
 const {root,coordinator}=await fixture(t);const entered=Promise.withResolvers(),release=Promise.withResolvers();
 const held=coordinator.run(async()=>{entered.resolve();await release.promise;});await entered.promise;
 const script=`import {Context} from ${JSON.stringify(moduleUrl('@deepseek-ai/cordis'))};import * as p from ${JSON.stringify(moduleUrl('@deepseek-ai/dsh-session-persistence-jsonl'))};import {RootCoordinator} from ${JSON.stringify(pathToFileURL(path.resolve('src/host/coordinator.js')).href)};const c=new Context();await c.plugin(p,{root:${JSON.stringify(root)},compression:'none'});console.log('ready');const x=new RootCoordinator(c);await x.run(()=>console.log('entered'));await x.dispose();await c.fiber.dispose();`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill();});let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);
 const done=once(child,'exit');
 for(let n=0;n<100&&!output.includes('ready');n++)await delay(20);
 assert.ok(output.includes('ready'),errors);await delay(80);assert.equal(output.includes('entered'),false);
 release.resolve();await held;const [code]=await done;assert.equal(code,0,errors);assert.ok(output.includes('entered'));
});

test('HTTP mutations wait, GET and cleaner routes bypass, tool ownership outlives response, unload restores listener',async t=>{
 const {ctx,coordinator}=await fixture(t,{web:true});const server=ctx.webServer.server,original=server.listeners('request')[0];
 const toolEntered=Promise.withResolvers(),toolRelease=Promise.withResolvers();let tool;
 ctx.webServer.register({kind:'prefix',path:'/test',handler(req,res){
   if(req.url==='/test/tool')tool=ctx.waterfall('tools/execute',{},async()=>{toolEntered.resolve();await toolRelease.promise;});
   res.end('ok');
 }});
 ctx.webServer.register({kind:'exact',path:'/dsh-conversation-cleaner/v1/plan',handler(req,res){res.end('cleaner');}});
 coordinator.install(metadata);assert.equal(coordinator.supported,true);
 const origin=ctx.webServer.getOrigin();
 const entered=Promise.withResolvers(),release=Promise.withResolvers();const held=coordinator.run(async()=>{entered.resolve();await release.promise;});await entered.promise;
 let mutated=false;const mutation=fetch(origin+'/test',{method:'POST'}).then(r=>r.text()).then(()=>mutated=true);
 assert.equal(await (await fetch(origin+'/test')).text(),'ok');
 assert.equal(await (await fetch(origin+'/dsh-conversation-cleaner/v1/plan',{method:'POST'})).text(),'cleaner');
 await delay(60);assert.equal(mutated,false);release.resolve();await held;await mutation;
 await (await fetch(origin+'/test/tool',{method:'POST'})).text();await toolEntered.promise;
 let cleanupEntered=false;const cleanup=coordinator.run(()=>{cleanupEntered=true;});await delay(60);assert.equal(cleanupEntered,false);
 toolRelease.resolve();await tool;await cleanup;
 await coordinator.dispose();assert.equal(server.listeners('request')[0],original);
});

test('waiting cancellation and unload release no live lease and reject undispatched work',async t=>{
 const {ctx,coordinator}=await fixture(t);const other=new RootCoordinator(ctx);t.after(()=>other.dispose());
 const entered=Promise.withResolvers(),release=Promise.withResolvers();const held=coordinator.run(async()=>{entered.resolve();await release.promise;});await entered.promise;
 const controller=new AbortController();let dispatched=false;
 const waiting=other.run(()=>{dispatched=true;},{signal:controller.signal});controller.abort();
 await assert.rejects(waiting,{name:'AbortError'});assert.equal(dispatched,false);
 const unloading=coordinator.dispose();release.resolve();await held;await unloading;
 await other.run(()=>{dispatched=true;});assert.equal(dispatched,true);
 await assert.rejects(coordinator.run(()=>{}),{code:'COORDINATOR_DISPOSED'});
});

test('early HTTP finish or client disconnect cannot release an asynchronous mutation handler',async t=>{
 const {ctx,coordinator}=await fixture(t,{web:true});let enter,finish;
 ctx.webServer.register({kind:'exact',path:'/slow',async handler(req,res){enter.resolve();if(req.headers['x-finish']==='yes')res.end('accepted');await finish.promise;if(!res.destroyed&&!res.writableEnded)res.end('done');}});
 coordinator.install(metadata);const origin=ctx.webServer.getOrigin();
 for(const earlyFinish of [true,false]){
  enter=Promise.withResolvers();finish=Promise.withResolvers();let cleanup=false;
  const req=request(origin+'/slow',{method:'POST',headers:earlyFinish?{'x-finish':'yes'}:{}},res=>res.resume());req.on('error',()=>{});req.end();await enter.promise;
  if(!earlyFinish)req.destroy();await delay(30);const next=coordinator.run(()=>{cleanup=true;});await delay(50);assert.equal(cleanup,false);
  finish.resolve();await next;assert.equal(cleanup,true);req.destroy();
 }
});

test('plugin-manager HTTP request can await its own coordinator unload without deadlock',async t=>{
 const {ctx,coordinator}=await fixture(t,{web:true});const original=ctx.webServer.server.listeners('request')[0];ctx.webServer.register({kind:'exact',path:'/disable',async handler(req,res){await coordinator.dispose();res.end('disabled');}});coordinator.install(metadata);
 const response=await fetch(ctx.webServer.getOrigin()+'/disable',{method:'POST',signal:AbortSignal.timeout(3000)});assert.equal(await response.text(),'disabled');assert.equal(ctx.webServer.server.listeners('request')[0],original);
});

test('HMR unload from another async context does not deadlock the request awaiting it',async t=>{
 const {ctx,coordinator}=await fixture(t,{web:true});const entered=Promise.withResolvers(),unloaded=Promise.withResolvers(),finish=Promise.withResolvers();ctx.webServer.register({kind:'exact',path:'/hmr',async handler(req,res){entered.resolve();await unloaded.promise;await finish.promise;res.end('updated');}});coordinator.install(metadata);
 const response=fetch(ctx.webServer.getOrigin()+'/hmr',{method:'POST',signal:AbortSignal.timeout(3000)});await entered.promise;await coordinator.dispose();unloaded.resolve();
 const other=new RootCoordinator(ctx);t.after(()=>other.dispose());let acquired=false;const waiting=other.run(()=>{acquired=true;});await delay(60);assert.equal(acquired,false);finish.resolve();assert.equal(await (await response).text(),'updated');await waiting;assert.equal(acquired,true);
});

test('unsupported bridge leaves host listener intact and NEXT subclass uses the pinned upstream bridge',async t=>{
 const {ctx,coordinator}=await fixture(t,{web:true});const original=ctx.webServer.server.listeners('request')[0];
 assert.equal(coordinator.install({webServerVersion:'future'}),false);
 assert.equal(ctx.webServer.server.listeners('request')[0],original);
 const {default:NextWebServer}=await import(pathToFileURL(path.join(installed,'lib/webserver.js')).href);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cleaner-next-bridge-'));const next=new Context();
 await next.plugin(persistence,{root,compression:'none'});await next.plugin(NextWebServer,{host:'127.0.0.1',port:0,compression:'none'});
 const bridge=new RootCoordinator(next);
 t.after(async()=>{await bridge.dispose();await next.fiber.dispose();await fs.rm(root,{recursive:true,force:true});});
 assert.equal(bridge.install({...metadata,desktopNextVersion:'future'}),false);
 assert.equal(bridge.install({...metadata,desktopNextVersion:'2.0.20-next'}),true);
});

test('a detached async continuation reacquires ownership after its original scope has ended',async t=>{
 const {ctx,coordinator}=await fixture(t);const other=new RootCoordinator(ctx);t.after(()=>other.dispose());
 const continueDetached=Promise.withResolvers(),detachedDone=Promise.withResolvers();let dispatched=false;
 await coordinator.run(()=>{continueDetached.promise.then(()=>coordinator.run(()=>{dispatched=true;})).then(detachedDone.resolve,detachedDone.reject);});
 const entered=Promise.withResolvers(),release=Promise.withResolvers();const held=other.run(async()=>{entered.resolve();await release.promise;});await entered.promise;
 continueDetached.resolve();await delay(60);assert.equal(dispatched,false);
 release.resolve();await held;await detachedDone.promise;assert.equal(dispatched,true);
});

test('fresh ownership validates once before dispatch, and failed validation releases the native lease',async t=>{
 const {ctx,coordinator}=await fixture(t);let validations=0,dispatched=false;
 coordinator.beforeMutation=async()=>{validations++;throw Object.assign(new Error('stale registry'),{code:'REGISTRY_STALE'});};
 await assert.rejects(coordinator.run(()=>{dispatched=true;}),{code:'REGISTRY_STALE'});
 assert.equal(dispatched,false);assert.equal(validations,1);
 const other=new RootCoordinator(ctx);t.after(()=>other.dispose());
 await other.run(()=>{dispatched=true;});assert.equal(dispatched,true);
 coordinator.beforeMutation=async()=>{validations++;};
 await coordinator.run(async()=>{assert.equal(validations,2);await coordinator.run(()=>assert.equal(validations,2));});
 assert.equal(validations,2);
});

test('acquisition times out without dispatching and does not release another operation lease',async t=>{
 const {ctx,coordinator}=await fixture(t);const other=new RootCoordinator(ctx);t.after(()=>other.dispose());
 const entered=Promise.withResolvers(),release=Promise.withResolvers();const held=coordinator.run(async()=>{entered.resolve();await release.promise;});await entered.promise;
 let dispatched=false;
 try{
   await assert.rejects(other.run(()=>{dispatched=true;},{timeoutMs:45}),{name:'TimeoutError'});
   assert.equal(dispatched,false);
   await assert.rejects(other.run(()=>{dispatched=true;},{timeoutMs:30}),{name:'TimeoutError'});
 }finally{release.resolve();await held;}
 await other.run(()=>{dispatched=true;});assert.equal(dispatched,true);
});
