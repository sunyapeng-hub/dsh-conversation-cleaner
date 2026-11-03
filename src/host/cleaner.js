import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class CleanerError extends Error {
  constructor(code, status = 409) { super(code); this.code=code; this.status=status; }
}
export function inside(root, file) {
  const rel=path.relative(path.resolve(root),path.resolve(file));
  return rel!=='' && !rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel);
}
export async function safeFile(root, file, expectedLinks=1) {
  if(!inside(root,file)) throw new CleanerError('UNSAFE_PATH',422);
  let cursor=path.resolve(file);
  while(true) {
    const stat=await fs.lstat(cursor);
    if(stat.isSymbolicLink()) throw new CleanerError('UNSAFE_LINK',422);
    if(cursor===path.resolve(root)) break;
    const parent=path.dirname(cursor);
    if(parent===cursor) throw new CleanerError('UNSAFE_PATH',422);
    cursor=parent;
  }
  const canonical=await fs.realpath(file), base=await fs.realpath(root);
  if(!inside(base,canonical)) throw new CleanerError('UNSAFE_PATH',422);
  const stat=await fs.lstat(file);
  if(!stat.isFile() || !Number.isSafeInteger(expectedLinks) || expectedLinks<1 || stat.nlink!==expectedLinks) throw new CleanerError('UNSAFE_FILE',422);
  return stat;
}
export async function revision(unit, maxBytes=32*1024*1024) {
  const stat=await safeFile(unit.root,unit.path,unit.expectedLinks??1);
  if(stat.size>maxBytes) throw new CleanerError('SCAN_LIMIT',422);
  const bytes=await fs.readFile(unit.path);
  const after=await fs.lstat(unit.path);
  if(stat.ino!==after.ino || stat.size!==after.size || stat.mtimeMs!==after.mtimeMs) throw new CleanerError('PLAN_CHANGED');
  return {...unit, identity:[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs],bytes};
}
function sameUnit(a,b,renamedAlias=false) {
  return a.path===b.path && a.kind===b.kind && a.expectedLinks===b.expectedLinks && JSON.stringify(renamedAlias?a.identity.slice(0,4):a.identity)===JSON.stringify(renamedAlias?b.identity.slice(0,4):b.identity) && a.bytes.equals(b.bytes) && (!a.replacement&&!b.replacement || a.replacement&&b.replacement&&a.replacement.equals(b.replacement));
}
function candidatesOf(info) {return [...info.candidates,...(info.indexEdits??[]).map(edit=>({path:edit.path,root:edit.root,kind:'attachment-index',replacement:edit.after,expectedBefore:edit.before}))];}
async function exists(file) {try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function writeJournal(file,data) {
  const temp=file+'.tmp'; const h=await fs.open(temp,'w',0o600);
  try{await h.writeFile(JSON.stringify(data,null,2));await h.sync();}finally{await h.close();}
  await fs.rename(temp,file);
}

export class Cleaner {
  constructor(adapter,{ttl=120000,maxBytes=32*1024*1024}={}) {
    this.adapter=adapter;this.ttl=ttl;this.maxBytes=maxBytes;this.plans=new Map();
    this.base=path.join(adapter.root,'.conversation-cleaner');
  }
  async plan({sessionId,mode='chat_only',includeDescendants=false}={}) {
    if(typeof sessionId!=='string' || !/^(session-)?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId)) throw new CleanerError('INVALID_SESSION',400);
    if(!['chat_only','chat_and_outputs','full'].includes(mode)) throw new CleanerError('INVALID_MODE',400);
    if(typeof includeDescendants!=='boolean') throw new CleanerError('INVALID_REQUEST',400);
    for(const [id,p] of this.plans)if(p.expiresAt<Date.now())this.plans.delete(id);
    if(this.plans.size>=20) throw new CleanerError('TOO_MANY_PLANS',429);
    const input={sessionId,mode,includeDescendants};
    const info=await this.adapter.inspect(sessionId,input);
    const units=[];let total=0;
    const rootDevice=(await fs.stat(this.adapter.root)).dev;
    for(const candidate of candidatesOf(info)) {
      if(units.some(u=>u.path===candidate.path))continue;
      const unit=await revision(candidate,this.maxBytes);total+=unit.bytes.length;
      if(candidate.expectedBefore&&!unit.bytes.equals(candidate.expectedBefore))throw new CleanerError('PLAN_CHANGED');
      unit.crossVolume=unit.identity[0]!==rootDevice;
      if(total>this.maxBytes)throw new CleanerError('SCAN_LIMIT',422);
      units.push(unit);
    }
    const plan={...info,...input,planId:randomUUID(),confirmation:randomUUID(),expiresAt:Date.now()+this.ttl,units};
    this.plans.set(plan.planId,plan);
    const {units:_,metadata,indexEdits,...publicPlan}=plan;
    return {...publicPlan,candidates:units.map(({bytes,identity,replacement,expectedBefore,...u})=>({...u,action:replacement?'update':'remove',size:bytes.length})),counts:{files:units.length,bytes:total,outputs:units.filter(x=>x.kind==='output').length,attachments:info.attachmentCount??units.filter(x=>x.kind==='attachment').length}};
  }
  async lock() {
    await fs.mkdir(this.base,{recursive:true,mode:0o700});
    if((await fs.lstat(this.base)).isSymbolicLink())throw new CleanerError('UNSAFE_LINK');
    const lock=path.join(this.base,'transaction.lock');
    try{await fs.mkdir(lock);}catch(e){if(e.code==='EEXIST')throw new CleanerError('TRANSACTION_LOCKED');throw e;}
    await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
    return async()=>{await fs.unlink(path.join(lock,'owner.json'));await fs.rmdir(lock);};
  }
  async pending() {
    const dir=path.join(this.base,'operations');
    let names;try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const pending=[];
    for(const name of names) {
      if(!/^[a-f0-9-]{36}$/.test(name))continue;
      const journal=JSON.parse(await fs.readFile(path.join(dir,name,'journal.json'),'utf8'));
      if(!['VERIFIED','RESTORED','PERMANENT'].includes(journal.state))pending.push(name);
    }
    return pending;
  }
  commit(input={}) {return this.adapter.coordinator?this.adapter.coordinator.run(()=>this.executeCommit(input)):this.executeCommit(input);}
  async executeCommit({planId,confirmation,acknowledged,permanent=false}={}) {
    if(acknowledged!==true)throw new CleanerError('ACK_REQUIRED',400);
    if(typeof permanent!=='boolean')throw new CleanerError('INVALID_REQUEST',400);
    const plan=this.plans.get(planId);
    if(!plan)throw new CleanerError('PLAN_MISSING');
    if(plan.expiresAt<Date.now())throw new CleanerError('PLAN_EXPIRED');
    if(confirmation!==plan.confirmation)throw new CleanerError('PLAN_CONFIRMATION_INVALID',403);
    if(plan.blockers.length)throw new CleanerError(plan.blockers.join('; '),422);
    const unlock=await this.lock();let release,closingTargets=false;
    try {
      if((await this.pending()).length)throw new CleanerError('RECOVERY_REQUIRED');
      closingTargets=typeof this.adapter.releaseTargets==='function';
      await this.adapter.releaseTargets?.(plan.ids);
      release=await this.adapter.acquire(plan.ids,plan);
      const fresh=await this.adapter.inspect(plan.sessionId,{...plan,locked:true});
      if(fresh.blockers.length)throw new CleanerError(fresh.blockers.join('; '),422);
      const current=[];
      for(const candidate of candidatesOf(fresh))if(!current.some(u=>u.path===candidate.path))current.push(await revision(candidate,this.maxBytes));
      if(JSON.stringify(fresh.ids)!==JSON.stringify(plan.ids) || JSON.stringify(fresh.metadata)!==JSON.stringify(plan.metadata) || current.length!==plan.units.length || current.some((u,i)=>!sameUnit(u,plan.units[i])))throw new CleanerError('PLAN_CHANGED');
      this.plans.delete(planId);
      const operationId=randomUUID(), dir=path.join(this.base,'operations',operationId);
      await fs.mkdir(dir,{recursive:true,mode:0o700});
      const journalFile=path.join(dir,'journal.json');
      const journal={operationId,state:'STAGING',createdAt:new Date().toISOString(),ids:plan.ids,mode:plan.mode,metadata:plan.metadata,units:plan.units.map((u,i)=>{const stageRoot=u.crossVolume?path.join(path.dirname(u.path),'.dsh-conversation-cleaner-quarantine'):this.base;return {path:u.path,root:u.root,kind:u.kind,expectedLinks:u.expectedLinks,identity:u.identity,replacement:u.replacement?.toString('base64'),stageRoot,staged:u.crossVolume?path.join(stageRoot,operationId,String(i)):path.join(dir,String(i)),moved:false};}),permanent};
      await writeJournal(journalFile,journal);
      try {
        for(let i=0;i<journal.units.length;i++) {
          const unit=journal.units[i];
          const revalidated=await revision({...unit,replacement:plan.units[i].replacement},this.maxBytes);
          const renamedAlias=journal.units.slice(0,i).some(prior=>prior.moved&&prior.identity?.[0]===unit.identity?.[0]&&prior.identity?.[1]===unit.identity?.[1]);
          if(!sameUnit(revalidated,plan.units[i],renamedAlias))throw new CleanerError('PLAN_CHANGED');
          if(plan.units[i].crossVolume){await fs.mkdir(path.dirname(unit.staged),{recursive:true,mode:0o700});for(const d of [unit.stageRoot,path.dirname(unit.staged)])if((await fs.lstat(d)).isSymbolicLink())throw new CleanerError('UNSAFE_LINK');}
          // Write intent first: recovery also checks the staged path if a crash happens before moved=true.
          await fs.rename(unit.path,unit.staged);unit.moved=true;
          await writeJournal(journalFile,journal);
          if(unit.replacement!==undefined){const h=await fs.open(unit.path,'wx',0o600);try{await h.writeFile(Buffer.from(unit.replacement,'base64'));await h.sync();}finally{await h.close();}}
        }
        journal.state='STAGED';await writeJournal(journalFile,journal);
        await this.adapter.forget(plan.ids,plan.metadata);
        journal.state='REGISTRY_UPDATED';await writeJournal(journalFile,journal);
        for(const unit of journal.units){if(unit.replacement!==undefined){if(!(await fs.readFile(unit.path)).equals(Buffer.from(unit.replacement,'base64')))throw new CleanerError('VERIFY_FAILED');}else if(await exists(unit.path))throw new CleanerError('VERIFY_FAILED');}
        await this.adapter.verify(plan.ids);
        journal.state='VERIFIED';await writeJournal(journalFile,journal);
      }catch(error) {
        journal.state='ROLLING_BACK';await writeJournal(journalFile,journal);
        try{await this.restoreFiles(journal);await this.adapter.refreshProvenance?.(journal);await this.adapter.restore(plan.ids,plan.metadata);journal.state='RESTORED';await writeJournal(journalFile,journal);}catch(rollback){journal.state='RECOVERY_REQUIRED';journal.error=rollback.message;await writeJournal(journalFile,journal);throw new CleanerError('RECOVERY_REQUIRED: '+operationId,500);}
        throw error;
      }
      if(permanent) {
        journal.state='PURGING';await writeJournal(journalFile,journal);
        for(const unit of journal.units)await fs.unlink(unit.staged);
        journal.state='PERMANENT';await writeJournal(journalFile,journal);
      }
      let refreshWarning;
      try{await this.adapter.broadcast(plan.ids);}catch(e){refreshWarning=e.message;}
      return {operationId,state:journal.state,removed:journal.units.filter(u=>u.replacement===undefined).length,modified:journal.units.filter(u=>u.replacement!==undefined).length,restorable:!permanent,journal:journalFile,refreshWarning};
    }catch(error){
      // Closing emits the host's removed notification. If deletion is refused,
      // republish only rows that still exist; never leave retained data hidden.
      if(closingTargets)try{await this.adapter.broadcast(plan.ids,{restored:true});}catch{}
      throw error;
    }finally{try{await release?.();}finally{await unlock();}}
  }
  async restoreFiles(journal) {
    const validate=async(unit,root,file)=>{
      const stat=await safeFile(root,file,unit.expectedLinks??1);
      if(!Array.isArray(unit.identity)||unit.identity.length!==5||JSON.stringify([stat.dev,stat.ino,stat.size,stat.mtimeMs])!==JSON.stringify(unit.identity.slice(0,4)))throw new CleanerError('RESTORE_FILE_CHANGED');
    };
    for(const unit of journal.units) {
      if(!await exists(unit.staged)){if(!await exists(unit.path))throw new CleanerError('RESTORE_FILE_MISSING');await validate(unit,unit.root,unit.path);continue;}
      if(await exists(unit.path)){
        if(unit.replacement===undefined)throw new CleanerError('RESTORE_PATH_OCCUPIED');
        await safeFile(unit.root,unit.path);
        if(!(await fs.readFile(unit.path)).equals(Buffer.from(unit.replacement,'base64')))throw new CleanerError('RESTORE_PATH_OCCUPIED');
      }
      await validate(unit,unit.stageRoot??this.base,unit.staged);
      // Check every ancestor before rename; recovery never overwrites user work.
      let cursor=path.dirname(unit.path);
      while(true){const s=await fs.lstat(cursor);if(s.isSymbolicLink()||!s.isDirectory())throw new CleanerError('UNSAFE_LINK');if(cursor===path.resolve(unit.root))break;const parent=path.dirname(cursor);if(parent===cursor)throw new CleanerError('UNSAFE_PATH');cursor=parent;}
      const parent=await fs.realpath(path.dirname(unit.path));
      const base=await fs.realpath(unit.root);
      if(parent!==base && !inside(base,parent))throw new CleanerError('UNSAFE_PATH');
    }
    for(const unit of [...journal.units].reverse())if(await exists(unit.staged)){if(unit.replacement!==undefined&&await exists(unit.path))await fs.unlink(unit.path);await fs.rename(unit.staged,unit.path);}
    for(const unit of journal.units)await validate(unit,unit.root,unit.path);
  }
  restore(operationId) {return this.adapter.coordinator?this.adapter.coordinator.run(()=>this.executeRestore(operationId)):this.executeRestore(operationId);}
  async executeRestore(operationId) {
    if(typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId))throw new CleanerError('INVALID_OPERATION',400);
    const unlock=await this.lock();let release;
    try {
      const journalFile=path.join(this.base,'operations',operationId,'journal.json');
      const journal=JSON.parse(await fs.readFile(journalFile,'utf8'));
      if(['PURGING','PERMANENT'].includes(journal.state))throw new CleanerError('NOT_RESTORABLE');
      if(journal.state==='RESTORED')throw new CleanerError('ALREADY_RESTORED');
      release=await this.adapter.acquire(journal.ids,{restore:true,metadata:journal.metadata});
      await this.restoreFiles(journal);await this.adapter.refreshProvenance?.(journal);await this.adapter.restore(journal.ids,journal.metadata);
      journal.state='RESTORED';await writeJournal(journalFile,journal);
      await this.adapter.broadcast(journal.ids,{restored:true});return {operationId,state:'RESTORED'};
    }finally{try{await release?.();}finally{await unlock();}}
  }
}
