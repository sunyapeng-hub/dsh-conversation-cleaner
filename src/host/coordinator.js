import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { Server as HttpServer } from 'node:http';
import { Server as HttpsServer } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Non-session control directory: no header/log is ever published here. Keep the
// lock file in place; unlinking a POSIX lock inode breaks mutual exclusion.
export const CONTROL_ID='dsh-conversation-cleaner-root-coordination-v1';
export const BRIDGE_VERSION='0.2.1-rc.3';
const ownership=new AsyncLocalStorage();
const problem=code=>Object.assign(new Error(code),{code,status:503});

function installedVersions(ctx) {
  const facts={};
  const bases=[ctx.get('baseDir'),process.argv[1]&&path.dirname(process.argv[1]),process.cwd(),path.dirname(fileURLToPath(import.meta.url))].filter(Boolean);
  for(const base of bases) {
    const require=createRequire(path.join(path.resolve(base),'__cleaner_resolve__.cjs'));
    for(const [key,name] of [['webServerVersion','@deepseek-ai/dsh-host-webserver'],['fileUploadVersion','@deepseek-ai/dsh-client-file-upload'],['desktopNextVersion','dsh-desktop-next']]) {
      try{facts[key]??=require(name+'/package.json').version;}catch{}
    }
    // Desktop shell is the entry package, not necessarily a node_modules child.
    for(const packageFile of ['./package.json','../package.json']) {
      try{const p=require(packageFile);if(p.name==='dsh-desktop-next')facts.desktopNextVersion??=p.version;}catch{}
    }
  }
  return facts;
}

/**
 * Cooperative root barrier for participating plugin hosts. It serializes HTTP
 * mutations, tools and Cleaner operations through the backend's kernel lease.
 * It does not claim to stop an unmodified host or external filesystem writer.
 */
export class RootCoordinator {
  constructor(ctx) {
    this.ctx=ctx;
    this.persistence=ctx.get('sessionPersistence');
    this.root=this.persistence?.root&&path.resolve(this.persistence.root);
    this.supported=false;
    this.reason='COORDINATOR_NOT_INSTALLED';
    this.shutdown=new AbortController();
    this.operations=new Set();
    this.disposed=false;
  }

  run(fn,{signal,timeoutMs=120000}={}) {
    const inherited=ownership.getStore();
    if(signal?.aborted)return Promise.reject(signal.reason);
    if(this.disposed && !(inherited?.coordinator===this && inherited.active))return Promise.reject(problem('COORDINATOR_DISPOSED'));
    const operation=this.execute(fn,signal,inherited,timeoutMs);
    this.operations.add(operation);
    operation.then(()=>this.operations.delete(operation),()=>this.operations.delete(operation));
    return operation;
  }

  async execute(fn,signal,inherited,timeoutMs) {
    let token=inherited;
    let fresh=false;
    if(token?.coordinator!==this || !token.active) {
      if(typeof this.persistence?.acquireWriteLease!=='function')throw problem('ROOT_LEASE_UNAVAILABLE');
      const cancellation=AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
      let lease;
      for(;;) {
        cancellation.throwIfAborted();
        try{lease=await this.persistence.acquireWriteLease({id:CONTROL_ID,cwd:undefined});break;}
        catch(error){
          if(error.name!=='SessionAlreadyOwnedError')throw error;
          try{await delay(25,undefined,{signal:cancellation});}catch(waitError){cancellation.throwIfAborted();throw waitError;}
        }
      }
      if(cancellation.aborted){await lease.release();cancellation.throwIfAborted();}
      token={coordinator:this,active:true,refs:0,lease};
      fresh=true;
    }
    token.refs++;
    try{return await ownership.run(token,async()=>{if(fresh)await this.beforeMutation?.();return fn();});}
    finally {
      if(--token.refs===0){token.active=false;try{await this.persistence.flush?.();}finally{await token.lease.release();}}
    }
  }

  /** Version metadata may be supplied by the host loader's resolved package catalog. */
  install(metadata=installedVersions(this.ctx)) {
    if(this.installed)return this.supported;
    const web=this.ctx.get('webServer'),server=web?.server;
    const lineage=[];for(let p=web;p;p=Object.getPrototypeOf(p))lineage.push(p.constructor?.name);
    const next=lineage.includes('NextWebServer');
    if(metadata.webServerVersion!==BRIDGE_VERSION || (next&&metadata.desktopNextVersion!=='2.0.20-next') || !lineage.includes('WebServer') ||
       !(server instanceof HttpServer || server instanceof HttpsServer) || typeof web.match!=='function' || typeof web.register!=='function' || typeof web.registerUpgrade!=='function' || server.listenerCount('request')!==1) {
      this.reason='HOST_COORDINATION_BRIDGE_UNSUPPORTED';return false;
    }
    if(typeof this.persistence?.acquireWriteLease!=='function'){this.reason='ROOT_LEASE_UNAVAILABLE';return false;}
    this.installed=true;
    this.receiptBridgeSupported=metadata.fileUploadVersion===BRIDGE_VERSION;
    this.ctx.effect(()=>{
      const original=server.rawListeners('request')[0];
      const guarded=(req,res)=>{
        let pathname;try{pathname=new URL(req.url??'/','http://localhost').pathname;}catch{return original.call(server,req,res);}
        // GET/HEAD includes long-lived read streams. Cleaner endpoints acquire
        // their own barrier around commit/restore, avoiding self-deadlock.
        if(['GET','HEAD','OPTIONS'].includes(req.method) || pathname.startsWith('/dsh-conversation-cleaner/v1/'))return original.call(server,req,res);
        const cancelled=new AbortController();
        const done=Promise.withResolvers();
        const closed=()=>{cancelled.abort();done.resolve();};
        const finished=()=>done.resolve();
        req.once('aborted',closed);res.once('close',closed);res.once('finish',finished);
        this.run(async()=>{
          // rc3's original Node listener deliberately returns void. Await the
          // version-pinned matched route itself so disconnect/early res.end()
          // cannot release ownership while its async mutation is still alive.
          // NEXT's registered handler retains its own native admission checks.
          const route=web.match(pathname);
          if(!route){res.writeHead(404);res.end();return;}
          await route.handler(req,res);
          await done.promise;
        },{signal:cancelled.signal}).catch(error=>{
          if(!res.destroyed&&!res.writableEnded){if(res.headersSent)res.destroy(error);else{res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:false,code:error.code??'COORDINATION_UNAVAILABLE'}));}}
        }).finally(()=>{req.off('aborted',closed);res.off('close',closed);res.off('finish',finished);});
      };
      server.off('request',original);server.on('request',guarded);
      this.restoreListener=()=>{server.off('request',guarded);server.prependListener('request',original);};
      this.removeTools=this.ctx.on('tools/execute',(exec,next)=>this.run(next,{signal:exec.signal}),{prepend:true});
      this.supported=true;this.reason=undefined;
      return ()=>this.dispose();
    },'conversation-cleaner root coordination');
    return this.supported;
  }

  async dispose() {
    if(this.disposal)return this.disposal;
    this.disposed=true;this.supported=false;
    this.shutdown.abort(problem('COORDINATOR_DISPOSED'));
    // HMR can unload us from a separate async context while the requesting
    // plugin-manager handler awaits HMR. Never await that handler here. Already
    // dispatched operations keep their kernel lease until their own completion;
    // the replacement coordinator waits on it, while queued work is cancelled.
    this.disposal=(async()=>{
      this.removeTools?.();this.removeTools=undefined;
      this.restoreListener?.();this.restoreListener=undefined;
    })();
    return this.disposal;
  }
}
