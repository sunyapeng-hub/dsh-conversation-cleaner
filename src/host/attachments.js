import * as fs from 'node:fs/promises';
import path from 'node:path';

// IDs already persisted by the provider are opaque here; no digests are computed.
const ID=/^sha256:[a-f0-9]{64}$/;
const TOKEN=/(?<![a-zA-Z0-9])sha256:[a-f0-9]{64}(?![a-zA-Z0-9])/g;
const LIMIT_FILES=20000;
// First-party installation/browser/startup-diagnostic locations, not durable
// attachment ownership stores. See evidence/attachment-research.md.
const NON_REFERENCE_ROOTS=new Set(['sessions','attachments','.conversation-cleaner','profiles','electron-user-data','dsh-runtimes','logs','recovery']);
const within=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
const absent=error=>error.code==='ENOENT';
const problem=code=>Object.assign(new Error(code),{code});

async function regular(root,file) {
 if(!within(root,file))throw problem('ATTACHMENT_PROVIDER_PATH_UNSAFE');
 let cursor=file;
 for(;;){const stat=await fs.lstat(cursor);if(stat.isSymbolicLink())throw problem('ATTACHMENT_UNSAFE_LINK');if(cursor===root)break;cursor=path.dirname(cursor);}
 const stat=await fs.lstat(file);if(!stat.isFile())throw problem('ATTACHMENT_SOURCE_UNSAFE');return stat;
}
function walk(value,visit) {
 const pending=[value];
 while(pending.length){const node=pending.pop();visit(node);if(node&&typeof node==='object')for(const child of Object.values(node))pending.push(child);}
}
function references(value,ids) {
 const result=new Set();
 walk(value,node=>{if(typeof node==='string'){
  for(const token of node.matchAll(TOKEN))if(ids.has(token[0]))result.add(token[0]);
  // Host paths contain the opaque provider hex without the sha256: prefix.
  // This also covers alias/canonical paths in tool arguments and provenance.
  for(const id of ids)if(node.toLowerCase().includes(id.slice(7)))result.add(id);
 }});
 return result;
}
function validateIndex(doc) {
 if(!doc||doc.formatVersion!==3||!Array.isArray(doc.records))throw problem('ATTACHMENT_REFERENCE_SOURCE_INVALID');
 const seen=new Set();
 for(const r of doc.records){
  if(!r||typeof r.scope!=='string'||! /^[a-f0-9]{64}$/.test(r.scope)||!ID.test(r.attachmentId)||!ID.test(r.variantId)||typeof r.fileId!=='string'||!r.fileId||!['bytes','createdAt','expiresAt'].every(k=>Number.isSafeInteger(r[k])&&r[k]>=0))throw problem('ATTACHMENT_REFERENCE_SOURCE_INVALID');
  const key=r.scope+'\0'+r.variantId;if(seen.has(key))throw problem('ATTACHMENT_REFERENCE_SOURCE_INVALID');seen.add(key);
 }
}

/** Read-only rc3 local-store plan. The caller coordinates all participating hosts
 * and supplies every target/survivor's complete decoded canonical event log.
 * indexEdits are server-only {path,root,before:Buffer,after:Buffer} snapshots;
 * applying/quarantining them belongs to the same transaction as candidates.
 */
