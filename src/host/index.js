import { Cleaner, CleanerError } from './cleaner.js';
import { DshAdapter } from '../adapters/dsh.js';
import { installProvenance } from './provenance.js';
import { RootCoordinator } from './coordinator.js';
import { SessionReleaseBridge } from './session-release.js';
import {readFile} from 'node:fs/promises';
export const name='dsh-conversation-cleaner';
export const inject=['webServer','connection','sessionPersistence','sessions','workspaceRegistry','storageDomain'];
const prefix='/dsh-conversation-cleaner/v1/';
export function makeHandler(ctx,cleaner,action) {
  return async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try {
      const connection=ctx.get('connection');
      if(!connection?.requestRejection)return send(503,{ok:false,code:'AUTH_SERVICE_UNAVAILABLE'});
      const rejection=connection.requestRejection(req);
      if(rejection)return send(rejection,{ok:false,code:'AUTH_REQUIRED'});
      const origin=req.headers.origin;
      if(origin && new URL(origin).host!==req.headers.host)return send(403,{ok:false,code:'CROSS_ORIGIN'});
      if(req.headers['sec-fetch-site']==='cross-site')return send(403,{ok:false,code:'CROSS_ORIGIN'});
      if(req.method!=='POST'){res.setHeader('allow','POST');return send(405,{ok:false,code:'METHOD_NOT_ALLOWED'});}
      if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')return send(415,{ok:false,code:'JSON_REQUIRED'});
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>16384){send(413,{ok:false,code:'BODY_TOO_LARGE'});req.resume();return;}chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{ok:false,code:'INVALID_JSON'});}
      if(!body || typeof body!=='object'||Array.isArray(body))return send(400,{ok:false,code:'INVALID_REQUEST'});
      let result;
      if(action==='plan')result=await cleaner.plan({sessionId:body.sessionId,mode:body.mode,includeDescendants:body.includeDescendants});
      else if(action==='commit')result=await cleaner.commit({planId:body.planId,confirmation:body.confirmation,acknowledged:body.acknowledged,permanent:body.permanent});
      else if(action==='restore'){if(body.acknowledged!==true)throw new CleanerError('ACK_REQUIRED',400);result=await cleaner.restore(body.operationId);}
      else if(action==='diagnostics'){
        if(typeof body.sessionId!=='string'||!/^(session-)?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.sessionId))throw new CleanerError('INVALID_SESSION',400);
        const {version}=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
        result={version,coordinated:cleaner.adapter.coordinator?.supported===true,release:cleaner.adapter.releaseBridge.describe(body.sessionId)};
      }
      else result={pending:await cleaner.pending()};
      send(200,{ok:true,...result});
    }catch(error){send(error.status??500,{ok:false,code:error.code??'IO_ERROR',message:error.message});}
  };
}
export function apply(ctx,config={}) {
  const coordinator=new RootCoordinator(ctx);
  coordinator.install();
  const adapter=new DshAdapter(ctx,{exclusiveDataRoot:config.exclusiveDataRoot===true,coordinator}),cleaner=new Cleaner(adapter);
  adapter.releaseBridge=new SessionReleaseBridge(ctx,coordinator);
  adapter.releaseBridge.install();
  coordinator.beforeMutation=()=>adapter.checkRegistry?.();
  installProvenance(ctx,adapter);
  for(const action of ['plan','commit','restore','operations','diagnostics'])ctx.effect(()=>ctx.webServer.register({kind:'exact',path:prefix+action,handler:makeHandler(ctx,cleaner,action)}),'conversation-cleaner: '+action);
  ctx.logger?.info?.('conversation-cleaner: host routes ready; data root '+adapter.root+'; coordinated='+coordinator.supported+(coordinator.reason?' ('+coordinator.reason+')':''));
}
