# 隔离恢复与中断处理

默认隔离区为 `.conversation-cleaner/operations/<operationId>/`。跨磁盘产出使用原目录旁的 `.dsh-conversation-cleaner-quarantine/<operationId>/`，位置记入同一 journal。均使用同卷 rename。

这是删除功能恢复区，不是新增的开发备份。

## 恢复

保存成功弹窗的操作 ID，在已登录 DSH/NEXT 页面的开发者工具执行：

```javascript
await fetch('/dsh-conversation-cleaner/v1/restore', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ operationId: '替换为操作 ID', acknowledged: true })
}).then(response => response.json())
```

恢复核对全部文件的设备、inode、大小、修改时间、普通文件类型和预期硬链接数。拒绝丢失、被替换或改写的隔离文件，不覆盖原路径新文件。恢复文件及索引后更新归属证明并刷新列表；两个宿主的三种模式均实际验证过。

可恢复事务的引用参与后续深度清理。旧事务没有引用记录时，先恢复再深度清理；更早且缺少文件身份的 journal 不自动迁移为可信恢复记录。

## 意外退出

1. 完全退出访问该根的所有 DSH/NEXT。
2. 对死亡进程留下的事务锁执行：

```powershell
node tools/offline-unlock.mjs '实际 DSH 数据根目录' --all-hosts-stopped
```

工具检查 owner PID 已退出，只移除锁文件与空锁目录，保留 journal 和隔离内容。owner 缺失或损坏时拒绝强行解锁。

3. 重启后查询未完成事务，再按上述接口恢复：

```javascript
await fetch('/dsh-conversation-cleaner/v1/operations', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
}).then(response => response.json())
```

出现 `RECOVERY_REQUIRED`、路径占用或身份不符时保留恢复材料，不删除目录后重试。

## 永久删除

需要额外输入 `DELETE`。进入 `PURGING` / `PERMANENT` 后拒绝恢复；尚未清空隔离文件的中断允许恢复。永久清空途中失败须依据 journal 人工继续清理剩余精确隔离文件，不自动改变删除策略。

不使用系统回收站，不承诺擦除云端、备份或其他设备副本。
