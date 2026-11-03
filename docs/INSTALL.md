# 安装、升级与卸载

当前包：`dsh-conversation-cleaner-1.0.0-rc.8.tgz`。验证范围：Windows、NEXT 2.0.20-next / Core 0.2.1-rc.3，以及官方 DSH Web 0.2.1-rc.3。

## NEXT

1. 插件 → 添加插件。
2. 输入 `https://github.com/sunyapeng-hub/dsh-conversation-cleaner`，或下载 tgz 后输入本地路径。
3. 安装、启用，然后重启 NEXT，避免旧 ESM 模块留在内存。
4. 悬停会话行，打开 `···`，选择「删除对话」。

`desktop` profile 只能由 Electron 管理，CLI 会拒绝修改。升级：在应用内卸载、返回列表、安装新版、启用并重启。卸载不清空隔离事务。

## 官方 DSH

```powershell
dsh plugin --profile web add "./dsh-conversation-cleaner-1.0.0-rc.8.tgz"
dsh --profile web
```

自选数据目录请在启动前设置 `DSH_HOME`，以实际 Host 报告的路径为准。默认配置即可，无需 `exclusiveDataRoot: true`。

## 使用边界

升级后正常重启一次。空闲且无待处理内容的本宿主目标在点击删除后自动关闭；预览、取消不关闭。运行中、维护中、待发送内容或其他进程占用仍拒绝。插件就绪前已加载的会话需重启宿主。B/C 需要完整创建证据和引用核对，未知工具、损坏日志、超限都会阻止提交。

共享根要求所有写入 Host 安装兼容插件。其他宿主改变索引后，落后的 Host 会要求重启，避免覆盖新索引。

## 卸载与回退

NEXT：插件详情 → 卸载。官方 DSH：

```powershell
dsh plugin --profile web remove dsh-conversation-cleaner
```

菜单、弹窗和路由随生命周期卸载，隔离数据保留；重新安装兼容版本后仍可按 [恢复文档](RESTORE.md) 处理。

开发回退只使用最初的 `backups/DSH_Conversation_Cleaner_V1_original.zip`，不创建后续备份。
