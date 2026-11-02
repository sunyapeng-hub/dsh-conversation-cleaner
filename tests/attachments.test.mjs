import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const id='sha256:'+'a'.repeat(64), otherId='sha256:'+'b'.repeat(64), variant='sha256:'+'c'.repeat(64);
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'attachment-plan-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const storeRoot=path.join(root,'attachments','v1');
 const attachments={root:storeRoot,cacheRoot:path.join(root,'cache','attachments'),imageHostPath(ref){return path.join(storeRoot,'objects',ref.attachmentId.slice(7,9),ref.attachmentId.slice(7));},fileHostPath(ref){return path.join(storeRoot,'files',ref.attachmentId.slice(7,9),ref.attachmentId.slice(7),ref.name);}};
 const ctx={get:key=>key==='attachments'?attachments:undefined};
 const write=async(file,value='bytes')=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);return file;};
 const image={attachmentId:id,mediaType:'image/png',width:1,height:1,bytes:5};
 const file={attachmentId:id,name:'upload.txt',bytes:5};
 const row=(type,attachment,sid='selected')=>({header:{id:sid},events:[{type:'message',data:{content:[{type,attachment}]}}]});
 const plan=async(options={})=>{const mod=await import('../src/host/attachments.js').catch(error=>error.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(error));assert.equal(typeof mod.planAttachments,'function','attachment planning must be implemented');return mod.planAttachments(ctx,{root,targets:[],survivors:[],targetIds:['selected'],...options});};
 return {root,attachments,ctx,write,image,file,row,plan};
}
test('plans target image using provider path and keeps original workspace upload',async t=>{
 const f=await fixture(t);const imagePath=await f.write(f.attachments.imageHostPath(f.image));const original=await f.write(path.join(f.root,'workspace','original.png'));
 const result=await f.plan({targets:[f.row('image',f.image)]});
 assert.deepEqual(result.blockers,[]);assert.deepEqual(result.candidates,[{path:imagePath,root:f.attachments.root,kind:'attachment'}]);assert.equal(result.attachmentCount,1);assert.equal(await fs.readFile(original,'utf8'),'bytes');
});
test('plans both stored file alias and canonical file object without reading original upload',async t=>{
 const f=await fixture(t);const object=await f.write(path.join(f.attachments.root,'file-objects','aa','a'.repeat(64)));const alias=f.attachments.fileHostPath(f.file);await fs.mkdir(path.dirname(alias),{recursive:true});await fs.link(object,alias);
 const result=await f.plan({targets:[f.row('file',f.file)]});
 assert.deepEqual(result.blockers,[]);assert.deepEqual(new Set(result.candidates.map(x=>x.path)),new Set([alias,object]));assert.equal(result.attachmentCount,1);
});
test('retains shared attachment referenced anywhere in full survivor event',async t=>{
 const f=await fixture(t);const object=await f.write(f.attachments.imageHostPath(f.image));
 const survivor={header:{id:'child-not-selected'},events:[{type:'checkpoint',data:{old:{attachmentId:id}}}]};
 const result=await f.plan({targets:[f.row('image',f.image)],survivors:[survivor]});
 assert.deepEqual(result.candidates,[]);assert.ok(result.preserved.some(x=>x.path===object&&x.reason==='SHARED_ATTACHMENT'));assert.deepEqual(result.blockers,[]);
});

