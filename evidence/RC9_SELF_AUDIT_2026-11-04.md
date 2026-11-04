# rc.9 自检报告

结论：当前版本仍有两项高优先级问题和四类可用性/异常恢复问题，不能据现有测试通过就认定为稳定完成版。以下问题已复现；本轮只增加自检脚本和报告，没有修改产品代码、升级版本或发布。

## 范围与证据

- 审查工作区 `1.0.0-rc.9`，使用真实 Cleaner、DshAdapter 和 provenance observer，配合自建合成文件/服务夹具。预览过期的客户端行为另在隔离真实 NEXT 中验证。
- 没有删除真实会话、操作真实产出文件、生成校验和或增加开发备份。
- 原正式路径 `C:/Users/sunyapeng/.dsh/profiles/desktop` 当前已没有插件依赖及入口；旧调试连接也不再可用。本轮没有擅自重装或重启正式应用，不能将本轮结果表述为正式安装的运行验收。
- 原有自动测试：86 项，85 通过、1 项 Windows 权限跳过。这些新场景没有被原测试充分覆盖。
- 文件误归属、正文残留、恢复失败、清空失败：[统一结果](<F:/Projects/PLUS Project/.test-data/audit-rc9/results.json>)、[可运行复现](<F:/Projects/PLUS Project/.test-data/audit-rc9/reproduce.mjs>)。
- 全局误拒绝：[结果](<F:/Projects/PLUS Project/.test-data/audit-rc9/global-results.json>)、[复现](<F:/Projects/PLUS Project/.test-data/audit-rc9/repro-global.mjs>)。
- 过期预览：[结果](<F:/Projects/PLUS Project/.test-data/audit-rc9/preview-expiry-results.json>)、[隔离 UI 截图](<F:/Projects/PLUS Project/.test-data/audit-rc9/expired-preview.png>)。

## P1：替换后的用户文件会被重新认作会话产出

触发：Agent 创建一个文件；用户将它移走并在同一路径放入另一份文件；Agent 读取并编辑新文件；再执行“对话＋产出文件”清理。

结果：新文件与原文件的 inode 不同，但 provenance 仅凭同一路径已有归属行，就更新为新文件身份。记录仍为 complete=true、unknown=false。真实 DshAdapter 将其列入 output 候选，真实 Cleaner 提交返回 VERIFIED，新用户文件从原路径被移入隔离区。若选择永久删除，同一候选还会进入清空流程。

位置：[provenance.js:33](<F:/Projects/PLUS Project/src/host/provenance.js:33>)、[dsh.js:160](<F:/Projects/PLUS Project/src/adapters/dsh.js:160>)。

建议：写入/编辑前确认原归属对象身份连续；已被替换或外部改变的文件不能靠一次更新重新获得“本会话创建”身份。不确定时保留文件并说明原因。

## P1：永久删除完成后仍保留正文

触发：对含普通文本消息和投影缓存的合成会话执行永久删除。

结果：返回 PERMANENT、restorable=false，原日志和隔离文件已不存在，live projection 也已删除；但 journal.metadata.recoveryReferences 仍保留合成用户正文，journal.metadata.domains 仍保留合成投影正文。不是系统回收站或外部备份，而是插件自己留下的事务数据。

根因：recoveryReferences 遍历并保存日志中的所有 string，journal 复制整份 metadata；永久清空仅 unlink 隔离文件，没有清理 journal 中的内容。

位置：[dsh.js:186](<F:/Projects/PLUS Project/src/adapters/dsh.js:186>)、[cleaner.js:119](<F:/Projects/PLUS Project/src/host/cleaner.js:119>)、[cleaner.js:145](<F:/Projects/PLUS Project/src/host/cleaner.js:145>)。

建议：引用记录仅保存必要标识，避免复制正文；永久清空成功后删除正文、投影和其他恢复载荷，只保留不含内容的最小状态记录。为已完成的旧永久事务提供受约束的残留清理方式。

## P2：无关会话仍会阻止目标删除

复现一：目标没有产出或附件，只改变另一个会话的 revision/日志。三种删除范围均返回 PLAN_CHANGED，目标保持原样。

复现二：另一个物理日志因不支持或损坏的头被宿主列表略过。目标没有产出或附件时，“仅对话”可预览，B/C 仍返回 CORPUS_REFERENCE_UNREADABLE。

根因：所有模式都将全库 corpus 放进 metadata 并完整比较；B/C 即使最终没有其他资源候选，也先核对、解码全库日志。rc.8/rc.9 放宽了部分 proof 和租约条件，没有彻底缩小不必要的全局依赖。

位置：[dsh.js:134](<F:/Projects/PLUS Project/src/adapters/dsh.js:134>)、[dsh.js:185](<F:/Projects/PLUS Project/src/adapters/dsh.js:185>)、[cleaner.js:114](<F:/Projects/PLUS Project/src/host/cleaner.js:114>)。

