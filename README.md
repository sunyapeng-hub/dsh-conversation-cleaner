# DSH Conversation Cleaner

`1.0.0-rc.10`：完成六项审计缺陷修复，增加直接恢复和删除记录管理。预览在过期前自动刷新，提交时再次核对有效期。删除成功后可直接点击「恢复」；即使会话列表已经清空，也能从「插件 → 本包详情 → 删除记录与恢复」进入管理。

| 范围 | 实际行为 |
|---|---|
| 仅删除对话 | 清理日志、索引和工作区归属，保留文件与附件 |
| 对话 + 产出文件 | 另清理有创建证明的文件，保留已有、Git 跟踪及共享文件 |
| 全部清理 | 另清理无其他引用的附件和有映射的缓存，保留共享及未发送附件 |

侧栏会话行 `···` → **删除对话**。选择范围后点击删除即确认，不再输入文字或另勾风险确认。路径、统计和清单收进详情；永久删除直接在选项和按钮上标识。默认使用可恢复隔离区。

**删除记录与恢复**位于同一会话菜单，也位于本插件详情。选择一条记录后，可恢复对话、继续中断的永久清理，或清理旧的已完成残留；操作仅针对所选记录。原工作区已不存在时，可显式点击「恢复为未分组对话」。完整步骤见[恢复文档](docs/RESTORE.md)。

## 安装

NEXT：插件 → 添加插件，输入本仓库地址或下载包的本地路径；安装后启用并重启。

- [仓库](https://github.com/sunyapeng-hub/dsh-conversation-cleaner)
- [下载 rc.10](https://github.com/sunyapeng-hub/dsh-conversation-cleaner/raw/refs/heads/main/packages/dsh-conversation-cleaner-1.0.0-rc.10.tgz)

官方 DSH：

```powershell
dsh plugin --profile web add "./dsh-conversation-cleaner-1.0.0-rc.10.tgz"
```

NEXT 的 `desktop` profile 由 Electron 管理，使用应用内安装器。升级旧开发包时先卸载再安装，隔离区不会随卸载清空。

## 本次修复

- 产出文件在路径被替换或被外部改写后失去创建归属；正常连续 Agent 编辑仍保留归属。适配真实原生 `edit` 工具不含 `operation` 字段的参数。
- 永久删除和恢复完成的记录移除正文、恢复载荷及原路径，仅保留最小操作摘要。旧终态残留只在用户点击「清理旧残留」时移除，升级不会自动改写历史记录。
- 零产出、零附件的清理只绑定选中会话；实际文件和附件清理仍核对全局引用。
- 过期预览自动刷新，过期确认信息不会发往提交接口；临时失败可重试。
- 恢复前检查原工作区。缺失时先拒绝且不搬移文件；用户可选择未分组恢复，已有工作区成员关系及置顶、归档状态保留。
- 中断的永久清理可从历史记录继续，不能把普通可恢复删除转成永久删除。

## 验证与边界

- rc.10 已在 Windows **NEXT 2.0.20-next / Core 0.2.1-rc.3** 和 **官方 DSH Web 0.2.1-rc.3** 完成三种范围的实际删除、重启与恢复验证。新增故障回归的最终覆盖以本次交付验收记录为准；不沿用旧版本的测试数量作为本次结果。
- 使用宿主私有 API 和 Cordis 4.0.5 的精确适配。仅声明上述 Windows 版本的结果；其他宿主版本的协调桥接默认拒绝深度清理，未做 macOS/Linux 验收。
- 空闲目标在点击删除后经原始生命周期关闭；启动前加载的会话也可释放。运行、维护、待发送内容及其他宿主占用仍拒绝。预览和取消不关闭会话。
- 共享根要求所有写入宿主安装兼容插件。索引缓存落后的宿主拒绝后续修改并要求重启；不协调未安装插件的进程、未知插件存储或任意外部写入者。
- 未映射的图片派生缓存保留，不猜测归属。不使用系统回收站，不承诺擦除云端、备份或其他设备副本。
- 正式用户数据只核对预览，未执行真实删除。实际删除与故障测试均限定于隔离测试数据。

这是完成本机双宿主核心验收的候选版本，不宣称所有平台、全部 UI 场景和任意插件组合都已通过完整 V1.0 验收。

## 文档与开发

[安装](docs/INSTALL.md) · [恢复](docs/RESTORE.md) · [rc.10 发布说明](docs/RELEASE_NOTES_RC10.md) · [历史发布说明](docs/RELEASE_NOTES.md) · [兼容性](evidence/compatibility.md) · [验收记录](evidence/acceptance-report.json) · [复核修复](evidence/review.md)

```powershell
npm ci --ignore-scripts
npm run build
npm test
```

运行时无第三方依赖，React/UI 来自宿主。集成测试还需本机官方运行时位于 `research/installed-next`；仓库不分发 DSH/Electron 本体。普通用例可独立运行：`node --test tests/core.test.mjs tests/http.test.mjs tests/adapter.test.mjs tests/provenance.test.mjs tests/client-flows.test.mjs`。

遵守 [AGENTS.md](AGENTS.md)：只在最开始备份原始输入包一次，不生成或验证校验和。附件 ID 使用宿主已有标识，不重新计算内容摘要。
