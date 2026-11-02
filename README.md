# DSH Conversation Cleaner

当前上传为 **1.0.0-dev.3 开发包**，整体验收状态 **BLOCKED**，不是双宿主三档全部完成的 V1.0。

## 下载

[下载插件开发包](packages/dsh-conversation-cleaner-1.0.0-dev.3.tgz)

安装、卸载、恢复说明以及验收摘要已包含在 tgz 内。

## 已验证

- 自动化测试：31 项通过，1 项因 Windows 符号链接权限跳过。
- 官方 DSH/Core 0.2.1-rc.3 + Edge：A 档仅对话删除、非目标文件保留、多客户端刷新、重启、恢复、卸载和重装。

## 当前限制

- B/C 实际产出文件与附件清理因宿主缺少全局引用协调能力而被阻止。
- DSH NEXT 2.0.20-next / Core 0.2.1-rc.3 尚未通过 desktop profile 实机验收。
- 默认允许预览；提交删除需要按包内安装文档确认独占数据目录并启用配置。共享数据根目录尚不受支持。

## 安装

下载 tgz 后，在对应 DSH 环境执行：

```powershell
dsh plugin --profile web add "./dsh-conversation-cleaner-1.0.0-dev.3.tgz"
```

NEXT 安装步骤见包内说明，当前尚未验收通过。

按项目要求，本次上传不提供校验和文件。仓库已公开，可下载安装验证。