export async function planAttachments(ctx,{root,targets,survivors,targetIds,countOnly=false,maxBytes=256*1024*1024}) {
 root=path.resolve(root);
 const result={candidates:[],preserved:[],blockers:[],attachmentCount:0,indexEdits:[]};
 const block=code=>{if(!result.blockers.includes(code))result.blockers.push(code);};
 const preserve=(file,reason)=>{if(!result.preserved.some(p=>p.path===file&&p.reason===reason))result.preserved.push({path:file,reason});};
 let bytes=0,files=0;
 const budget=size=>{bytes+=size;if(bytes>maxBytes||++files>LIMIT_FILES)throw problem('ATTACHMENT_SCAN_LIMIT');};
 const refs=new Map(),selected=new Set(targetIds??[]);
 try {
  for(const row of targets??[]) {
   if(!selected.has(row.header?.id)||!Array.isArray(row.events))throw problem('ATTACHMENT_EVENT_SOURCE_INCOMPLETE');
   budget(Buffer.byteLength(JSON.stringify(row.events)));
   walk(row.events,node=>{
    if(!node||typeof node!=='object'||!['image','file'].includes(node.type)||!node.attachment)return;
    const ref=node.attachment;if(!ID.test(ref.attachmentId))throw problem('ATTACHMENT_REFERENCE_INVALID');
    const list=refs.get(ref.attachmentId)??[];list.push({type:node.type,ref});refs.set(ref.attachmentId,list);
   });
  }
  result.attachmentCount=refs.size;
  if(!refs.size||countOnly)return result;
  const store=ctx.get?.('attachments')??ctx.attachments;
  const storeRoot=path.join(root,'attachments','v1'),cacheRoot=path.join(root,'cache','attachments');
  if(!store||path.resolve(store.root??'')!==storeRoot||typeof store.imageHostPath!=='function'||typeof store.fileHostPath!=='function')throw problem('ATTACHMENT_LOCAL_STORE_REQUIRED');
  if(store.cacheRoot&&path.resolve(store.cacheRoot)!==cacheRoot)throw problem('ATTACHMENT_PROVIDER_PATH_UNSAFE');
  const ids=new Set(refs.keys()),shared=new Map();
  for(const row of survivors??[]) {
   if(selected.has(row.header?.id)||!Array.isArray(row.events))throw problem('ATTACHMENT_EVENT_SOURCE_INCOMPLETE');
   budget(Buffer.byteLength(JSON.stringify(row.events)));
   for(const id of references([row.events,row.proof?.references??[]],ids))shared.set(id,'SHARED_ATTACHMENT');
  }
  const uploadIndex=path.join(root,'llm-deepseek','files-v3.json');let index;
  // The persistence layer supplies full canonical session logs. Only JSON
  // stores/caches outside that tree can hold additional durable references.
  async function scan(dir) {
   let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(e){if(absent(e))return;throw e;}
   for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    const file=path.join(dir,entry.name);if(++files>LIMIT_FILES)throw problem('ATTACHMENT_SCAN_LIMIT');
    if(dir===root&&NON_REFERENCE_ROOTS.has(entry.name))continue;
    if(entry.isSymbolicLink())throw problem('ATTACHMENT_UNSAFE_LINK');
    if(entry.isDirectory()){await scan(file);continue;}
    if(!/\.json(?:\.|$)/i.test(entry.name))continue;
    const stat=await regular(root,file);budget(stat.size);const before=await fs.readFile(file);
    const after=await fs.lstat(file);if(stat.ino!==after.ino||stat.size!==after.size||stat.mtimeMs!==after.mtimeMs)throw problem('ATTACHMENT_REFERENCE_SOURCE_CHANGED');
    let doc;try{doc=JSON.parse(before.toString('utf8'));}catch{throw problem('ATTACHMENT_REFERENCE_SOURCE_INVALID');}
    if(file===uploadIndex){validateIndex(doc);index={doc,before};continue;}
    // Selected projection-cache records disappear with their owning sessions.
    const rel=path.relative(path.join(root,'storages','session_projcache','sessions'),file);
    if(!rel.startsWith('..')&&!path.isAbsolute(rel)&&selected.has(path.basename(file,'.json')))continue;
    if(file===path.join(root,'storages','session_projcache.json')&&doc?.tables?.sessions) {
     doc={...doc,tables:{...doc.tables,sessions:Object.fromEntries(Object.entries(doc.tables.sessions).filter(([sid])=>!selected.has(sid)))}};
    }
    for(const id of references(doc,ids))shared.set(id,'DURABLE_ATTACHMENT_REFERENCE');
   }
  }
  await scan(root);
  const eligible=new Set([...ids].filter(id=>!shared.has(id)));
  const add=async(file,kind,ownerRoot=storeRoot,extra={})=>{
   try{await regular(root,file);await regular(ownerRoot,file);if(!result.candidates.some(c=>c.path===file))result.candidates.push({path:file,root:ownerRoot,kind,...extra});}catch(e){if(absent(e))preserve(file,'ALREADY_ABSENT');else throw e;}
  };
  for(const [id,uses] of refs) {
   const hex=id.slice(7),shard=hex.slice(0,2);
   for(const {type,ref} of uses) {
    const actual=await (type==='file'?store.fileHostPath(ref):store.imageHostPath(ref));
    const expected=type==='file'?path.join(storeRoot,'files',shard,hex,ref.name??''):path.join(storeRoot,'objects',shard,hex);
    if(typeof actual!=='string'||path.resolve(actual)!==expected||!within(storeRoot,expected)||(type==='file'&&(!ref.name||path.basename(ref.name)!==ref.name||/[\\/]/.test(ref.name))))throw problem('ATTACHMENT_PROVIDER_PATH_UNSAFE');
    if(shared.has(id)){preserve(actual,shared.get(id));continue;}
    if(type==='image'){await add(actual,'attachment');continue;}
    const canonical=path.join(storeRoot,'file-objects',shard,hex),aliasDir=path.dirname(expected),group=[];
    try{const names=await fs.readdir(aliasDir);for(const name of names){if(++files>LIMIT_FILES)throw problem('ATTACHMENT_SCAN_LIMIT');group.push(path.join(aliasDir,name));}}catch(e){if(!absent(e))throw e;}
    let canonicalStat;try{canonicalStat=await regular(storeRoot,canonical);group.push(canonical);}catch(e){if(!absent(e))throw e;}
    const existing=[];for(const file of group){const stat=await regular(storeRoot,file);existing.push({file,stat});}
    if(!existing.length){preserve(expected,'ALREADY_ABSENT');continue;}
    const identity=canonicalStat??existing[0].stat;
    if(existing.some(({stat})=>stat.dev!==identity.dev||stat.ino!==identity.ino||stat.nlink!==existing.length))throw problem('ATTACHMENT_EXTERNAL_LINK');
    for(const {file} of existing)await add(file,'attachment',storeRoot,{expectedLinks:existing.length});
   }
  }
  if(index) {
   const removed=index.doc.records.filter(r=>eligible.has(r.attachmentId));
   const kept=index.doc.records.filter(r=>!eligible.has(r.attachmentId));
   if(removed.length) {
    if(!kept.length)await add(uploadIndex,'attachment-cache',root);
    else {result.indexEdits.push({path:uploadIndex,root,before:index.before,after:Buffer.from(JSON.stringify({...index.doc,records:kept},null,2)+'\n')});preserve(uploadIndex,'PARTIALLY_RETAINED_UPLOAD_INDEX');}
    for(const r of removed){
     if(kept.some(k=>k.variantId===r.variantId)){preserve(path.join(cacheRoot,'request-images',r.variantId.slice(7,9),r.variantId.slice(7)),'SHARED_ATTACHMENT_CACHE');continue;}
     await add(path.join(cacheRoot,'request-images',r.variantId.slice(7,9),r.variantId.slice(7)),'attachment-cache',cacheRoot);
    }
   }
  }
  // Request-image cache names contain variant identities, not attachment ids.
  // Without a durable mapping they cannot be attributed to a selected upload.
  const known=new Set((index?.doc.records??[]).map(r=>r.variantId.slice(7)));
  const requestRoot=path.join(cacheRoot,'request-images');
  async function retainUnmapped(dir) {
   let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(e){if(absent(e))return;throw e;}
   for(const entry of entries){if(++files>LIMIT_FILES)throw problem('ATTACHMENT_SCAN_LIMIT');const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw problem('ATTACHMENT_UNSAFE_LINK');if(entry.isDirectory())await retainUnmapped(file);else if(!known.has(entry.name))preserve(file,'UNMAPPED_REQUEST_IMAGE_CACHE');}
  }
  await retainUnmapped(requestRoot);
 } catch(error) {
  block(error.code?.startsWith('ATTACHMENT_')?error.code:'ATTACHMENT_REFERENCE_SCAN_FAILED');
  // An incomplete proof authorizes no attachment removal or index rewrite.
  for(const c of result.candidates)preserve(c.path,'ATTACHMENT_PROOF_INCOMPLETE');
  result.candidates=[];result.indexEdits=[];
 }
 return result;
}
