import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const source=await fs.readFile(new URL('../src/client/index.js',import.meta.url),'utf8');
function harness(handler) {
  const instances=new Map(),slots={},calls=[],timers=new Map();let current,index,clock=10000,nextTimer=1,definition;
  const React={Fragment:Symbol('fragment'),createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),useState(initial){const owner=current,n=index++;if(!(n in owner.values))owner.values[n]=initial;return [owner.values[n],value=>{owner.values[n]=typeof value==='function'?value(owner.values[n]):value;}];},useRef(initial){const n=index++;return current.values[n]??=({current:initial});},useEffect(effect,deps){const n=index++,old=current.values[n];if(!old||deps.some((v,i)=>v!==old.deps[i])){current.effects.push(()=>{old?.cleanup?.();current.values[n]={deps,cleanup:effect()};});}}};
  const ui={MenuItemButton:'menuitem',Modal:'modal'},FakeDate=class extends Date {static now(){return clock;}};
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load(value){definition=value;}}},document:{},Date:FakeDate,Intl,AbortController,setTimeout:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,init)=>{const action=url.split('/').pop(),body=JSON.parse(init.body);calls.push({action,body,signal:init.signal});try{return {ok:true,json:async()=>await handler(action,body,calls)}}catch(error){throw error;}}});
  definition.factory(name=>name==='react'?React:ui).apply({effect:()=>{},slots:{inject:(_name,fn)=>fn(),register:(options,component)=>{slots[options.name]=component;}}});
  const t=key=>({recoverable:'可恢复',purgeUnfinished:'清理未完成',restoreFailed:'恢复失败',permanentlyDeleted:'已永久删除',processing:'处理中',menu:'删除对话',remove:'删除',done:'已删除',restoreAction:'恢复',restored:'已恢复',history:'删除记录与恢复',ungrouped:'恢复为未分组对话',resumePurge:'继续永久清理',compact:'清理旧残留',retry:'重新预览',close:'关闭',cancel:'取消'})[key]??key;
  function render(component,props={},name=component.name){let owner=instances.get(name);if(!owner){owner={values:[],effects:[]};instances.set(name,owner);}current=owner;index=0;const tree=component(props);while(owner.effects.length)owner.effects.shift()();return tree;}
  function menu(){return render(slots['sidebar.workspaces.session.menu.item'],{sessionId:'chosen-session',displayTitle:'Chosen',useMenuOpenState:()=>[true,()=>{}],t});}
  function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of tree.children??[]){const value=find(child,predicate);if(value)return value;}return null;}
  function textOf(tree){return typeof tree==='string'?tree:(tree?.children??[]).map(textOf).join('');}
  function button(tree,label){return find(tree,node=>(node.type==='button'||node.type==='menuitem')&&textOf(node)===label);}
  let bodyType,bodyProps;
  function open(history=false){const item=button(menu(),history?'删除记录与恢复':'删除对话');assert.ok(item,'menu entry '+(history?'history':'delete'));item.props.onSelect();const dialog=render(slots['shell.overlay'],{t});bodyType=dialog.type;bodyProps=dialog.props;return body();}
  function body(){return render(bodyType,bodyProps);}
  async function settle(){for(let i=0;i<16;i++){await Promise.resolve();body();}return body();}
  function all(tree){return [tree,...(tree?.children??[]).flatMap(child=>typeof child==='object'?all(child):[])];}
  function footer(tree){return tree.props.footer;}
  function unmount(){for(const owner of instances.values())for(const hook of owner.values)hook?.cleanup?.();}
  function pluginAction(name='dsh-conversation-cleaner'){assert.ok(slots['plugins.detail.actions'],'plugin details recovery entry');return render(slots['plugins.detail.actions'],{subject:{kind:'bundle',pkg:{name}},t});}
  function openFromPlugin(){const action=pluginAction();button(action,'删除记录与恢复').props.onClick();const dialog=render(slots['shell.overlay'],{t});bodyType=dialog.type;bodyProps=dialog.props;return body();}
  return {open,openFromPlugin,pluginAction,body,settle,button,find,textOf,footer,all,calls,timers,unmount,setClock:value=>clock=value,advance:async(ms)=>{clock+=ms;const due=[...timers].filter(([,v])=>v.at<=clock);for(const[id,v]of due){timers.delete(id);v.fn();}body();for(let i=0;i<8;i++)await Promise.resolve();return body();}};
}
const plan=(id='plan-1',expiresAt=20000)=>({ok:true,planId:id,confirmation:'confirm-'+id,expiresAt,blockers:[],children:[],counts:{files:1,bytes:3},session:{cwd:'fixture',logBytes:3},candidates:[],preserved:[]});
const ok={ok:true};

test('plugin details opens recovery without any session and excludes other packages',async()=>{
  const h=harness(()=>({ok:true,pending:[],operations:[]}));assert.equal(h.pluginAction('another-plugin'),null);h.openFromPlugin();const tree=await h.settle();assert.equal(h.calls[0].action,'operations');assert.ok(h.button(h.footer(tree),'关闭'));h.unmount();
});

