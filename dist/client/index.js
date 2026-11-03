window.__ModuleLoader__.load({
  id:'dsh-conversation-cleaner',
  factory(require) {
    const React=require('react'),ui=require('@deepseek-ai/dsh-client-ui-primitives');
    const h=React.createElement,NS='dsh-conversation-cleaner';
    const en={menu:'Delete conversation',title:'Delete conversation',scope:'Deletion scope',chat_only:'Conversation only',chat_and_outputs:'Conversation + generated files',full:'Conversation + generated files + orphan attachments',a:'Remove logs and indexes. Keep workspace files and attachments.',b:'Remove only files with verified creation evidence. Keep existing and Git tracked files.',c:'Shared attachments are preserved. Missing reference evidence blocks this mode.',id:'Session ID',cwd:'Working directory',logs:'Conversation data',outputs:'Generated files',attachments:'Attachments',children:'Also delete child agent sessions',list:'Review file list',keep:'Preserved',cancel:'Cancel',remove:'Delete conversation',busy:'Deleting…',loading:'Preparing a read-only plan…',ack:'I understand: deletion may be irreversible',quarantine:'Move to the private quarantine area. Restore using the operation ID.',permanent:'Permanently delete',unknown:'Unknown / not scanned',blocked:'This deletion is blocked',retry:'Refresh preview',done:'Deletion verified',error:'Operation failed',restore:'Recovery operation ID',close:'Close',files:'files',why:'Reason',scopeChanged:'The scope changed. Review and confirm again.'};
    const zh={menu:'删除对话',title:'删除对话',scope:'删除范围',chat_only:'仅删除对话记录',chat_and_outputs:'对话记录 + 产出文件',full:'全部清理：对话 + 产出文件 + 孤儿附件',a:'清理会话日志和索引，工作区文件与附件保留。',b:'仅清理有创建归属证据的文件，已有文件和 Git 跟踪文件保留。',c:'共享附件保留；缺少完整引用证据时阻止本次清理。',id:'会话 ID',cwd:'工作目录',logs:'对话记录',outputs:'本对话产出的文件',attachments:'附件对象',children:'同时删除子 Agent 会话',list:'查看待处理清单',keep:'保留项目',cancel:'取消',remove:'删除对话',busy:'正在删除…',loading:'正在生成只读清单…',ack:'我已知晓：删除可能无法恢复',quarantine:'默认移入私有隔离区，可使用操作 ID 恢复。',permanent:'永久删除',unknown:'未知 / 尚未扫描',blocked:'当前删除被阻止',retry:'重新预览',done:'删除结果已核验',error:'操作失败',restore:'恢复操作 ID',close:'关闭',files:'项',why:'原因',scopeChanged:'范围已改变，请重新核对并确认风险。'};
    const reasons={SESSION_BUSY:['会话仍被宿主持有，请先关闭或切换会话后重试。','The session is still held by a host. Close or switch away, then retry.'],PROVENANCE_UNKNOWN:['历史会话没有完整文件归属记录，无法执行产出文件清理。','The session has no complete file ownership evidence.'],OTHER_SESSION_PROVENANCE_UNKNOWN:['同一工作区的其他会话缺少完整归属记录。','Another workspace session has incomplete ownership evidence.'],ATTACHMENT_REFERENCE_BARRIER_UNAVAILABLE:['当前宿主没有附件全局引用锁，无法证明附件可以安全删除。','This host has no global attachment reference barrier.'],PLAN_CHANGED:['文件或会话信息已变化，请重新预览。','Files or session metadata changed. Refresh the preview.'],PLAN_EXPIRED:['预览已过期，请重新预览。','The preview expired. Refresh it.'],RECOVERY_REQUIRED:['存在未完成事务，请先按恢复文档处理。','An interrupted operation requires recovery first.']};
    Object.assign(reasons,{
      SESSION_BUSY:['会话正在运行、有待处理内容或被其他宿主占用。','The conversation has active or pending work, or is owned by another host.'],
      SESSION_RELEASE_UNAVAILABLE:['此会话在插件就绪前已加载，请重启宿主后重试。','This conversation was loaded before the plugin was ready. Restart the host and retry.'],
      OTHER_SESSION_PROVENANCE_UNKNOWN:['其他会话缺少完整归属记录。','Other conversations have incomplete ownership evidence.'],
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
    en.permanentWarning='Permanent deletion cannot be restored.';en.permanentRemove='Permanently delete conversation';
    zh.permanentWarning='永久删除后无法恢复。';zh.permanentRemove='永久删除对话';
    reasons.SCAN_LIMIT=['扫描超过数量或大小额度：引用内容上限 256 MiB，单个文件及本次隔离总量上限 32 MiB。','The scan exceeds its count or size limit: 256 MiB for references, 32 MiB per file and quarantine transaction.'];
    reasons.ATTACHMENT_SCAN_LIMIT=['附件引用扫描超过大小或对象数量额度，未执行删除。','The attachment reference scan exceeds its size or object limit. Nothing was deleted.'];
    Object.assign(en,{remove:'Delete',permanentRemove:'Permanently delete',permanent:'Permanently delete (cannot be restored)',done:'Deleted',loading:'Checking…',list:'Details',recoveryInfo:'Recovery details',a:'Workspace files and attachments stay.',b:'Only proven, unshared generated files are removed.',c:'Also remove orphan attachments; shared content stays.'});
    Object.assign(zh,{chat_only:'仅对话',full:'对话 + 产出 + 孤儿附件',remove:'删除',permanentRemove:'永久删除',permanent:'永久删除（无法恢复）',done:'已删除',loading:'正在检查…',list:'详情',recoveryInfo:'恢复信息',a:'保留工作区文件和附件。',b:'仅清理有归属证明、未被共享的产出文件。',c:'另清理孤儿附件，共享内容保留。'});
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
      const [mode,setMode]=React.useState('chat_only'),[children,setChildren]=React.useState(false),[plan,setPlan]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[revision,setRevision]=React.useState(0),[permanent,setPermanent]=React.useState(false),[result,setResult]=React.useState(null);
      const inFlight=React.useRef(false),chinese=t('menu')==='删除对话';
      const reason=code=>reasons[code]?.[chinese?0:1]??code;
      React.useEffect(()=>{
        const controller=new AbortController();setPlan(null);setError('');
        post('plan',{sessionId:selected.sessionId,mode,includeDescendants:children},controller.signal).then(setPlan).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
        return()=>controller.abort();
      },[mode,children,revision]);
      const close=()=>{if(!inFlight.current){request=null;notify();}};
      const ready=!!plan&&!plan.blockers.length&&!error;
      const submit=async()=>{
        if(inFlight.current||!ready)return;
        inFlight.current=true;setBusy(true);
        try{setResult(await post('commit',{planId:plan.planId,confirmation:plan.confirmation,acknowledged:true,permanent}));}
        catch(e){setError(e.message);}
        finally{inFlight.current=false;setBusy(false);}
      };
      const fmt=n=>n==null?t('unknown'):new Intl.NumberFormat().format(n)+' B';
      const body=result?h('div',{className:'dcc-success'},h('p',{role:'status'},t('done')),result.restorable&&h('details',null,h('summary',null,t('recoveryInfo')),h('p',null,t('quarantine')),h('code',null,result.operationId))):h(React.Fragment,null,
        h('p',{className:'dcc-sub'},selected.title),
        h('fieldset',{disabled:busy,className:'dcc-modes'},h('legend',null,t('scope')),['chat_only','chat_and_outputs','full'].map(value=>h('label',{key:value,className:'dcc-mode'},h('input',{type:'radio',name:'dcc-mode',value,checked:mode===value,onChange:()=>{setPlan(null);setMode(value);}}),t(value)))),
        h('p',{className:'dcc-help'},t({chat_only:'a',chat_and_outputs:'b',full:'c'}[mode])),
        (plan?.children?.length>0||children)&&h('label',{className:'dcc-check'},h('input',{type:'checkbox',checked:children,disabled:busy,onChange:e=>{setPlan(null);setChildren(e.target.checked);}}),t('children')+' ('+(plan?.children?.length??'…')+')'),
        !plan&&!error&&h('p',{role:'status',className:'dcc-help'},t('loading')),
        plan&&h('details',{className:'dcc-details'},h('summary',null,t('list')+' · '+plan.counts.files+' '+t('files')+' · '+fmt(plan.counts.bytes)),
          h('dl',{className:'dcc-meta'},h('dt',null,t('id')),h('dd',null,selected.sessionId),h('dt',null,t('cwd')),h('dd',null,plan.session.cwd),h('dt',null,t('logs')),h('dd',null,fmt(plan.session.logBytes)),h('dt',null,t('outputs')),h('dd',null,mode==='chat_only'?t('unknown'):String(plan.counts.outputs)),h('dt',null,t('attachments')),h('dd',null,mode==='full'?String(plan.session.attachmentCount):t('unknown'))),
          h('ul',{className:'dcc-list'},plan.candidates.map(u=>h('li',{key:u.path},h('code',null,u.path),' · '+fmt(u.size))),plan.preserved.map(u=>h('li',{key:u.path},t('keep')+': ',h('code',null,u.path),' — '+reason(u.reason))))),
        plan?.blockers?.length>0&&h('div',{className:'dcc-warning',role:'alert'},plan.blockers.map(code=>h('p',{key:code},reason(code)))),
        error&&h('p',{className:'dcc-error',role:'alert'},reason(error)),
        !busy&&(error||plan?.blockers?.length>0)&&h('button',{type:'button',className:'dcc-refresh',onClick:()=>setRevision(r=>r+1)},t('retry')),
        h('label',{className:'dcc-check'},h('input',{type:'checkbox',checked:permanent,disabled:busy,onChange:e=>setPermanent(e.target.checked)}),t('permanent'))
      );
      return h(ui.Modal,{open:true,onClose:close,title:t('title'),closeLabel:t('close'),className:'dcc-modal',contentClassName:'dcc-content',footer:h('div',{className:'dcc-footer'},h('button',{type:'button',disabled:busy,onClick:close},t(result?'close':'cancel')),!result&&h('button',{type:'button',className:'dcc-danger',disabled:busy||!ready,onClick:submit},t(busy?'busy':permanent?'permanentRemove':'remove')))},body);
    }
    const css=`.dcc-modal{width:min(520px,calc(100vw - 28px));max-height:calc(100dvh - 32px);display:flex;flex-direction:column;min-height:0;overflow:hidden}.dcc-modal *{box-sizing:border-box}.dcc-modal .dcc-content{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain}.dcc-content>:last-child{margin-top:18px}.dcc-modal>:last-child{flex:0 0 auto}.dcc-sub{margin:0 0 16px;overflow-wrap:anywhere;font-weight:500}.dcc-modes{border:0;padding:0;margin:0}.dcc-modes legend{font-size:12px;opacity:.65;margin-bottom:6px}.dcc-mode{display:flex;align-items:center;gap:9px;padding:10px;border:1px solid transparent;border-radius:7px;font-size:13px;cursor:pointer}.dcc-mode:has(input:checked){background:color-mix(in srgb,currentColor 5%,transparent);border-color:color-mix(in srgb,currentColor 12%,transparent)}.dcc-mode input,.dcc-check input{accent-color:#d6423a;margin:0;flex-shrink:0}.dcc-help{font-size:12px;opacity:.65;line-height:1.6;margin:8px 0 14px}.dcc-details,.dcc-success details{font-size:12px;margin:12px 0}.dcc-details summary,.dcc-success summary{cursor:pointer;opacity:.75}.dcc-meta{display:grid;grid-template-columns:100px minmax(0,1fr);gap:7px;margin:12px 0}.dcc-meta dt{opacity:.6}.dcc-meta dd{margin:0;overflow-wrap:anywhere}.dcc-list{padding-left:18px;overflow-wrap:anywhere}.dcc-list li{padding:4px 0}.dcc-check{display:flex;align-items:center;gap:8px;font-size:12px;margin:16px 0 0;line-height:1.5;opacity:.8}.dcc-warning,.dcc-error{font-size:12px;line-height:1.6;color:#d55d45;overflow-wrap:anywhere;margin:12px 0}.dcc-warning p{margin:5px 0}.dcc-footer{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap}.dcc-footer button,.dcc-refresh{font:inherit;font-size:12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:7px;background:transparent;color:inherit;padding:8px 16px;cursor:pointer}.dcc-footer .dcc-danger{background:#d6423a;border-color:#d6423a;color:#fff}.dcc-footer button:disabled{opacity:.4;cursor:not-allowed}.dcc-success{font-size:13px;overflow-wrap:anywhere}.dcc-refresh{padding:5px 10px}`;
    function apply(ctx) {
      ctx.effect(()=>ctx.locale.register(NS,{en,zh}),'conversation-cleaner locale');
      ctx.effect(()=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);return()=>{style.remove();request=null;listeners.clear();};});
      ctx.slots.inject('sidebar.workspaces.session.menu.item',()=>ctx.slots.register({name:'sidebar.workspaces.session.menu.item',id:NS,order:500,locale:NS},Menu));
      ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:NS,locale:NS},Dialog));
    }
    return {inject:['slots','locale'],apply};
  }
});
