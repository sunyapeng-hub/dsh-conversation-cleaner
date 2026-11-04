import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {LlmAdapter,createSystemMessage,createUserMessage,createAssistantMessage,createToolResultMessage} from '../../research/installed-next/node_modules/@deepseek-ai/dsh-llm/lib/index.js';
import * as fsTools from '../../research/installed-next/node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js';
export const name='cleaner-e2e-driver';
export const inject=['sessionPersistence','workspaceRegistry','webServer','connection','agents','tools','attachments','llm'];
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function apply(ctx) {
 const root=path.dirname(ctx.sessionPersistence.root);
 const within=(base,file)=>{const relative=path.relative(path.resolve(base),path.resolve(file));return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
 if(!within(path.join(project,'.test-data'),root))throw new Error('E2E driver only supports this project isolated .test-data roots');
 const testPath=file=>{if(typeof file!=='string'||!within(root,file))throw new Error('Synthetic path escaped test root');return path.resolve(file);};
 const testFile=async file=>{let cursor=testPath(file);for(;;){const stat=await fs.lstat(cursor);if(stat.isSymbolicLink())throw new Error('Unsafe synthetic path link');if(cursor===path.resolve(root))break;cursor=path.dirname(cursor);}return path.resolve(file);};
 const receipt=path.join(project,'evidence','fixtures',path.basename(root)+'-v2.json');
 await fs.mkdir(path.dirname(receipt),{recursive:true});
 let fixtures;try{fixtures=JSON.parse(await fs.readFile(receipt,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;fixtures={};}
 const handles=new Map();
 const staged=new Map();
 const maintenance=new Map();
 const originalProofs=new Map();
 class HoldAdapter extends LlmAdapter {async *stream({signal}){await new Promise((_resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}}
 ctx.llm.registerAdapter(['cleaner-e2e-local-hold'],new HoldAdapter());
 const save=()=>fs.writeFile(receipt,JSON.stringify(fixtures,null,2));
 async function create(kind) {
  if(!['A','B','C','D','E'].includes(kind))throw new Error('Invalid synthetic fixture kind');
  const id='session-'+randomUUID(),cwd=path.join(root,'e2e-workspaces',id);
  await fs.mkdir(cwd,{recursive:true});const keep=path.join(cwd,'keep.txt'),output=path.join(cwd,'generated.txt');
  await fs.writeFile(keep,'Existing workspace file; preserve this.');
  if(['D','E'].includes(kind))await fs.writeFile(output,'Existing before the tool call; never a generated output.');
  const workspace=await ctx.workspaceRegistry.create(cwd,'Cleaner '+kind+' '+id.slice(-6));
  const orphan=await ctx.attachments.saveFile({name:'orphan-'+kind+'.txt',data:Buffer.from('Synthetic attachment '+id)});
  const shared=await ctx.attachments.saveFile({name:'shared-'+kind+'.txt',data:Buffer.from('Shared attachment '+id)});
  const handle=await ctx.agents.create({sessionId:id,meta:{cwd},setup:async(agentCtx,agent)=>{
   if(!agentCtx.tools.get('write',agent)){const fork=agentCtx.plugin(fsTools);await fork.await();}
   if(agentCtx.tools.modeFor(agent)!=='native')agentCtx.tools.presentAs('native');
  }});
  try{
   const agent=handle.agent,session=agent.session;
   session.append('session/title',{title:'Cleaner '+kind+' populated fixture',messageSeqs:[],source:{kind:'user'}});
   session.append('turn/start',{turn:1});
   session.append('step/start',{turn:1,step:1});
   session.append('system/message',{turn:1,step:1,message:createSystemMessage('Synthetic cleanup fixture system head.')},{surfaceOp:'append'});
   session.append('user/message',createUserMessage({content:[{type:'text',text:'Synthetic cleanup fixture. No real user data.'},...(kind==='E'?[]:[{type:'file',attachment:orphan},{type:'file',attachment:shared}])],source:{kind:'user'}}),{surfaceOp:'append'});
   if(['D','E'].includes(kind)){
    const readId='cleaner-read-'+randomUUID(),args={file_path:output};
    session.append('assistant/message',{turn:1,step:1,stream:[],message:createAssistantMessage({source:{provider:'cleaner-e2e',model:'synthetic'},content:[{type:'tool-call',id:readId,name:'read',arguments:JSON.stringify(args)}]})},{surfaceOp:'append'});
    const call=session.append('tool/call',{turn:1,step:1,callId:readId,name:'read',arguments:JSON.stringify(args)});
    const result=await agent.ctx.tools.execute({callId:readId,name:'read',arguments:args,agent,signal:new AbortController().signal});if(result.isError)throw new Error('Synthetic existing-file read failed');
    session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId:readId,content:result.content,isError:false}),sourceEventSeqs:[call.seq]},{surfaceOp:'append'});
   }
   const callId='cleaner-call-'+randomUUID(),args={file_path:output,content:'Generated by the actual DSH write tool for '+id};
   session.append('assistant/message',{turn:1,step:1,stream:[],message:createAssistantMessage({source:{provider:'cleaner-e2e',model:'synthetic'},content:[{type:'tool-call',id:callId,name:'write',arguments:JSON.stringify(args)}]})},{surfaceOp:'append'});
   const call=session.append('tool/call',{turn:1,step:1,callId,name:'write',arguments:JSON.stringify(args)});
   const result=await agent.ctx.tools.execute({callId,name:'write',arguments:args,agent,signal:new AbortController().signal});
   if(result.isError)throw new Error('Real write tool failed: '+JSON.stringify(result));
   session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId,content:result.content,isError:false}),sourceEventSeqs:[call.seq],...(result.meta?{meta:result.meta}:{})},{surfaceOp:'append'});
   session.append('step/end',{turn:1,step:1});session.append('turn/end',{turn:1,reason:{kind:'completed'}});
   await ctx.sessionPersistence.flush();await workspace.attachSession(id);
  }finally{await handle.dispose();}
  const survivor='session-'+randomUUID();
  const stored=await ctx.sessionPersistence.create({version:4,id:survivor,createdAt:Date.now(),cwd,isSeeded:false,delegationDepth:0});
  await stored.append([{seq:0,time:Date.now(),type:'session/title',data:{title:'Shared attachment survivor '+kind,messageSeqs:[],source:{kind:'user'}}},{seq:1,time:Date.now()+1,type:'user/message',surfaceOp:'append',data:createUserMessage({content:[{type:'text',text:'Surviving synthetic conversation.'},{type:'file',attachment:shared}],source:{kind:'user'}})}]);
  await stored.close();await workspace.attachSession(survivor);
  const fixture={id,cwd,workspaceId:workspace.id,kind,keep,output,survivor,orphan,shared,orphanPath:ctx.attachments.fileHostPath(orphan),sharedPath:ctx.attachments.fileHostPath(shared)};
  fixtures[id]=fixture;await save();
  const {items}=await ctx.get('sessionController').list({},new AbortController().signal);for(const summary of items)if([id,survivor].includes(summary.sessionId))ctx.emit('api-session/added',summary);
  return fixture;
 }
 const fixtureFor=id=>{const fixture=fixtures[id];if(!fixture)throw new Error('Unknown synthetic fixture');testPath(fixture.cwd);return fixture;};
 async function operationFor(id,operationId) {
  const fixture=fixtureFor(id);if(typeof operationId!=='string'||! /^[a-f0-9-]{36}$/.test(operationId))throw new Error('Invalid synthetic operation');
  const file=await testFile(path.join(root,'.conversation-cleaner','operations',operationId,'journal.json')),journal=JSON.parse(await fs.readFile(file,'utf8'));
  if(journal.operationId!==operationId)throw new Error('Synthetic operation identity mismatch');
  if(journal.ids?.includes(id)){fixture.operationIds??=[];if(!fixture.operationIds.includes(operationId)){fixture.operationIds.push(operationId);await save();}}
  else if(!fixture.operationIds?.includes(operationId))throw new Error('Operation does not belong to selected synthetic fixture');
  return {fixture,file,journal};
 }
 async function journalSummary(id,operationId) {
  const {journal}=await operationFor(id,operationId),payload={};
  for(const key of ['metadata','units','ids','summary','lastError'])payload[key]=Object.hasOwn(journal,key);
  let stagedPresent=0;for(const unit of journal.units??[]){testPath(unit.path);try{await fs.lstat(testPath(unit.staged));stagedPresent++;}catch(e){if(e.code!=='ENOENT')throw e;}}
  return {state:journal.state,payload,containsSyntheticMarker:/Synthetic|synthetic cleanup/i.test(JSON.stringify(journal)),stagedPresent,unitCount:journal.units?.length??0};
 }
 async function simulatePurge(id,operationId) {
  const {file,journal}=await operationFor(id,operationId);
  if(journal.state!=='VERIFIED'||!journal.ids?.includes(id)||!journal.units?.length)throw new Error('Expected own VERIFIED synthetic operation');
  for(const [index,unit]of journal.units.entries()){
   testPath(unit.path);testPath(unit.staged);
   const expected=path.join(root,'.conversation-cleaner','operations',operationId,String(index)),side=path.join(path.dirname(unit.path),'.dsh-conversation-cleaner-quarantine',operationId,String(index));
   if(![expected,side].includes(path.resolve(unit.staged)))throw new Error('Unexpected synthetic staging path');
   await testFile(unit.staged);
  }
  journal.state='PURGING';journal.permanent=true;await fs.writeFile(file,JSON.stringify(journal,null,2));
  let removed=0;if(journal.units.length>1){await fs.unlink(journal.units[0].staged);removed=1;}
  return {simulated:true,removed,...await journalSummary(id,operationId)};
 }
 async function replaceAndEdit(id) {
  const f=fixtureFor(id),original=testPath(f.output+'.original');testPath(f.output);await fs.rename(f.output,original);await fs.writeFile(f.output,'Independent user replacement.');
  const handle=await ctx.agents.resume({resumeSessionId:id,setup:async(agentCtx,agent)=>{if(!agentCtx.tools.get('edit',agent)){const fork=agentCtx.plugin(fsTools);await fork.await();}if(agentCtx.tools.modeFor(agent)!=='native')agentCtx.tools.presentAs('native');}});
  try {
   const agent=handle.agent,session=agent.session;session.append('turn/start',{turn:2});session.append('step/start',{turn:2,step:1});session.append('user/message',createUserMessage({content:[{type:'text',text:'Synthetic read and edit of an independent user replacement.'}],source:{kind:'user'}}),{surfaceOp:'append'});
   for(const [name,args]of [['read',{file_path:f.output}],['edit',{file_path:f.output,old_string:'Independent',new_string:'Edited independent'}]]){
    const callId='cleaner-replacement-'+randomUUID();session.append('assistant/message',{turn:2,step:1,stream:[],message:createAssistantMessage({source:{provider:'cleaner-e2e',model:'synthetic'},content:[{type:'tool-call',id:callId,name,arguments:JSON.stringify(args)}]})},{surfaceOp:'append'});
    const call=session.append('tool/call',{turn:2,step:1,callId,name,arguments:JSON.stringify(args)}),result=await agent.ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal});if(result.isError)throw new Error('Synthetic replacement '+name+' failed');
    session.append('tool/result',{turn:2,step:1,message:createToolResultMessage({callId,content:result.content,isError:false}),sourceEventSeqs:[call.seq],...(result.meta?{meta:result.meta}:{})},{surfaceOp:'append'});
   }
   session.append('step/end',{turn:2,step:1});session.append('turn/end',{turn:2,reason:{kind:'completed'}});await ctx.sessionPersistence.flush();
  }finally{await handle.dispose();}
  return {replaced:true,outputText:await fs.readFile(f.output,'utf8')};
 }
 async function state(id) {
  const f=fixtures[id];if(!f)throw new Error('Unknown synthetic fixture');
  const file=async p=>{try{const s=await fs.stat(p);return {exists:true,size:s.size,links:s.nlink};}catch(e){if(e.code==='ENOENT')return {exists:false};throw e;}};
  return {fixture:f,session:!!await ctx.sessionPersistence.stat(id),survivor:!!await ctx.sessionPersistence.stat(f.survivor),member:ctx.workspaceRegistry.list().some(w=>w.sessionIds.includes(id)),keep:await fs.readFile(f.keep,'utf8'),output:await file(f.output),orphan:await file(f.orphanPath),shared:await file(f.sharedPath),root,profile:ctx.get('desktopProfiles')?.current?.name??'web'};
 }
 ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/cleaner-e2e',handler:async(req,res)=>{
  const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  const rejected=ctx.connection.requestRejection(req);if(rejected)return send(rejected,{ok:false});
  if(req.method!=='POST')return send(405,{ok:false});
  try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw new Error('Body too large');}const body=JSON.parse(raw);let result;
   if(body.action==='create')result=await create(body.kind);
   else if(body.action==='state')result=await state(body.id);
   else if(body.action==='registry-state'){const f=fixtureFor(body.id);result={memberships:ctx.workspaceRegistry.list().filter(w=>w.sessionIds.includes(f.id)).map(w=>w.id),pinned:ctx.workspaceRegistry.pinnedSessionIds.includes(f.id),archived:ctx.workspaceRegistry.archivedSessionIds.includes(f.id)};}
   else if(body.action==='mark-pin'){const f=fixtureFor(body.id);await ctx.workspaceRegistry.pinSession(f.id);result={pinned:true};}
   else if(body.action==='mark-archive'){const f=fixtureFor(body.id);await ctx.workspaceRegistry.archiveSession(f.id);result={archived:true};}
   else if(body.action==='drop-workspace'){const f=fixtureFor(body.id);await ctx.workspaceRegistry.delete(f.workspaceId);result={dropped:true};}
   else if(body.action==='journal-summary')result=await journalSummary(body.id,body.operationId);
   else if(body.action==='simulate-purge')result=await simulatePurge(body.id,body.operationId);
   else if(body.action==='replace-and-edit')result=await replaceAndEdit(body.id);
   else if(body.action==='legacy-terminal'){const {file,journal}=await operationFor(body.id,body.operationId);if(!['PERMANENT','RESTORED'].includes(journal.state))throw new Error('Expected own completed synthetic operation');journal.metadata={recoveryReferences:[{id:body.id,references:['Synthetic legacy terminal residue.']}],domains:[],workspace:[]};await fs.writeFile(file,JSON.stringify(journal,null,2));result=await journalSummary(body.id,body.operationId);}
   else if(body.action==='hold'){if(!fixtures[body.id])throw new Error('Unknown synthetic fixture');const h=await ctx.agents.resume({resumeSessionId:body.id});handles.set(body.id,h);result={held:true};}
   else if(body.action==='hold-startup'){if(!fixtures[body.id])throw new Error('Unknown synthetic fixture');const h=await ctx.agents.requireFactory().target.resumeWith(ctx,ctx.sessionPersistence,{resumeSessionId:body.id});handles.set(body.id,h);result={held:true};}
   else if(body.action==='run'){if(!fixtures[body.id])throw new Error('Unknown synthetic fixture');const h=await ctx.agents.resume({resumeSessionId:body.id,agentOptions:{provider:'cleaner-e2e-local-hold',model:'local-no-network'}});handles.set(body.id,h);h.agent.send(createUserMessage({content:[{type:'text',text:'Synthetic running-agent safety check; local blocked adapter only.'}],source:{kind:'user'}}),'next-turn',true);result={held:true,status:h.agent.status};}
   else if(body.action==='queue'){const h=handles.get(body.id);if(!h)throw new Error('Not held');h.agent.send(createUserMessage({content:[{type:'text',text:'Synthetic unsent queue protection.'}],source:{kind:'user'}}),'next-turn',false);result={pending:h.agent.inbox.hasPending};}
   else if(body.action==='unknown-proof'){if(!fixtures[body.id])throw new Error('Unknown synthetic fixture');const file=path.join(root,'.conversation-cleaner','provenance',body.id+'.json'),bytes=await fs.readFile(file);originalProofs.set(body.id,{file,bytes});const proof=JSON.parse(bytes);proof.complete=false;proof.unknown=true;await fs.writeFile(file,JSON.stringify(proof));result={unknown:true};}
   else if(body.action==='repair-proof'){const saved=originalProofs.get(body.id);if(!saved)throw new Error('No synthetic proof to restore');await fs.writeFile(saved.file,saved.bytes);originalProofs.delete(body.id);result={restored:true};}
   else if(body.action==='maintenance'){const h=handles.get(body.id);if(!h)throw new Error('Not held');const done=Promise.withResolvers(),task=h.agent.runMaintenance(()=>done.promise);maintenance.set(body.id,{done,task});result={status:h.agent.status,phase:h.agent.phase.kind};}
   else if(body.action==='rename-held'){const h=handles.get(body.id);if(!h)throw new Error('Not held');h.agent.session.append('session/title',{title:'Synthetic changed after preview',messageSeqs:[],source:{kind:'user'}});await ctx.sessionPersistence.flush();result={changed:true};}
   else if(body.action==='release'){const m=maintenance.get(body.id);if(m){m.done.resolve();await m.task;maintenance.delete(body.id);}await handles.get(body.id)?.dispose();handles.delete(body.id);result={held:false};}
   else if(body.action==='diagnose'){const rows=await ctx.sessionPersistence.list({});result={rows:await Promise.all(rows.map(async r=>{const agent=ctx.agents.get(r.header.id),live=ctx.get('sessions')?.get(r.header.id);return {id:r.header.id,size:r.sizeBytes,live:!!live,status:agent?.status,pending:agent?.inbox?.hasPending};}))};}
   else if(body.action==='stage'||body.action==='stage-held'){const f=fixtures[body.id];if(!f)throw new Error('Unknown synthetic fixture');const owner=body.action==='stage-held'?handles.get(body.id)?.agent:ctx.agents.list().find(a=>a.status==='idle'&&a.inbox.hasPending===false&&!fixtures[a.id]);if(!owner)throw new Error('No isolated idle owner');const upload=await ctx.get('fileUploads').uploadStream({sessionId:owner.id,name:f.orphan.name,data:[await fs.readFile(f.orphanPath)]});staged.set(body.id,{owner,receiptId:upload.receiptId});result={owner:owner.id,receiptId:upload.receiptId,file:upload.file};}
   else if(body.action==='unstage'){const entry=staged.get(body.id);if(!entry)throw new Error('No test receipt');const uploads=ctx.get('fileUploads'),requestId='cleaner-e2e-'+randomUUID();const guard=uploads.bindPrompt(entry.owner,[entry.receiptId],requestId);guard.commit();uploads.retirePrompt(entry.owner,requestId);staged.delete(body.id);result={released:true};}
   else result={root,profile:ctx.get('desktopProfiles')?.current?.name??'web',fixtures:Object.keys(fixtures)};
   send(200,{ok:true,...result});
  }catch(error){send(500,{ok:false,message:error.stack});}
 }}));
 ctx.effect(()=>()=>Promise.all([...handles.values()].map(h=>h.dispose())));
 console.log('CLEANER_E2E_DRIVER_READY '+JSON.stringify({root,profile:ctx.get('desktopProfiles')?.current?.name??'web'}));
}