test('preview refreshes before expiry and cleans timer on unmount',async()=>{
  const h=harness(action=>action==='plan'?plan():ok);h.open();await h.settle();assert.equal(h.timers.size,1);await h.advance(9001);assert.equal(h.calls.filter(c=>c.action==='plan').length,2);h.unmount();assert.equal(h.timers.size,0);
});
test('submit never sends an expired plan even if its timer has not run',async()=>{
  const h=harness(action=>action==='plan'?plan():ok);h.open();const tree=await h.settle();h.setClock(20001);await h.button(h.footer(tree),'删除').props.onClick();await h.settle();assert.equal(h.calls.filter(c=>c.action==='commit').length,0);assert.equal(h.calls.filter(c=>c.action==='plan').length,2);h.unmount();
});
test('temporary plan error can be retried and scope change clears preview immediately',async()=>{
  let count=0;const h=harness(action=>{if(action==='plan'&&++count===1)throw Error('TEMPORARY');return plan();});h.open();let tree=await h.settle();assert.ok(h.button(tree,'重新预览'));h.button(tree,'重新预览').props.onClick();h.body();tree=await h.settle();assert.equal(h.button(h.footer(tree),'删除').props.disabled,false);h.find(tree,n=>n.type==='input'&&n.props.value==='full').props.onChange();tree=h.body();assert.equal(h.button(h.footer(tree),'删除').props.disabled,true);h.unmount();
});
test('successful deletion offers direct restore and explicit ungrouped recovery',async()=>{
  const h=harness((action,body)=>{if(action==='plan')return plan();if(action==='commit')return {...ok,operationId:'chosen-op',restorable:true};if(action==='restore'&&!body.ungrouped)throw Error('RESTORE_WORKSPACE_MISSING');return ok;});h.open();let tree=await h.settle();await h.button(h.footer(tree),'删除').props.onClick();tree=await h.settle();assert.ok(h.button(tree,'恢复'));await h.button(tree,'恢复').props.onClick();tree=await h.settle();assert.ok(h.button(tree,'恢复为未分组对话'));await h.button(tree,'恢复为未分组对话').props.onClick();tree=await h.settle();assert.match(h.textOf(tree),/已恢复/);assert.deepEqual(h.calls.filter(c=>c.action==='restore').map(c=>c.body),[{operationId:'chosen-op',acknowledged:true},{operationId:'chosen-op',acknowledged:true,ungrouped:true}]);h.unmount();
});
test('history acts only on selected operation and refreshes after purge or compact',async()=>{
  const operations=[{operationId:'recover-op',state:'QUARANTINED',createdAt:1,files:2,restorable:true},{operationId:'purge-op',state:'PURGING',createdAt:2,files:3,canResumePurge:true},{operationId:'old-op',state:'RESTORED',createdAt:3,files:4,canCompact:true}];
  const h=harness(action=>action==='operations'?{...ok,pending:['purge-op'],operations}:ok);h.open(true);let tree=await h.settle();const select=h.find(tree,n=>n.type==='select');assert.ok(select);select.props.onChange({target:{value:'purge-op'}});tree=h.body();await h.button(h.footer(tree),'继续永久清理').props.onClick();tree=await h.settle();h.find(tree,n=>n.type==='select').props.onChange({target:{value:'old-op'}});tree=h.body();await h.button(h.footer(tree),'清理旧残留').props.onClick();await h.settle();assert.deepEqual(h.calls.filter(c=>c.action==='purge'||c.action==='compact').map(c=>({action:c.action,body:c.body})),[{action:'purge',body:{operationId:'purge-op',acknowledged:true}},{action:'compact',body:{operationId:'old-op',acknowledged:true}}]);assert.ok(h.calls.filter(c=>c.action==='operations').length>=3);h.unmount();
});
test('failed commit exposes recovery manager and never displays deleted status',async()=>{
  const h=harness(action=>{if(action==='plan')return plan();if(action==='commit')throw Error('RECOVERY_REQUIRED');return {ok:true,pending:[],operations:[]};});h.open();let tree=await h.settle();await h.button(h.footer(tree),'删除').props.onClick();tree=await h.settle();assert.ok(h.button(tree,'删除记录与恢复'));assert.doesNotMatch(h.textOf(tree),/已删除/);h.unmount();
});

