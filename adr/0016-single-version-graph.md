---
Status: accepted
---

# 每个分支只有一张版本图

每个分支只维护一张 `version_nodes` 图，不再保留互相竞争的 `branch_commits` 和 `canon_commits` 两套父链。节点类型至少包括：章节版本、大纲版本、正史提交、快照、修改应用、分支合并、回滚。章节版本和大纲版本通过节点引用，不单独形成父链。

每个节点包含：`id`、`branch_id`、`parent_node_id`、`node_type`、`object_type`、`object_id`、`object_version`、`snapshot_id`、`payload`、`actor`、`message`、`created_at`。分支头指向最新节点；正史提交节点必须带快照；合并和回滚都创建新节点，不覆盖历史。

## Consequences

- `branch_commits`、`canon_commits`、章节版本、大纲版本必须迁移或投影到统一图。
- 数据库约束必须保证：每个节点只有一个父节点、无环、每分支只有一个头、正史提交节点必须有快照。
- 回滚、比较、合并、审计都以同一张图查询，不能再按不同表各自解释。
