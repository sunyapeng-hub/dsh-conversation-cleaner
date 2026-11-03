import {CleanerError} from './cleaner.js';

// rc3 has no close RPC. Retain its original AgentHandle instead of detaching
// stores or deleting lock files. The factory still receives the original owner.
export class SessionReleaseBridge {
  constructor(ctx,coordinator){this.ctx=ctx;this.coordinator=coordinator;this.handles=new Map();}
  install(){
    if(!this.coordinator?.supported||this.coordinator.agentLoopVersion!=='0.2.1-rc.3')return;
    const factory=this.ctx.get('agents')?.requireFactory?.().target;
    if(!factory||typeof factory.createAgent!=='function'||typeof factory.resume!=='function')return;
    const bridge=this;
    this.ctx.effect(()=>{
      const undo=[];
      for(const key of ['createAgent','resume']){
        const own=Object.getOwnPropertyDescriptor(factory,key),original=factory[key];
        const wrapped=async function(...args){const handle=await Reflect.apply(original,this,args);if(bridge.active)bridge.handles.set(handle.agent.id,handle);return handle;};
        factory[key]=wrapped;
        undo.push(()=>{if(factory[key]===wrapped){if(own)Object.defineProperty(factory,key,own);else delete factory[key];}});
      }
      this.active=true;
      const off=this.ctx.on('agent/disposed',({agent})=>{if(this.handles.get(agent.id)?.agent===agent)this.handles.delete(agent.id);});
      return ()=>{this.active=false;undo.reverse().forEach(fn=>fn());off();this.handles.clear();};
    });
  }
  blocker(id){
    const session=this.ctx.get('sessions')?.get(id);if(!session)return;
    const agent=this.ctx.get('agents')?.get(id),handle=this.handles.get(id);
    if(!this.active||!handle||handle.agent!==agent||agent.session!==session)return 'SESSION_RELEASE_UNAVAILABLE';
    // Public status also says idle during maintenance; rc3's phase disambiguates it.
    if(agent.phase?.kind!=='idle'||agent.inbox?.hasPending!==false)return 'SESSION_BUSY';
    const uploads=this.ctx.get('fileUploads');
    if(uploads&&(!this.coordinator.receiptBridgeSupported||!(uploads.stagedFiles instanceof WeakMap)||uploads.stagedFiles.get(session)?.size))return 'SESSION_BUSY';
  }
  async release(ids){
    for(const id of ids){const code=this.blocker(id);if(code)throw new CleanerError(code,422);}
    for(const id of ids){
      if(!this.ctx.get('sessions')?.get(id))continue;
      const code=this.blocker(id);if(code)throw new CleanerError(code,422);
      await this.handles.get(id).dispose();
      if(this.ctx.get('sessions')?.get(id))throw new CleanerError('SESSION_BUSY',422);
      this.handles.delete(id);
    }
  }
}
