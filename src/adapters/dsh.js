import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CleanerError, inside, safeFile } from '../host/cleaner.js';
import { planAttachments } from '../host/attachments.js';
const run=promisify(execFile);
const bare=id=>id.replace(/^session-/, '');
const matches=(a,b)=>bare(a)===bare(b);
export function descendants(headers,id) {
  const found=[],seen=new Set([id]);let parents=[id];
  while(parents.length){const next=[];for(const h of headers)if(h.origin==='subagent' && parents.some(p=>matches(p,h.parentSession??'')) && !seen.has(h.id)){found.push(h);seen.add(h.id);next.push(h.id);}parents=next;}
  return found;
}
async function optionalJson(file) {try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}}
export function fileIdentity(s) {return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];}
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const comparable=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
function completeProof(events,proof) {
  const calls=events.filter(e=>e.type==='tool/call');
  if(events.some(e=>e.type.startsWith('tool/ptc-')))return false;
  if(!calls.length)return true;
  return proof?.complete===true && proof.unknown===false && Array.isArray(proof.outputs) && Array.isArray(proof.references) && Array.isArray(proof.seenCallIds) &&
    calls.every(e=>['read','write','edit'].includes(e.data?.name)&&typeof e.data.callId==='string'&&proof.seenCallIds.includes(e.data.callId));
}
function referencesOutput(row,file) {
  const wanted=comparable(file),needles=[file,file.replaceAll('\\','/'),file.replaceAll('/','\\')].map(s=>process.platform==='win32'?s.toLowerCase():s);
  const pending=[row.events,row.proof?.references??[]];
  while(pending.length) {
    const node=pending.pop();
    if(typeof node==='string') {
      const text=process.platform==='win32'?node.toLowerCase():node;
      if(needles.some(needle=>text.includes(needle)))return true;
      if(row.header.cwd&&comparable(row.header.cwd)===comparable(path.dirname(file))&&text.includes(process.platform==='win32'?path.basename(file).toLowerCase():path.basename(file)))return true;
      try{if(comparable(path.resolve(row.header.cwd??'',node))===wanted)return true;}catch{}
      if(node.startsWith('{')||node.startsWith('[')){try{pending.push(JSON.parse(node));}catch{}}
      for(const token of node.split(/[\s"'<>]+/))if(token&&(token.includes('/')||token.includes('\\'))) {
        try{if(comparable(path.resolve(row.header.cwd??'',token))===wanted)return true;}catch{}
      }
    }else if(node&&typeof node==='object')pending.push(...Object.values(node));
  }
  return false;
}
async function leaves(dir,root) {
  const result=[];
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    if(entry.name==='session.lock')continue;
    const file=path.join(dir,entry.name);
    if(entry.isSymbolicLink())throw new CleanerError('UNSAFE_LINK',422);
    if(entry.isDirectory())result.push(...await leaves(file,root));
    else {await safeFile(root,file);result.push({path:file,root,kind:'session'});}
    if(result.length>2000)throw new CleanerError('SCAN_LIMIT',422);
  }
  return result;
}
export class DshAdapter {
  constructor(ctx,{exclusiveDataRoot=false,coordinator}={}) {
    this.ctx=ctx;this.persistence=ctx.get('sessionPersistence');this.registry=ctx.get('workspaceRegistry');
    if(!this.persistence?.root || !this.persistence.locate || !this.persistence.open || !this.registry)throw new CleanerError('HOST_CAPABILITY_MISSING',422);
    this.root=path.dirname(path.resolve(this.persistence.root));
    this.exclusiveDataRoot=exclusiveDataRoot;
    this.coordinator=coordinator;
  }
  async checkRegistry() {
    const backend=this.ctx.get('storage')?.backend?.get('json');
    const domain=this.ctx.get('storageDomain')?.get('workspace');
    if(!backend?.root || !domain?.global?.get || !domain?.table)throw new CleanerError('REGISTRY_BACKEND_UNSUPPORTED',422);
    const disk=await optionalJson(path.join(backend.root,'workspace.json'));
    const current={global:domain.global.get(),tables:{workspaces:Object.fromEntries(domain.table('workspaces').entries())}};
    if(!disk || disk.unit?.name!=='workspace' || disk.unit.version!==2 || stable({global:disk.global,tables:disk.tables})!==stable(current))throw new CleanerError('REGISTRY_EXTERNAL_CHANGE_RESTART_REQUIRED');
  }
  async corpus() {
    const all=await this.persistence.list({});
    if(all.length>5000)throw new CleanerError('SCAN_LIMIT',422);
    return all.sort((a,b)=>a.header.id.localeCompare(b.header.id));
  }
  async assertCorpusComplete(all) {
    // rc3 list() omits generations with unreadable/unsupported headers. Deep
    // cleanup must account for those physical logs before assuming zero refs.
    const known=new Set(all.map(row=>comparable(path.dirname(this.persistence.locate(row.header).path))));let visited=0;
    let projects;try{projects=await fs.readdir(this.persistence.root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const project of projects){if(project.isSymbolicLink())throw new CleanerError('UNSAFE_LINK',422);if(!project.isDirectory())continue;
      const group=path.join(this.persistence.root,project.name);
      for(const entry of await fs.readdir(group,{withFileTypes:true})){if(++visited>10000)throw new CleanerError('SCAN_LIMIT',422);if(entry.isSymbolicLink())throw new CleanerError('UNSAFE_LINK',422);if(!entry.isDirectory())continue;
        const dir=path.join(group,entry.name),files=await fs.readdir(dir);
        if(files.some(name=>/\.jsonl(?:\.zstd)?$/.test(name))&&!known.has(comparable(dir)))throw new CleanerError('CORPUS_REFERENCE_UNREADABLE',422);
      }
    }
  }
  async quarantinedReferences() {
    const dir=path.join(this.root,'.conversation-cleaner','operations'),rows=[];
    let entries;try{entries=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return rows;throw e;}
    for(const entry of entries){if(!/^[a-f0-9-]{36}$/.test(entry))continue;
      const journal=await optionalJson(path.join(dir,entry,'journal.json'));if(!journal)throw new CleanerError('QUARANTINE_REFERENCE_UNKNOWN');
      if(['RESTORED','PERMANENT','PURGING'].includes(journal.state))continue;
      if(!Array.isArray(journal.metadata?.recoveryReferences))throw new CleanerError('QUARANTINE_REFERENCE_UNKNOWN');
      rows.push(...journal.metadata.recoveryReferences.map(r=>({header:{id:'quarantine:'+entry+':'+r.id,cwd:r.cwd},events:[],proof:{references:r.references}})));
    }
    return rows;
  }
  stagedReferences() {
    const uploads=this.ctx.get('fileUploads');if(!uploads)return [];
    // Read-only compatibility bridge for rc3, whose public resolve() requires
    // the receipt ID. No receipt is consumed, altered, or invented here.
    if(!this.coordinator?.receiptBridgeSupported||!(uploads.stagedFiles instanceof WeakMap))throw new CleanerError('STAGED_UPLOADS_UNSUPPORTED',422);
    const agents=this.ctx.get('agents')?.list();if(!agents)throw new CleanerError('STAGED_UPLOADS_UNSUPPORTED',422);
    return agents.map(agent=>{const staged=uploads.stagedFiles.get(agent.session),events=staged?[...staged.values()].map(row=>row.file):[];if(events.some(ref=>typeof ref?.attachmentId!=='string'))throw new CleanerError('STAGED_UPLOADS_UNSUPPORTED',422);return {header:{id:'staged:'+agent.id},events};});
  }
  async events(id) {
    const h=await this.persistence.open(id,'read');
    try {const {events}=await h.read(0,100001);if(events.length>100000||Buffer.byteLength(JSON.stringify(events))>32*1024*1024)throw new CleanerError('SCAN_LIMIT',422);return events;}finally{await h.close();}
  }
  recordPath(id) {return path.join(this.root,'.conversation-cleaner','provenance',id+'.json');}
  metadata(ids) {
    const workspace=this.registry.list().map(w=>({id:w.id,sessionIds:w.sessionIds.filter(id=>ids.includes(id))})).filter(w=>w.sessionIds.length);
    const domains=[];
    const domain=this.ctx.get('storageDomain')?.get('session_projcache');
    if(domain){const table=domain.table('sessions');for(const id of ids){const value=table.get(id);if(value!==undefined)domains.push({domain:'session_projcache',table:'sessions',id,value});}}
    return {workspace,archived:ids.filter(id=>this.registry.archivedSessionIds.includes(id)),pinned:ids.filter(id=>this.registry.pinnedSessionIds.includes(id)),domains};
  }
  async inspect(sessionId,{mode='chat_only',includeDescendants=false,locked=false}={}) {
    const snapshot=await this.persistence.stat(sessionId);
    if(!snapshot)throw new CleanerError('SESSION_NOT_FOUND',404);
    const all=await this.corpus();
    const headers=all.map(s=>s.header),children=descendants(headers,sessionId);
    const ids=[snapshot.header.id,...(includeDescendants?children.map(h=>h.id):[])];
    const candidates=[],preserved=[],blockers=[],rows=[];
    const coordinated=this.coordinator?.supported===true;
    if(!coordinated&&!this.exclusiveDataRoot)blockers.push('DATA_ROOT_EXCLUSIVITY_REQUIRED');
    if(coordinated){try{await this.checkRegistry();}catch(e){blockers.push(e.code??'REGISTRY_BACKEND_UNSUPPORTED');}}
    if(mode!=='chat_only') {
      if(!coordinated)blockers.push('ROOT_COORDINATION_REQUIRED');
      await this.assertCorpusComplete(all);
      let decodedBytes=0;
      for(const row of all) {
        const events=await this.events(row.header.id),proof=await optionalJson(this.recordPath(row.header.id));
        decodedBytes+=Buffer.byteLength(JSON.stringify(events));if(decodedBytes>32*1024*1024)throw new CleanerError('SCAN_LIMIT',422);
        rows.push({...row,events,proof});
        if(!completeProof(events,proof))blockers.push(ids.includes(row.header.id)?'PROVENANCE_UNKNOWN':'OTHER_SESSION_PROVENANCE_UNKNOWN');
      }
    }else{
      for(const row of all.filter(r=>ids.includes(r.header.id)))rows.push({...row,events:await this.events(row.header.id)});
    }
    const recoveryRows=mode==='chat_only'?[]:await this.quarantinedReferences();
    const survivors=rows.filter(r=>!ids.includes(r.header.id)).concat(recoveryRows);
    for(const id of ids) {
      if(this.ctx.get('sessions')?.get(id) || (!locked && this.persistence.hasPendingSession?.(id)))blockers.push('SESSION_BUSY');
      const stored=all.find(s=>s.header.id===id) ?? await this.persistence.stat(id);
      const location=this.persistence.locate(stored.header);
      if(!location?.path || !inside(this.persistence.root,location.path))throw new CleanerError('HOST_LOCATION_UNSAFE',422);
      candidates.push(...await leaves(path.dirname(location.path),this.persistence.root));
      if(mode!=='chat_only') {
        const row=rows.find(r=>r.header.id===id),proof=row.proof;
        if(completeProof(row.events,proof)) {
          for(const out of proof?.outputs??[]) {
            try{
              const stat=await safeFile(stored.header.cwd,out.path);
              if(JSON.stringify(fileIdentity(stat))!==JSON.stringify(out.identity)){preserved.push({path:out.path,reason:'CHANGED_OUTPUT'});blockers.push('OUTPUT_CHANGED');continue;}
              let tracked=false;
              try{await run('git',['-C',stored.header.cwd,'ls-files','--error-unmatch','--',path.relative(stored.header.cwd,out.path)],{windowsHide:true});tracked=true;}catch(e){if(![1,128].includes(e.code))throw e;}
              if(tracked){preserved.push({path:out.path,reason:'GIT_TRACKED'});continue;}
              const shared=survivors.some(other=>referencesOutput(other,out.path));
              if(shared)preserved.push({path:out.path,reason:'SHARED_OUTPUT'});
              else candidates.push({path:out.path,root:stored.header.cwd,kind:'output'});
            }catch(e){if(e.code==='ENOENT')preserved.push({path:out.path,reason:'ALREADY_ABSENT'});else throw e;}
          }
        }
      }
    }
    let attachmentCount=null,indexEdits=[];
    if(mode==='full') {
      const attachmentPlan=await planAttachments(this.ctx,{root:this.root,targets:rows.filter(r=>ids.includes(r.header.id)),survivors:survivors.concat(this.stagedReferences()),targetIds:ids});
      candidates.push(...attachmentPlan.candidates);preserved.push(...attachmentPlan.preserved);blockers.push(...attachmentPlan.blockers);indexEdits=attachmentPlan.indexEdits;attachmentCount=attachmentPlan.attachmentCount;
    }
    const controller=this.ctx.get('sessionController');
    const summary=controller?.list?(await controller.list({},new AbortController().signal)).items.find(s=>s.sessionId===sessionId):undefined;
    const corpus=all.map(r=>({id:r.header.id,revision:r.revision,sizeBytes:r.sizeBytes,header:r.header}));
    const recoveryReferences=rows.filter(r=>ids.includes(r.header.id)).map(row=>{const references=[],pending=[row.events,row.proof?.references??[]];while(pending.length){const node=pending.pop();if(typeof node==='string')references.push(node);else if(node&&typeof node==='object')pending.push(...Object.values(node));}return {id:row.header.id,cwd:row.header.cwd,references:[...new Set(references)]};});
    return {session:{id:snapshot.header.id,title:summary?.title??snapshot.header.title??sessionId,cwd:snapshot.header.cwd??'',logBytes:snapshot.sizeBytes??null,attachmentCount},attachmentCount,ids,children:children.map(h=>({id:h.id,cwd:h.cwd})),candidates,indexEdits,preserved,blockers:[...new Set(blockers)],metadata:{...this.metadata(ids),headers:headers.filter(h=>ids.includes(h.id)),corpus,recoveryReferences}};
  }
  async acquire(ids,plan={}) {
    const handles=[];let acquiringId;
    try{
      const deep=plan.mode&&plan.mode!=='chat_only'&&!plan.restore;
      const all=deep?await this.corpus():[];
      const leaseIds=deep?all.map(row=>row.header.id):ids;
      for(const id of [...leaseIds].sort()) {
        acquiringId=id;
        const row=all.find(r=>r.header.id===id);
        const live=this.ctx.get('sessions')?.get(id);
        if(deep&&!ids.includes(id)&&live&&this.coordinator?.supported) {
          const agent=this.ctx.get('agents')?.get(id),events=await this.events(id);
          // The host owns a new blank draft's lease before the first message.
          // It contributes no references; guarded HTTP/tools cannot populate it
          // during this transaction. Never exempt a conversation with input.
          if(agent?.status==='idle'&&agent.inbox?.hasPending===false&&events.every(e=>['session/title','permission/preset','sandbox/mode','approval/policy','session/end-seed'].includes(e.type)))continue;
        }
        if(deep&&row?.sizeBytes===undefined&&!ids.includes(id)) {
          const events=await this.events(id);
          // Empty, never-materialized draft sessions have no durable references.
          // A nonempty pending session cannot be excluded from the barrier.
          if(events.length===0&&!live)continue;
          throw Object.assign(new CleanerError('SESSION_BUSY'),{message:'SESSION_BUSY: '+id});
        }
        if(this.ctx.get('sessions')?.get(id))throw Object.assign(new CleanerError('SESSION_BUSY'),{message:'SESSION_BUSY: '+id});
        // Retain the host's write ownership through staging and registry updates.
        // session.lock stays at its original path; moving its inode breaks POSIX mutual exclusion.
        if(plan.restore && !await this.persistence.stat(id)) {
          if(typeof this.persistence.acquireWriteLease!=='function')throw new CleanerError('RESTORE_LEASE_UNAVAILABLE',422);
          const saved=plan.metadata.headers.find(h=>h.id===id);
          handles.push({close:await this.persistence.acquireWriteLease(saved).then(l=>()=>l.release())});
        }else handles.push(await this.persistence.open(id,'write'));
      }
      return async()=>{for(const h of handles.reverse())await h.close();};
    }catch(e){for(const h of handles.reverse())await h.close();if(e.name==='SessionAlreadyOwnedError')throw Object.assign(new CleanerError('SESSION_BUSY'),{message:'SESSION_BUSY: '+acquiringId});throw e;}
  }
  async forget(ids) {
    for(const id of ids){for(const w of this.registry.list())if(w.sessionIds.includes(id))await w.detachSession(id);await this.registry.unpinSession(id);await this.registry.unarchiveSession(id);const domain=this.ctx.get('storageDomain')?.get('session_projcache');if(domain)await domain.table('sessions').delete(id);}
  }
  async restore(ids,metadata) {
    for(const row of metadata.domains){const domain=this.ctx.get('storageDomain')?.get(row.domain);if(!domain)throw new CleanerError('RESTORE_DOMAIN_UNAVAILABLE');await domain.table(row.table).put(row.id,row.value);}
    for(const account of metadata.workspace){const w=this.registry.list().find(w=>w.id===account.id);if(!w)throw new CleanerError('RESTORE_WORKSPACE_MISSING');for(const id of account.sessionIds)await w.attachSession(id);}
    for(const id of metadata.pinned)await this.registry.pinSession(id);
    for(const id of metadata.archived)await this.registry.archiveSession(id);
  }
  async refreshProvenance(journal) {
    // Renaming a proven output changes ctime. Preserve its original ownership
    // after recovery only when inode, size and mtime still match the journal.
    for(const id of journal.ids){const file=this.recordPath(id),proof=await optionalJson(file);if(!proof)continue;let changed=false;
      for(const out of proof.outputs??[]){const unit=journal.units.find(u=>u.kind==='output'&&comparable(u.path)===comparable(out.path));if(!unit)continue;
        const identity=fileIdentity(await safeFile(unit.root,unit.path));
        if(JSON.stringify(identity.slice(0,4))!==JSON.stringify(unit.identity?.slice(0,4)))throw new CleanerError('RESTORE_OUTPUT_CHANGED');
        out.identity=identity;changed=true;
      }
      if(changed)await fs.writeFile(file,JSON.stringify(proof));
    }
  }
  async verify(ids) {
    for(const id of ids){if(await this.persistence.stat(id))throw new CleanerError('VERIFY_SESSION_PRESENT');if(this.registry.list().some(w=>w.sessionIds.includes(id)) || this.registry.pinnedSessionIds.includes(id) || this.registry.archivedSessionIds.includes(id))throw new CleanerError('VERIFY_REGISTRY_PRESENT');}
  }
  async broadcast(ids,{restored=false}={}) {
    if(!restored){for(const id of ids)this.ctx.emit('api-session/removed',id);return;}
    const controller=this.ctx.get('sessionController');
    if(!controller?.list)throw new CleanerError('REFRESH_SERVICE_UNAVAILABLE');
    const {items}=await controller.list({},new AbortController().signal);
    for(const summary of items)if(ids.includes(summary.sessionId))this.ctx.emit('api-session/added',summary);
  }
}
