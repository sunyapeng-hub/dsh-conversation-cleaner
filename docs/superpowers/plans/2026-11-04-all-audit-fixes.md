# 全部自检缺陷修复计划

目标：修复 RC9_SELF_AUDIT_2026-11-04.md 中六类已复现问题，并提供简洁的恢复/继续清空入口。

约束：只用最初备份；不计算校验和；不删除真实用户会话；当前工作区开发。用户已明确直接执行，不再增加方案审批。无本地 Git 仓库，当前目录是已有隔离工程。

## 模块与验收

- [x] provenance：写入/编辑前核对归属文件身份连续性，替换/外部修改后失去创建归属，重复 Agent 编辑仍保持正常；先加失败回归。
- [x] adapter：先读选中目标，零资源不再扫描/绑定无关 corpus；实际资源仍使用全局引用屏障；恢复前预检，明确支持用户选择恢复为未分组。
- [x] cleaner：永久及恢复完成记录只保留最小不含正文状态；旧终态记录提供显式清理入口；恢复写入 RESTORING/RESTORE_FAILED 并可重试；永久清理可幂等继续，精确校验剩余隔离文件。
- [x] client：过期前自动更新预览，提交时再次检查有效期；恢复、未分组恢复、继续永久清理、旧终态残留清理有直接入口，保持一次最终确认与简洁主弹窗。
- [x] 回归：六项自检场景均变为预期结果；现有单元/HTTP/并发/跨卷/附件/释放测试通过；隔离 NEXT 与 Web 实测三范围删除/恢复、原生 owner 释放、永久清理故障继续、恢复缺工作区分支及过期交互；补工作区/置顶/归档组合验证。
- [ ] 交付：独立审查，构建新候选版本，记录本次新证据与旧基线范围。沿用用户已授权的公开仓库交付，不触碰真实会话。

## 接口约定

`operations` 返回 `{pending:[id], operations:[{operationId,state,createdAt,mode,title?,files,restorable,canResumePurge,canCompact}]}`，仅可恢复或进行中的操作返回标题，终态不保留正文/标题/原始路径。

`restore` 请求 `{operationId,acknowledged:true,ungrouped?:boolean}`。缺工作区默认先拒绝且没有文件搬移；用户可单击恢复为未分组。Adapter 提供 `preflightRestore(ids,metadata,{ungrouped})`，`restore` 同一选项。

`purge` 请求 `{operationId,acknowledged:true}`，仅继续已有 PURGING 永久意图，不把普通可恢复删除转换为永久。`compact` 同样按单一 operationId 显式清理旧 PERMANENT/RESTORED 的内容载荷，不操作活跃会话。

正常可恢复 journal 可以保留恢复所需 metadata，永久/恢复终态一律移除 metadata、units、ids 和恢复正文，仅保留操作号、时间、模式、计数、终态。旧版本已生成的终态记录通过显式入口清理，不在升级时自动删除真实历史数据。

## 分工

provenance 与相关测试、adapter/attachments 与相关测试、client 与界面回归分别独立修改；主代理修改 cleaner/index 和状态机回归。集成后做独立整体审查，不并发写同一文件。