建议：仅删除选中日志时，只绑定必要的目标状态；只有真实文件/附件删除需要全局引用屏障。真正依赖引用证明的操作仍保持严格检查。

## P2：预览过期后按钮仍可点击

后端预览默认有效期 120 秒，过期提交返回 PLAN_EXPIRED；客户端 ready 只检查 plan、blockers、error，没有检查 expiresAt 或设置到期刷新。

隔离 NEXT 取得真实预览后，将渲染器时钟推进至返回的 expiresAt 之后：删除按钮仍 enabled，无过期提示，也没有刷新按钮。后端另用短 TTL 合成用例确认会拒绝过期提交。本项没有在真实会话上点击删除。

位置：[cleaner.js:49](<F:/Projects/PLUS Project/src/host/cleaner.js:49>)、[cleaner.js:101](<F:/Projects/PLUS Project/src/host/cleaner.js:101>)、[client/index.js:56](<F:/Projects/PLUS Project/src/client/index.js:56>)。

建议：有效期将到时刷新或明确显示失效并提供重试，避免用户点击后才知道不可执行；保持一次最终删除确认。

## P2：恢复半途失败不进入待处理状态

触发：可恢复删除后，原工作区已从宿主注册表移除，再尝试恢复。

结果：返回 RESTORE_WORKSPACE_MISSING，但日志文件已经搬回原位；工作区归属没有恢复，journal 仍为 VERIFIED，pending() 返回空数组。文件恢复和索引恢复分裂，未完成恢复没有被待处理查询报告。

位置：[cleaner.js:192](<F:/Projects/PLUS Project/src/host/cleaner.js:192>)、[cleaner.js:91](<F:/Projects/PLUS Project/src/host/cleaner.js:91>)。

建议：恢复前预检目的工作区/归属，恢复流程写入独立的恢复中及失败状态，提供可重复继续或明确补偿，不能把半恢复留作 VERIFIED。

## P2：永久清空中断后无法通过插件终结

触发：两个隔离文件进入永久清空，使用真实 Windows 独占文件锁使第二个 unlink 返回 EBUSY。

结果：第一个文件已清空，状态停在 PURGING；恢复返回 NOT_RESTORABLE。解除锁并按文档精确删除剩余隔离文件后，虽然残留文件为 0，pending 仍包含该操作，后续其他会话的 commit 仍返回 RECOVERY_REQUIRED。当前没有继续/终结清空的接口。

位置：[cleaner.js:145](<F:/Projects/PLUS Project/src/host/cleaner.js:145>)、[cleaner.js:91](<F:/Projects/PLUS Project/src/host/cleaner.js:91>)、[cleaner.js:189](<F:/Projects/PLUS Project/src/host/cleaner.js:189>)。

建议：提供幂等的继续清空/确认终结流程，核对精确隔离路径和剩余文件后推进状态。文档仅说手动清剩余文件，尚不足以解除事务阻塞。

## 其他产品与维护不足

- 恢复没有普通用户可操作的按钮，仍需开发者工具调用接口。
- 会话关闭兼容桥依赖 AgentLoop 0.2.1-rc.3、Cordis 4.0.5 的私有 effect 结构及 label，宿主升级可能失效；需要明确兼容性检测与升级回归。
- 全六模式验收基线仍是 rc.7，rc.9 是专项回归；多工作区、置顶、归档等正式组合未完成专门验收。

修复顺序建议：文件归属误判 → 永久删除正文残留 → 恢复/清空中断状态 → 全局依赖收敛 → 过期交互与恢复 UI。修复前临时仅使用“仅对话”并取消永久删除，不能把产出清理和永久清空视为已稳定完成。

## rc.10 修复闭环（2026-11-04）

以上是 rc.9 的历史审计，保留原始发现。六项缺陷已在 rc.10 修复；普通恢复界面、插件详情入口、继续永久清理及旧终态载荷清理均已加入。自动测试 130 项：129 通过、0 失败、1 项 Windows 符号链接权限跳过。

本次重新验证两个隔离宿主的三种删除范围与重启恢复；每个宿主另有 11 项专项通过，包括独立工作区与置顶/归档、无关 revision 不影响零资源目标、缺工作区预检与界面未分组恢复、永久续清、终态残留清理、真实 native read/edit 后保留被替换的用户文件。NEXT 原生界面配合模拟接口另验证到期刷新、禁止过期提交、短窗口固定底部与简化恢复操作。旧的其他专项按原时间保留，不冒充本次全量重跑。

新证据：[验收报告](acceptance-report.json)、[NEXT 专项](rc10-next-native.json)、[Web 专项](rc10-web-native.json)、[界面专项](rc10-client-ui.json)、[复查](review.md)。不再适用上述 rc.9 临时使用建议；精确宿主版本、Windows、共享根参与者与外部存储边界仍见报告。正式真实会话未被删除，正式已卸载的插件没有自动重装。