test('retains attachment read by provider alias path or canonical provenance reference without an ID token',async t=>{
 const f=await fixture(t);const canonical=await f.write(path.join(f.attachments.root,'file-objects','aa','a'.repeat(64))),alias=f.attachments.fileHostPath(f.file);await fs.mkdir(path.dirname(alias),{recursive:true});await fs.link(canonical,alias);
 for(const survivor of [{header:{id:'reader'},events:[{type:'tool/call',data:{arguments:JSON.stringify({file_path:alias})}}]},{header:{id:'reader'},events:[],proof:{references:[canonical]}}]){const p=await f.plan({targets:[f.row('file',f.file)],survivors:[survivor]});assert.deepEqual(p.blockers,[]);assert.deepEqual(p.candidates,[]);assert.ok(p.preserved.some(x=>x.reason==='SHARED_ATTACHMENT'));}
});
test('ignores attachment ids merely mentioned in target text and retains exact ids in durable JSON',async t=>{
 const f=await fixture(t);await f.write(f.attachments.imageHostPath(f.image));await f.write(path.join(f.root,'storages','drafts','draft.json'),JSON.stringify({draft:{attachmentId:id}}));
 const result=await f.plan({targets:[f.row('image',f.image),{header:{id:'selected'},events:[{type:'text',text:otherId}]}]});
 assert.deepEqual(result.candidates,[]);assert.equal(result.attachmentCount,1);assert.ok(result.preserved.some(x=>x.reason==='DURABLE_ATTACHMENT_REFERENCE'));
});
test('plans exclusively owned DeepSeek index and mapped request image cache without computing identities',async t=>{
 const f=await fixture(t);await f.write(f.attachments.imageHostPath(f.image));const cache=await f.write(path.join(f.attachments.cacheRoot,'request-images','cc','c'.repeat(64)));
 const index=await f.write(path.join(f.root,'llm-deepseek','files-v3.json'),JSON.stringify({formatVersion:3,records:[{scope:'d'.repeat(64),attachmentId:id,variantId:variant,fileId:'file-1',bytes:5,createdAt:1,expiresAt:2}]}));
 const result=await f.plan({targets:[f.row('image',f.image)]});
 assert.deepEqual(result.blockers,[]);assert.deepEqual(new Set(result.candidates.filter(x=>x.kind==='attachment-cache').map(x=>x.path)),new Set([cache,index]));
});
test('retains mixed upload index instead of removing other attachments cache records',async t=>{
 const f=await fixture(t);await f.write(f.attachments.imageHostPath(f.image));
 const record=attachmentId=>({scope:'d'.repeat(64),attachmentId,variantId:attachmentId,fileId:'file-1',bytes:5,createdAt:1,expiresAt:2});
 const index=await f.write(path.join(f.root,'llm-deepseek','files-v3.json'),JSON.stringify({formatVersion:3,records:[record(id),record(otherId)]}));
 const result=await f.plan({targets:[f.row('image',f.image)]});
 assert.ok(!result.candidates.some(x=>x.path===index));assert.ok(result.preserved.some(x=>x.path===index));
});
test('blocks corrupt or bounded-out durable reference scan',async t=>{
 const f=await fixture(t);await f.write(f.attachments.imageHostPath(f.image));const corrupt=await f.write(path.join(f.root,'storages','draft.json'),'{');
 const broken=await f.plan({targets:[f.row('image',f.image)]});assert.ok(broken.blockers.includes('ATTACHMENT_REFERENCE_SOURCE_INVALID'));assert.deepEqual(broken.candidates,[]);
 await fs.writeFile(corrupt,JSON.stringify({text:'long'.repeat(500)}));const bounded=await f.plan({targets:[f.row('image',f.image)],maxBytes:1000});assert.ok(bounded.blockers.includes('ATTACHMENT_SCAN_LIMIT'));assert.deepEqual(bounded.candidates,[]);
});
test('blocks provider paths pointing outside dedicated store',async t=>{
 const f=await fixture(t);const original=await f.write(path.join(f.root,'workspace','original.png'));f.attachments.imageHostPath=()=>original;
 const result=await f.plan({targets:[f.row('image',f.image)]});assert.ok(result.blockers.includes('ATTACHMENT_PROVIDER_PATH_UNSAFE'));assert.deepEqual(result.candidates,[]);
});