test('late preview response from old scope cannot replace current scope',async()=>{
  let resolveFirst;let first=true;const h=harness(action=>{if(action==='plan'&&first){first=false;return new Promise(resolve=>resolveFirst=resolve);}return plan('new-plan');});h.open();let tree=h.body();h.find(tree,n=>n.type==='input'&&n.props.value==='full').props.onChange();h.body();tree=await h.settle();resolveFirst(plan('old-plan'));tree=await h.settle();await h.button(h.footer(tree),'删除').props.onClick();assert.equal(h.calls.find(c=>c.action==='commit').body.planId,'new-plan');assert.equal(h.calls.filter(c=>c.action==='plan')[0].signal.aborted,true);h.unmount();
});
test('commit in-flight guard blocks repeated clicks and allows retry after failure',async()=>{
  let rejectCommit;const h=harness(action=>action==='plan'?plan():new Promise((_,reject)=>rejectCommit=reject));h.open();let tree=await h.settle();const remove=h.button(h.footer(tree),'删除');const pending=remove.props.onClick();remove.props.onClick();assert.equal(h.calls.filter(c=>c.action==='commit').length,1);await h.settle();rejectCommit(Error('TEMPORARY'));await pending;tree=await h.settle();h.button(tree,'重新预览').props.onClick();h.body();tree=await h.settle();assert.equal(h.button(h.footer(tree),'删除').props.disabled,false);h.unmount();
});
test('failed automatic refresh leaves a retry and no stale commit available',async()=>{
  let plans=0;const h=harness(action=>{if(action==='plan'&&++plans===2)throw Error('TEMPORARY');return plan('plan-'+plans);});h.open();await h.settle();let tree=await h.advance(9001);assert.ok(h.button(tree,'重新预览'));assert.equal(h.button(h.footer(tree),'删除').props.disabled,true);h.button(tree,'重新预览').props.onClick();h.body();tree=await h.settle();assert.equal(h.button(h.footer(tree),'删除').props.disabled,false);h.unmount();
});
test('history restore failures stay actionable without false success, and ungrouped is explicit',async()=>{
  let restored=false;const operation={operationId:'recover-op',state:'QUARANTINED',createdAt:1,files:2,restorable:true};const h=harness((action,body)=>{if(action==='operations')return {ok:true,pending:[],operations:[restored?{...operation,state:'RESTORED',restorable:false}:operation]};if(action==='restore'&&!body.ungrouped)throw Error('RESTORE_WORKSPACE_MISSING');restored=true;return ok;});h.open(true);let tree=await h.settle();assert.equal(h.button(h.footer(tree),'恢复为未分组对话'),null);await h.button(h.footer(tree),'恢复').props.onClick();tree=await h.settle();assert.doesNotMatch(h.textOf(tree),/已恢复/);await h.button(h.footer(tree),'恢复为未分组对话').props.onClick();tree=await h.settle();assert.match(h.textOf(tree),/已恢复/);assert.equal(h.button(h.footer(tree),'恢复'),null);assert.equal(h.calls.filter(c=>c.action==='restore').length,2);h.unmount();
});
test('history purge failure keeps retry for the same operation and never succeeds falsely',async()=>{
  const h=harness(action=>{if(action==='operations')return {ok:true,pending:['chosen-op'],operations:[{operationId:'chosen-op',state:'PURGING',createdAt:1,files:2,canResumePurge:true}]};throw Error('PURGE_INCOMPLETE');});h.open(true);let tree=await h.settle();await h.button(h.footer(tree),'继续永久清理').props.onClick();tree=await h.settle();assert.doesNotMatch(h.textOf(tree),/recoveryDone/);assert.ok(h.button(h.footer(tree),'继续永久清理'));assert.equal(h.find(tree,n=>n.props.role==='status'),null);h.unmount();
});
test('deletion and history keep a single action confirmation without typed or acknowledgement inputs',async()=>{
  const h=harness(action=>action==='plan'?plan():{ok:true,pending:[],operations:[]});h.open();let tree=await h.settle();const inputs=h.all(tree).filter(n=>n?.type==='input');assert.ok(inputs.every(n=>['radio','checkbox'].includes(n.props.type)));assert.equal(inputs.filter(n=>n.props.type==='checkbox').length,1);assert.equal(h.all(tree).filter(n=>n?.type==='input'&&n.props.type==='text').length,0);h.unmount();const history=harness(()=>({ok:true,pending:[],operations:[]}));history.open(true);tree=await history.settle();assert.equal(history.all(tree).filter(n=>n?.type==='input').length,0);history.unmount();
});

test('history labels localize states and keep full operation IDs only in folded details',async()=>{
  const states=['VERIFIED','PURGING','RESTORE_FAILED','RESTORED','PERMANENT','RESTORING'];
  const operations=states.map((state,index)=>({operationId:'1234567'+index+'-1234-4234-8234-123456789012',state,createdAt:'2026-11-04T03:04:00.000Z',files:1,...(index===0?{title:'Conversation title',restorable:true}:{})}));
  const h=harness(()=>({ok:true,pending:[],operations}));h.open(true);const tree=await h.settle(),select=h.find(tree,node=>node.type==='select');
  const labels=select.children.map(node=>h.textOf(node));assert.ok(labels[0].includes('Conversation title'));assert.deepEqual(labels.map(value=>value.split(' · ').at(-1)),['可恢复','清理未完成','恢复失败','已恢复','已永久删除','处理中']);
  for(let index=0;index<operations.length;index++){assert.equal(select.children[index].props.value,operations[index].operationId);assert.equal(labels[index].includes(operations[index].operationId),false);assert.equal(labels[index].includes(states[index]),false);}
  assert.ok(labels[3].includes(operations[3].operationId.slice(0,8)));const details=h.find(tree,node=>node.type==='details');assert.ok(details);assert.equal(details.props.open,undefined);assert.ok(h.textOf(details).includes(operations[0].operationId));h.unmount();
});
