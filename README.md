# DSH Conversation Cleaner

`1.0.0-rc.9`：修复启动期会话关闭句柄遗漏，以及全部清理零产出、零附件仍被其他会话拦截。本次在 Windows **NEXT 2.0.20-next / Core 0.2.1-rc.3** 和 **官方 DSH Web 0.2.1-rc.3** 做原始宿主生命周期、零资源全部清理、删除/恢复/永久删除与待处理保护的实际验证；六模式全量验收基线为 rc.7。正式用户数据只核对预览，未执行真实删除。

| 范围 | 实际行为 |
|---|---|
| 仅删除对话 | 清理日志、索引和工作区归属，保留文件与附件 |
| 对话 + 产出文件 | 另清理有创建证明的文件，保留已有、Git 跟踪及共享文件 |
| 全部清理 | 另清理无其他引用的附件和有映射的缓存，保留共享及未发送附件 |

侧栏会话行 `···` → **删除对话**。选择范围后点击删除即确认，不再勾选风险。路径、统计和清单收进详情；永久删除直接在选项和按钮上标识。默认使用可恢复隔离区。

## 安装

NEXT：插件 → 添加插件，输入本仓库地址或下载包的本地路径；安装后启用并重启。

- [仓库](https://github.com/sunyapeng-hub/dsh-conversation-cleaner)
- [下载 rc.9](https://github.com/sunyapeng-hub/dsh-conversation-cleaner/raw/refs/heads/main/packages/dsh-conversation-cleaner-1.0.0-rc.9.tgz)

官方 DSH：

```powershell
dsh plugin --profile web add "./dsh-conversation-cleaner-1.0.0-rc.9.tgz"
```

NEXT 的 `desktop` profile 由 Electron 管理，使用应用内安装器。升级旧开发包时先卸载再安装，隔离区不会随卸载清空。

## 验证与边界

- 两个真实宿主 × 三种模式：6 项实际删除通过，重启无回潮；日志、文件、附件与会话行恢复通过。
- 自动测试 86 项：85 通过、1 项 Windows 符号链接创建权限跳过；junction 防护和真实跨磁盘恢复通过。
- 真实运行中 Agent、跨宿主持有、并发删除、未发送上传保护、永久删除与 HTTP 鉴权拒绝均有记录。
- 仅声明上述 Windows 版本的结果。其他版本的协调桥接默认拒绝深度清理；未做 macOS/Linux 验收。
- 空闲目标在点击删除后自动关闭；启动前加载的会话也可经原始生命周期释放。运行、维护、待发送内容及其他宿主占用仍拒绝。B 无产出、C 无产出且无附件时不受其他会话归属缺口影响；实际清理文件和附件仍需完整证据。
- 共享根要求所有写入宿主安装兼容插件。索引缓存落后的宿主拒绝后续修改并要求重启；不协调未安装插件的进程、未知插件存储或任意外部写入者。
- 未映射的图片派生缓存保留；不会猜测归属。恢复目前使用已登录页面的同源接口，步骤见文档。

这是完成本机双宿主核心验收的候选版本，不宣称所有平台、全部 UI 场景和任意插件组合都已通过完整 V1.0 验收。

## 文档与开发

[安装](docs/INSTALL.md) · [恢复](docs/RESTORE.md) · [发布说明](docs/RELEASE_NOTES.md) · [兼容性](evidence/compatibility.md) · [验收记录](evidence/acceptance-report.json) · [复核修复](evidence/review.md)

```powershell
npm ci --ignore-scripts
npm run build
npm test
```

运行时无第三方依赖，React/UI 来自宿主。集成测试还需本机官方运行时位于 `research/installed-next`；仓库不分发 DSH/Electron 本体。普通用例可独立运行：`node --test tests/core.test.mjs tests/http.test.mjs tests/adapter.test.mjs tests/provenance.test.mjs`。

遵守 [AGENTS.md](AGENTS.md)：只在最开始备份原始输入包一次，不生成或验证校验和。附件 ID 使用宿主已有标识，不重新计算内容摘要。
