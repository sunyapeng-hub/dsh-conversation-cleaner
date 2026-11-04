import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileIdentity } from '../adapters/dsh.js';
import { safeFile } from './cleaner.js';

// This observer records identities, never file content copies or checksums.
// Unknown tools make strict output cleanup unavailable for that session.
export function installProvenance(ctx,adapter) {
  const chains=new Map();
  ctx.on('tools/execute',async(exec,next)=>{
    const session=exec.agent?.session;
    if(!session)return next();
    const id=session.id;
    const file=adapter.recordPath(id);
    const prior=chains.get(id)??Promise.resolve();
    let resolve;const gate=new Promise(r=>resolve=r);chains.set(id,gate);
    await prior;
    let record,result,dispatched=false;
    try{
      try{record=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(!record){const events=await adapter.events(id);record={complete:!events.some(e=>e.type==='tool/call' && e.data.callId!==exec.callId),unknown:false,outputs:[],references:[],seenCallIds:[]};}
      if(!['read','write','edit'].includes(exec.name))record.unknown=true;
      // Keep creation ownership only while the previous file identity is still
      // present. A later update must not adopt a user's replacement at that path.
      const continuous=[];
      for(const out of record.outputs){
        try{
          const stat=await safeFile(session.header.cwd,out.path);
          if(JSON.stringify(fileIdentity(stat))===JSON.stringify(out.identity))continuous.push(out);
        }catch{/* An absent or unsafe file no longer has proven ownership. */}
      }
      record.outputs=continuous;
      // Persist uncertainty before dispatch: a crash must never turn an unfinished write into proven ownership.
      const previousComplete=record.complete;record.complete=false;
      await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(record));
      dispatched=true;result=await next();
      const output=result.value;
      if(result.isError)record.unknown=true;
      if(['write','edit'].includes(exec.name) && !result.isError){
        let operation=output?.operation;
        if(exec.name==='edit'){
          // Native edit reports a before/after diff, never file creation.
          const nativeUpdate=operation===undefined && typeof output?.before==='string' && typeof output?.after==='string';
          operation=operation==='update' || nativeUpdate?'update':undefined;
        }
        if(!output || typeof output.path!=='string' || !['create','update'].includes(operation))record.unknown=true;
        else{
          const stat=await safeFile(session.header.cwd,output.path);
          const existing=record.outputs.find(o=>o.path===output.path);
          if(operation==='create' || existing){const row={path:output.path,identity:fileIdentity(stat)};if(existing)Object.assign(existing,row);else record.outputs.push(row);}
          if(!record.references.includes(output.path))record.references.push(output.path);
        }
      }else if(exec.name==='read') {
        const lexical=typeof exec.arguments?.file_path==='string'?path.resolve(session.header.cwd,exec.arguments.file_path):undefined;
        const reference=typeof result.value?.path==='string'?await fs.realpath(result.value.path):lexical?await fs.realpath(lexical):undefined;
        if(!reference)record.unknown=true;
        else if(!record.references.includes(reference))record.references.push(reference);
      }
      record.complete=previousComplete;record.seenCallIds.push(exec.callId);
      await fs.writeFile(file,JSON.stringify(record));return result;
    }catch(error){ctx.logger?.warn?.('conversation-cleaner: provenance unavailable: '+error.message);if(dispatched){if(result!==undefined)return result;throw error;}return next();}
    finally{resolve();if(chains.get(id)===gate)chains.delete(id);}
  });
}
