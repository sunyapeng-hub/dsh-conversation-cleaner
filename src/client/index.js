window.__ModuleLoader__.load({
  id:'dsh-conversation-cleaner',
  factory(require) {
    const React=require('react'),ui=require('@deepseek-ai/dsh-client-ui-primitives');
    const h=React.createElement,NS='dsh-conversation-cleaner';
    const en={menu:'Delete conversation',title:'Delete conversation',scope:'Deletion scope',chat_only:'Conversation only',chat_and_outputs:'Conversation + generated files',full:'Conversation + generated files + orphan attachments',a:'Remove logs and indexes. Keep workspace files and attachments.',b:'Remove only files with verified creation evidence. Keep existing and Git tracked files.',c:'Shared attachments are preserved. Missing reference evidence blocks this mode.',id:'Session ID',cwd:'Working directory',logs:'Conversation data',outputs:'Generated files',attachments:'Attachments',children:'Also delete child agent sessions',list:'Review file list',keep:'Preserved',cancel:'Cancel',remove:'Delete conversation',busy:'Deleting…',loading:'Preparing a read-only plan…',ack:'I understand: deletion may be irreversible',quarantine:'Move to the private quarantine area. Restore using the operation ID.',permanent:'Permanently delete',confirmPermanent:'Type DELETE to confirm permanent deletion',unknown:'Unknown / not scanned',blocked:'This deletion is blocked',retry:'Refresh preview',done:'Deletion verified',error:'Operation failed',restore:'Recovery operation ID',close:'Close',files:'files',why:'Reason',scopeChanged:'The scope changed. Review and confirm again.'};
    const zh={menu:'删除对话',title:'删除对话',scope:'删除范围',chat_only:'仅删除对话记录',chat_and_outputs:'对话记录 + 产出文件',full:'全部清理：对话 + 产出文件 + 孤儿附件',a:'清理会话日志和索引，工作区文件与附件保留。',b:'仅清理有创建归属证据的文件，已有文件和 Git 跟踪文件保留。',c:'共享附件保留；缺少完整引用证据时阻止本次清理。',id:'会话 ID',cwd:'工作目录',logs:'对话记录',outputs:'本对话产出的文件',attachments:'附件对象',children:'同时删除子 Agent 会话',list:'查看待处理清单',keep:'保留项目',cancel:'取消',remove:'删除对话',busy:'正在删除…',loading:'正在生成只读清单…',ack:'我已知晓：删除可能无法恢复',quarantine:'默认移入私有隔离区，可使用操作 ID 恢复。',permanent:'永久删除',confirmPermanent:'输入 DELETE，再次确认永久删除',unknown:'未知 / 尚未扫描',blocked:'当前删除被阻止',retry:'重新预览',done:'删除结果已核验',error:'操作失败',restore:'恢复操作 ID',close:'关闭',files:'项',why:'原因',scopeChanged:'范围已改变，请重新核对并确认风险。'};
    const reasons={SESSION_BUSY:['会话仍被宿主持有，请先关闭或切换会话后重试。','The session is still held by a host. Close or switch away, then retry.'],PROVENANCE_UNKNOWN:['历史会话没有完整文件归属记录，无法执行产出文件清理。','The session has no complete file ownership evidence.'],OTHER_SESSION_PROVENANCE_UNKNOWN:['同一工作区的其他会话缺少完整归属记录。','Another workspace session has incomplete ownership evidence.'],ATTACHMENT_REFERENCE_BARRIER_UNAVAILABLE:['当前宿主没有附件全局引用锁，无法证明附件可以安全删除。','This host has no global attachment reference barrier.'],PLAN_CHANGED:['文件或会话信息已变化，请重新预览。','Files or session metadata changed. Refresh the preview.'],PLAN_EXPIRED:['预览已过期，请重新预览。','The preview expired. Refresh it.'],RECOVERY_REQUIRED:['存在未完成事务，请先按恢复文档处理。','An interrupted operation requires recovery first.']};
    Object.assign(reasons,{
      DATA_ROOT_EXCLUSIVITY_REQUIRED:['此开发包仅支持独占数据目录；请先按安装文档配置单宿主维护环境。','This development build requires an exclusive data root. See installation instructions.'],
      OUTPUT_REFERENCE_BARRIER_UNAVAILABLE:['宿主缺少产出文件的全局引用锁，本次产出文件清理不可执行。','The host has no global output reference barrier; output deletion is unavailable.'],
      ROOT_COORDINATION_REQUIRED:['当前宿主版本不支持所需的协作锁，无法执行深度清理。','This host version does not support the coordination required for deep cleanup.'],
      REGISTRY_EXTERNAL_CHANGE_RESTART_REQUIRED:['其他宿主更改了工作区索引，请重启当前宿主后重试。','Another host changed the workspace index. Restart this host and retry.'],
      REGISTRY_BACKEND_UNSUPPORTED:['当前工作区存储不支持清理，请检查宿主版本。','This workspace storage backend is unsupported. Check the host version.'],
      STAGED_UPLOADS_UNSUPPORTED:['当前宿主的未发送附件暂存接口不受支持，无法证明附件可安全删除。','This host has an unsupported pending-upload store. Attachment deletion cannot be proved safe.'],
      QUARANTINE_REFERENCE_UNKNOWN:['旧隔离事务缺少引用记录，请先恢复旧事务后重试深度清理。','An older recoverable operation lacks reference metadata. Restore it before deep cleanup.'],
      CORPUS_REFERENCE_UNREADABLE:['数据目录中存在无法读取的会话日志，请先修复该日志再进行深度清理。','A stored conversation log is unreadable. Repair it before deep cleanup.'],
      SHARED_OUTPUT:['其他会话仍引用此文件。','Another conversation still references this file.'],
      SHARED_ATTACHMENT:['其他会话仍引用此附件。','Another conversation still references this attachment.'],
      GIT_TRACKED:['Git 跟踪文件予以保留。','Git tracked files are retained.']
    });
    let request=null;const listeners=new Set();
    const notify=()=>listeners.forEach(f=>f(request));
    async function post(action,body,signal) {
      const res=await fetch('/dsh-conversation-cleaner/v1/'+action,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});
      const data=await res.json();if(!res.ok || !data.ok)throw new Error(data.code??data.message??String(res.status));return data;
    }
    function Menu({sessionId,displayTitle,useMenuOpenState,t}) {
      const [,setOpen]=useMenuOpenState();
      return h(ui.MenuItemButton,{danger:true,separatorBefore:true,onSelect:()=>{setOpen(false);request={sessionId,title:displayTitle||(t('menu')==='删除对话'?'未命名对话':'Untitled conversation'),nonce:Date.now()};notify();}},t('menu'));
    }
    function Dialog({t}) {
      const [selected,setSelected]=React.useState(request);
      React.useEffect(()=>{listeners.add(setSelected);return()=>listeners.delete(setSelected);},[]);
      return selected?h(DialogBody,{key:selected.nonce,selected,t}):null;
    }
    function DialogBody({selected,t}) {
      const [mode,setMode]=React.useState('chat_only'),[children,setChildren]=React.useState(false),[plan,setPlan]=React.useState(null),[ack,setAck]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[revision,setRevision]=React.useState(0),[permanent,setPermanent]=React.useState(false),[word,setWord]=React.useState(''),[result,setResult]=React.useState(null);
      const inFlight=React.useRef(false);
      const chinese=t('menu')==='删除对话';
      const reason=code=>reasons[code]?.[chinese?0:1]??code;
      React.useEffect(()=>{
        const controller=new AbortController();setPlan(null);setAck(false);setError('');
        post('plan',{sessionId:selected.sessionId,mode,includeDescendants:children},controller.signal).then(setPlan).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
        return()=>controller.abort();
      },[mode,children,revision]);
      const close=()=>{if(!inFlight.current){request=null;notify();}};
      const submit=async()=>{
        if(inFlight.current || !plan || !ack || plan.blockers.length || (permanent && word!=='DELETE'))return;
        inFlight.current=true;setBusy(true);setError('');
        try{const response=await post('commit',{planId:plan.planId,confirmation:plan.confirmation,acknowledged:true,permanent,permanentConfirmation:word});setResult(response);}
        catch(e){setError(e.message);setAck(false);}
        finally{inFlight.current=false;setBusy(false);}
      };
      const fmt=n=>n==null?t('unknown'):new Intl.NumberFormat().format(n)+' B';
      const body=result?h('div',{className:'dcc-success',role:'status'},h('p',null,t('done')),h('p',null,t('restore')),h('code',null,result.operationId),h('p',null,result.restorable?t('quarantine'):t('permanent'))):h(React.Fragment,null,
        h('p',{className:'dcc-sub'},selected.title),
        h('dl',{className:'dcc-meta'},h('dt',null,t('id')),h('dd',null,selected.sessionId),h('dt',null,t('cwd')),h('dd',null,plan?.session.cwd??t('unknown')),h('dt',null,t('logs')),h('dd',null,fmt(plan?.session.logBytes)),h('dt',null,t('outputs')),h('dd',null,mode==='chat_only'?t('unknown'):String(plan?.counts.outputs??t('unknown'))),h('dt',null,t('attachments')),h('dd',null,mode==='full'&&plan?String(plan.session.attachmentCount):t('unknown'))),
        h('fieldset',{disabled:busy,className:'dcc-modes'},h('legend',null,t('scope')),['chat_only','chat_and_outputs','full'].map((value,i)=>h('label',{key:value,className:'dcc-mode'},h('input',{type:'radio',name:'dcc-mode',value,checked:mode===value,onChange:()=>{setAck(false);setPlan(null);setMode(value);}}),h('span',null,h('strong',null,t(value)),h('small',null,t(['a','b','c'][i])))))),
        (plan?.children?.length>0 || children)&&h('label',{className:'dcc-check'},h('input',{type:'checkbox',checked:children,disabled:busy,onChange:e=>{setAck(false);setPlan(null);setChildren(e.target.checked);}}),t('children')+' ('+(plan?.children?.length??'…')+')'),
        !plan&&!error&&h('p',{role:'status'},t('loading')),
        plan&&h('details',null,h('summary',null,t('list')+' · '+plan.counts.files+' '+t('files')+' · '+fmt(plan.counts.bytes)),h('ul',{className:'dcc-list'},plan.candidates.map(u=>h('li',{key:u.path},h('code',null,u.path),' · '+fmt(u.size))),plan.preserved.map(u=>h('li',{key:u.path},t('keep')+': ',h('code',null,u.path),' — '+reason(u.reason))))),
        plan?.blockers?.length>0&&h('div',{className:'dcc-warning',role:'alert'},h('strong',null,t('blocked')),h('ul',null,plan.blockers.map(code=>h('li',{key:code},reason(code))))),
        h('p',{className:'dcc-warning'},t('quarantine')),
        h('label',{className:'dcc-check'},h('input',{type:'checkbox',checked:permanent,disabled:busy,onChange:e=>{setPermanent(e.target.checked);setAck(false);setWord('');}}),t('permanent')),
        permanent&&h('label',{className:'dcc-confirm'},t('confirmPermanent'),h('input',{value:word,disabled:busy,onChange:e=>setWord(e.target.value),autoComplete:'off','aria-label':t('confirmPermanent')})),
        h('label',{className:'dcc-check'},h('input',{type:'checkbox',checked:ack,disabled:busy||!plan||plan.blockers.length>0,onChange:e=>setAck(e.target.checked)}),t('ack')),
        error&&h('p',{className:'dcc-error',role:'alert'},t('error')+': '+reason(error)),
        !busy&&h('button',{type:'button',className:'dcc-refresh',onClick:()=>setRevision(r=>r+1)},t('retry'))
      );
      return h(ui.Modal,{open:true,onClose:close,title:t('title'),closeLabel:t('close'),className:'dcc-modal',footer:h('div',{className:'dcc-footer'},h('button',{type:'button',disabled:busy,onClick:close},t(result?'close':'cancel')),!result&&h('button',{type:'button',className:'dcc-danger',disabled:busy||!plan||!ack||plan.blockers.length>0||(permanent&&word!=='DELETE'),onClick:submit},t(busy?'busy':'remove')))},body);
    }
    const css=`.dcc-modal{width:min(620px,calc(100vw - 28px));max-height:calc(100dvh - 32px)}.dcc-modal *{box-sizing:border-box}.dcc-sub{opacity:.7;overflow-wrap:anywhere}.dcc-meta{display:grid;grid-template-columns:130px minmax(0,1fr);gap:8px;font-size:12px}.dcc-meta dt{opacity:.65}.dcc-meta dd{margin:0;overflow-wrap:anywhere}.dcc-modes{border:0;padding:0;margin:22px 0 12px}.dcc-modes legend{font-size:13px;font-weight:600;margin-bottom:8px}.dcc-mode{display:flex;gap:10px;cursor:pointer;padding:12px;border:1px solid transparent;border-radius:8px}.dcc-mode:has(input:checked){background:color-mix(in srgb,currentColor 5%,transparent);border-color:color-mix(in srgb,currentColor 12%,transparent)}.dcc-mode strong{font-size:13px}.dcc-mode small{display:block;opacity:.65;line-height:1.6;margin-top:4px}.dcc-mode input{margin-top:3px;accent-color:#dc433b}.dcc-warning{font-size:12px;line-height:1.6;padding:10px 12px;background:#e8a82e18;border:1px solid #e8a82e45;border-radius:8px}.dcc-check{display:flex;align-items:flex-start;gap:8px;font-size:12px;margin:14px 0;line-height:1.6}.dcc-check input{accent-color:#d6423a;margin-top:3px}.dcc-modal details{font-size:12px;margin:12px 0}.dcc-list{max-height:180px;overflow:auto;padding-left:20px;overflow-wrap:anywhere}.dcc-list li{padding:5px 0}.dcc-footer{display:flex;justify-content:flex-end;gap:10px}.dcc-footer button,.dcc-refresh{font:inherit;font-size:12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:7px;background:transparent;color:inherit;padding:8px 14px;cursor:pointer}.dcc-footer .dcc-danger{background:#d6423a;border-color:#d6423a;color:#fff}.dcc-footer button:disabled{opacity:.4;cursor:not-allowed}.dcc-error{font-size:12px;color:#e65c52;overflow-wrap:anywhere}.dcc-confirm{display:grid;gap:6px;font-size:12px}.dcc-confirm input{padding:7px;color:inherit;background:transparent;border:1px solid #9998;border-radius:5px}.dcc-success{padding:16px 0;overflow-wrap:anywhere}`;
    function apply(ctx) {
      ctx.effect(()=>ctx.locale.register(NS,{en,zh}),'conversation-cleaner locale');
      ctx.effect(()=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);return()=>{style.remove();request=null;listeners.clear();};});
      ctx.slots.inject('sidebar.workspaces.session.menu.item',()=>ctx.slots.register({name:'sidebar.workspaces.session.menu.item',id:NS,order:500,locale:NS},Menu));
      ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:NS,locale:NS},Dialog));
    }
    return {inject:['slots','locale'],apply};
  }
});
