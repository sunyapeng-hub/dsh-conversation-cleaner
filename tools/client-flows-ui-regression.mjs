// Isolated NEXT UI regression. Every cleaner request is mocked in this page;
// this script never deletes, restores or purges stored conversations.
// Run after installing the candidate in the isolated host:
// node tools/client-flows-ui-regression.mjs [--cdp=http://127.0.0.1:39119] [--session=session-...]
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const option=name=>process.argv.find(arg=>arg.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const browser=await chromium.connectOverCDP(option('cdp')??'http://127.0.0.1:39119');
const page=browser.contexts().flatMap(context=>context.pages()).find(value=>value.url()==='dsh-app://app/');
assert.ok(page,'The isolated NEXT app page must be open.');
const checks=[];const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
let patched=false;const viewport=page.viewportSize();
const labels={menu:/^(Delete conversation|删除对话)$/,history:/^(Deletion history and recovery|删除记录与恢复)$/,remove:/^(Delete|删除)$/,restore:/^(Restore|恢复)$/,restored:/^(Restored|已恢复)$/,close:/^(Close|关闭)$/,cancel:/^(Cancel|取消)$/,ungrouped:/^(Restore as ungrouped conversation|恢复为未分组对话)$/,purge:/^(Continue permanent deletion|继续永久清理)$/,compact:/^(Clean old remnants|清理旧残留)$/};
try {
  await page.keyboard.press('Escape');
  const existing=page.locator('.dcc-modal');
  if(await existing.count())await existing.locator('.dcc-footer').getByRole('button',{name:labels.close}).click();
  await page.evaluate(()=>{
    if(window.__dccUiRegression)throw Error('An earlier regression fetch patch is still active.');
    const original=window.fetch,realNow=Date.now;
    const state=window.__dccUiRegression={original,realNow,offset:0,calls:[],missingWorkspace:false,purgeFailed:true,operations:[
      {operationId:'ui-recover-only',state:'QUARANTINED',createdAt:realNow(),mode:'chat_only',files:3,restorable:true,title:'Synthetic recovery record'},
      {operationId:'ui-purge-only',state:'PURGING',createdAt:realNow(),mode:'full',files:4,canResumePurge:true,title:'Synthetic purge record'},
      {operationId:'ui-old-only',state:'RESTORED',createdAt:realNow(),mode:'chat_only',files:2,canCompact:true}
    ]};
    Date.now=()=>realNow()+state.offset;
    window.fetch=async(input,init)=>{
      const url=String(input);
      if(!url.includes('/dsh-conversation-cleaner/v1/'))return original(input,init);
      const action=url.split('/').pop(),body=JSON.parse(init.body);state.calls.push({action,body,at:Date.now()});
      const success=data=>new Response(JSON.stringify({ok:true,...data}),{headers:{'content-type':'application/json'}});
      const failure=code=>new Response(JSON.stringify({ok:false,code}),{status:409,headers:{'content-type':'application/json'}});
      if(action==='plan')return success({planId:'ui-plan-'+state.calls.length,confirmation:'ui-confirmation',expiresAt:Date.now()+1500,blockers:[],children:[],counts:{files:160,bytes:160},session:{cwd:'Synthetic fixture only',logBytes:160},candidates:Array.from({length:160},(_,index)=>({path:'synthetic/item-'+index,size:1})),preserved:[]});
      if(action==='commit')return success({operationId:'ui-recover-only',restorable:true});
      if(action==='operations')return success({pending:['ui-purge-only'].filter(id=>state.operations.some(op=>op.operationId===id&&op.canResumePurge)),operations:state.operations});
      const operation=state.operations.find(op=>op.operationId===body.operationId);
      if(!operation)return failure('OPERATION_NOT_FOUND');
      if(action==='restore'){
        if(state.missingWorkspace&&!body.ungrouped)return failure('RESTORE_WORKSPACE_MISSING');
        Object.assign(operation,{state:'RESTORED',restorable:false});delete operation.title;return success({});
      }
      if(action==='purge'){
        if(state.purgeFailed){state.purgeFailed=false;return failure('PURGE_INCOMPLETE');}
        Object.assign(operation,{state:'PERMANENT',canResumePurge:false});delete operation.title;return success({});
      }
      if(action==='compact'){operation.canCompact=false;return success({});}
      throw Error('Unexpected cleaner action '+action);
    };
  });patched=true;
  const id=option('session');
  const row=id?page.locator('[data-row-key="session:'+id+'"]'):page.locator('[data-row-key^="session:"]').first();
  await expect(row).toBeVisible();
  const openMenu=async label=>{await row.hover();await row.getByRole('button',{name:/Session actions|会话.*操作/}).click();await page.getByRole('menuitem',{name:label}).click();};
  await openMenu(labels.menu);let dialog=page.getByRole('dialog',{name:labels.menu});
  await expect(dialog.locator('.dcc-danger')).toBeEnabled();
  await expect.poll(()=>page.evaluate(()=>window.__dccUiRegression.calls.filter(call=>call.action==='plan').length)).toBeGreaterThanOrEqual(2);
  checks.push('preview automatically refreshed before expiry');
  await expect(dialog.locator('.dcc-danger')).toBeEnabled();
  const before=await page.evaluate(()=>{const state=window.__dccUiRegression;const count=state.calls.filter(call=>call.action==='commit').length;state.offset+=3000;return count;});
  await dialog.locator('.dcc-danger').click();
  await expect(dialog.locator('.dcc-danger')).toBeEnabled();
  assert.equal(await page.evaluate(()=>window.__dccUiRegression.calls.filter(call=>call.action==='commit').length),before);
  checks.push('expired click refreshed preview without commit');
  await dialog.locator('summary').click();
  for(const height of [800,600]){
    await page.setViewportSize({width:1280,height});
    const buttons=dialog.locator('.dcc-footer button');
    for(const button of await buttons.all()){const box=await button.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=height,'fixed footer at '+height);}
  }
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  checks.push('long preview scrolls with visible footer; no typed or extra acknowledgement');
  await page.screenshot({path:'evidence/screenshots/rc10-next-fixed-footer.png',fullPage:true});
  await expect(dialog.locator('.dcc-danger')).toBeEnabled();await dialog.locator('.dcc-danger').click();
  await expect(dialog.getByRole('status')).toHaveText(/^(Deleted|已删除)$/);
  await page.evaluate(()=>window.__dccUiRegression.missingWorkspace=true);
  await dialog.getByRole('button',{name:labels.restore}).click();await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button',{name:labels.ungrouped})).toBeVisible();
  await dialog.getByRole('button',{name:labels.ungrouped}).click();await expect(dialog.getByRole('status')).toHaveText(labels.restored);
  const restores=await page.evaluate(()=>window.__dccUiRegression.calls.filter(call=>call.action==='restore').map(call=>call.body));
  assert.deepEqual(restores,[{operationId:'ui-recover-only',acknowledged:true},{operationId:'ui-recover-only',acknowledged:true,ungrouped:true}]);
  checks.push('direct restore with explicit ungrouped retry and actual restored status');
  await dialog.locator('.dcc-footer').getByRole('button',{name:labels.close}).click();
  await openMenu(labels.history);dialog=page.getByRole('dialog',{name:labels.history});
  await expect(dialog.getByRole('combobox')).toBeVisible();
  await dialog.getByRole('combobox').selectOption('ui-purge-only');await dialog.getByRole('button',{name:labels.purge}).click();
  await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button',{name:labels.purge}).click();await expect(dialog.getByRole('button',{name:labels.purge})).toHaveCount(0);
  await dialog.getByRole('combobox').selectOption('ui-old-only');await dialog.getByRole('button',{name:labels.compact}).click();await expect(dialog.getByRole('button',{name:labels.compact})).toHaveCount(0);
  const actions=await page.evaluate(()=>window.__dccUiRegression.calls.filter(call=>['purge','compact'].includes(call.action)).map(call=>({action:call.action,body:call.body})));
  assert.deepEqual(actions,[{action:'purge',body:{operationId:'ui-purge-only',acknowledged:true}},{action:'purge',body:{operationId:'ui-purge-only',acknowledged:true}},{action:'compact',body:{operationId:'ui-old-only',acknowledged:true}}]);
  checks.push('history retries incomplete purge and compacts only selected operation');
  await expect(dialog.locator('input')).toHaveCount(0);await dialog.locator('.dcc-footer').getByRole('button',{name:labels.close}).click();
  assert.deepEqual(errors,[]);const report={status:'PASS',version:JSON.parse(await fs.readFile('package.json','utf8')).version,finishedAt:new Date().toISOString(),scope:'Real isolated NEXT primitives with mocked cleaner API only; no storage mutations',checks,screenshots:['evidence/screenshots/rc10-next-fixed-footer.png']};await fs.writeFile('evidence/rc10-client-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
  if(patched){await page.keyboard.press('Escape').catch(()=>{});await page.evaluate(()=>{const state=window.__dccUiRegression;if(state){window.fetch=state.original;Date.now=state.realNow;delete window.__dccUiRegression;}});}
  if(viewport)await page.setViewportSize(viewport);page.off('pageerror',onError);await browser.close();
}