test('plans real file hardlinks as a complete verified group and rejects external aliases',async t=>{
 const f=await fixture(t);const canonical=await f.write(path.join(f.attachments.root,'file-objects','aa','a'.repeat(64)));const alias=f.attachments.fileHostPath(f.file);await fs.mkdir(path.dirname(alias),{recursive:true});await fs.link(canonical,alias);const second=path.join(path.dirname(alias),'second.txt');await fs.link(canonical,second);
 const result=await f.plan({targets:[f.row('file',f.file)]});assert.deepEqual(result.blockers,[]);assert.equal(result.candidates.length,3);assert.ok(result.candidates.every(c=>c.expectedLinks===3));
 await fs.link(canonical,path.join(f.root,'external.txt'));const blocked=await f.plan({targets:[f.row('file',f.file)]});assert.ok(blocked.blockers.includes('ATTACHMENT_EXTERNAL_LINK'));assert.deepEqual(blocked.candidates,[]);
});
test('mixed upload index returns a reversible edit retaining unrelated records',async t=>{
 const f=await fixture(t);await f.write(f.attachments.imageHostPath(f.image));const record=(attachmentId,fileId)=>({scope:'d'.repeat(64),attachmentId,variantId:attachmentId,fileId,bytes:5,createdAt:1,expiresAt:2});
 const original=JSON.stringify({formatVersion:3,records:[record(id,'file-a'),record(otherId,'file-b')]});const index=await f.write(path.join(f.root,'llm-deepseek','files-v3.json'),original);
 const result=await f.plan({targets:[f.row('image',f.image)]});assert.deepEqual(result.blockers,[]);assert.equal(result.indexEdits.length,1);assert.equal(result.indexEdits[0].path,index);assert.equal(result.indexEdits[0].before.toString(),original);assert.deepEqual(JSON.parse(result.indexEdits[0].after).records,[record(otherId,'file-b')]);assert.equal(await fs.readFile(index,'utf8'),original);
});

test('ignores application installation and browser diagnostic JSON while scanning durable stores',async t=>{
 const f=await fixture(t);const object=await f.write(f.attachments.imageHostPath(f.image));for(const folder of ['profiles','electron-user-data','dsh-runtimes','logs','recovery'])await f.write(path.join(f.root,folder,'unrelated.json'),'{broken runtime record');
 const result=await f.plan({targets:[f.row('image',f.image)]});assert.deepEqual(result.blockers,[]);assert.equal(result.candidates[0].path,object);
});
test('blocks symbolic links inside durable reference stores',async t=>{
 const f=await fixture(t);await f.write(f.attachments.imageHostPath(f.image));const outside=path.join(f.root,'other');await fs.mkdir(outside);await fs.mkdir(path.join(f.root,'storages'));await fs.symlink(outside,path.join(f.root,'storages','linked'),'junction');
 const result=await f.plan({targets:[f.row('image',f.image)]});assert.ok(result.blockers.includes('ATTACHMENT_UNSAFE_LINK'));assert.deepEqual(result.candidates,[]);
});

test('characterizes installed rc3 file and image storage and keeps a real shared upload',async t=>{
 const f=await fixture(t);const {Context}=await import('../research/installed-next/node_modules/@deepseek-ai/cordis/lib/index.js');const {LocalAttachmentStore}=await import('../research/installed-next/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js');const {planAttachments}=await import('../src/host/attachments.js');
 const context=new Context();const store=new LocalAttachmentStore(context,{dshHome:f.root});const ctx={get:key=>key==='attachments'?store:undefined};
 const file=await store.saveFile({data:Buffer.from('isolated uploaded file'),name:'isolated.txt'});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC','base64');const image=await store.saveImage({data:png,mediaType:'image/png',name:'isolated.png'});
 const targets=[f.row('file',file),f.row('image',image)];
 const orphan=await planAttachments(ctx,{root:f.root,targets,survivors:[],targetIds:['selected']});assert.deepEqual(orphan.blockers,[]);assert.equal(orphan.candidates.length,3);assert.equal(orphan.attachmentCount,2);assert.ok(orphan.candidates.filter(c=>c.expectedLinks===2).length===2);
 const shared=await planAttachments(ctx,{root:f.root,targets,survivors:[f.row('file',file,'surviving-session')],targetIds:['selected']});assert.deepEqual(shared.blockers,[]);assert.deepEqual(shared.candidates.map(c=>c.path),[store.imageHostPath(image)]);assert.ok(shared.preserved.some(p=>p.path===store.fileHostPath(file)&&p.reason==='SHARED_ATTACHMENT'));assert.equal((await fs.stat(store.fileHostPath(file))).nlink,2);
});

test('blocks an attachment store reached through a junction outside the home',async t=>{
 const f=await fixture(t);const outside=await fs.mkdtemp(path.join(os.tmpdir(),'attachment-external-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.symlink(outside,path.join(f.root,'attachments'),'junction');await f.write(f.attachments.imageHostPath(f.image));
 const result=await f.plan({targets:[f.row('image',f.image)]});assert.ok(result.blockers.includes('ATTACHMENT_UNSAFE_LINK'));assert.deepEqual(result.candidates,[]);
});
