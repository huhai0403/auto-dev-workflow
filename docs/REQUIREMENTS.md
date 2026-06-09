# bmad-auto-dev-workflow → MCP Server 需求规格

> 记录日期：2026-05-28 | 实现版本：0.5.0 | 决策见 [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)

---

## 1. 背景与原始项目

现有 **BMAD 自动化开发工作流 Skill**（`bmad-auto-dev-workflow`）特点：

| 能力 | 说明 |
|------|------|
| 8 步流程 | 从需求发现到代码审查（原 Skill 为**实现流水线**导向，见 [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)） |
| 多种模式 | batch、dry-run、resume |
| 辅助功能 | 状态追踪、审计日志、Token 计算 |
| BMAD 依赖 | 强依赖 BMAD-METHOD 核心规则（PRD / 用户故事 / 验收标准格式），但不依赖其传统 Skill 文件 |

原 Skill 作为**编排器**，依赖多个 BMad 子 Skill（create-story、dev-story、code-review 等）及项目目录结构（`_bmad/`、`_bmad-output/`）。

---

## 2. 目标

将工作流重构为独立 **MCP Server**，可被 Cursor、OpenCode 等任意 MCP 客户端调用：

- 用户仅安装一个 MCP 包（如 `@my/bmad-workflow-mcp`），**无需**预先安装 BMAD 本体或 Skill 文件
- 通过 MCP 工具触发完整工作流（如 `start_bmad_workflow`）
- 工作流状态、中间产物、最终输出保存到用户指定项目目录（默认 `.bmad-output/`）
- 保留核心能力：步骤编排、断点续传、dry-run、审计日志

---

## 3. 依赖关系处理

- **BMAD-METHOD 是逻辑依赖，不是安装依赖**：MCP Server 内嵌 BMAD 核心模板与规则（PRD 模板、用户故事格式、验收标准格式等），以数据/模板文件形式存在
- **不调用任何本地 Skill 文件**：流程由 MCP Server 自身代码驱动

---

## 4. 技术选型与约束

| 项 | 选择 |
|----|------|
| 语言 | TypeScript |
| MCP SDK | `@modelcontextprotocol/sdk` |
| 工作流引擎 | 自研轻量状态机（步骤定义、跳转、重试、持久化） |
| 存储 | JSON 文件 `.bmad-workflow-state.json` |
| 传输 | stdio（本地 MCP 客户端） |

### 4.1 必须暴露的 MCP 工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `start_bmad_workflow` | `project_root`, `requirement_description`, `mode`（normal / dry-run） | 启动新工作流 |
| `resume_bmad_workflow` | `project_root` | 恢复未完成工作流 |

### 4.2 可选高级工具

| 工具 | 说明 |
|------|------|
| `get_workflow_status` | 查询当前进度 |
| `cancel_workflow` | 取消正在运行的工作流 |

---

## 5. 八步流程（固化到代码）

> **注意**：此 8 步为 MCP 重构版**规划导向**流程，与原 Skill 的 8 步（Story Discovery → … → Completion Audit）不同，详见 [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md#q1-八步流程定义差异)。

| 步骤 | 名称 | 产出 |
|------|------|------|
| 1 | 需求发现 | BMAD 格式 PRD |
| 2 | 用户故事生成 | 用户故事文档 |
| 3 | 验收标准定义 | 验收标准（BDD 格式） |
| 4 | 架构设计建议 | 架构选项文档 |
| 5 | 任务拆解 | 开发任务列表 |
| 6 | 代码生成（占位/可选） | 骨架代码（可选） |
| 7 | 代码审查（占位/可选） | lint 报告占位 |
| 8 | 审计与报告 | 汇总报告 |

每步返回：成功/失败、下一步信息、审计记录。

---

## 6. 关键功能点

- **状态持久化**：每完成一步写入状态文件，支持中断后 `resume`
- **dry-run 模式**：仅输出各步骤将生成的文件路径与摘要，不实际写入
- **审计日志**：记录每步输入、输出、耗时、Token 估算（字符数 / 4，可选 tiktoken）
- **错误处理**：步骤失败时记录错误，保留已保存状态，允许 resume
- **重试**：步骤级重试（默认最多 2 次，可配置）

---

## 7. 开发与打包要求

- TypeScript 项目，`src/index.ts` 为入口
- `package.json` 含 `bin`，支持 `npx @my/bmad-workflow-mcp`
- `README.md` 含 Cursor `mcp.json` 配置说明
- 本地调试：`@modelcontextprotocol/inspector` 或 `npx @modelcontextprotocol/inspector`

---

## 8. 输出目录约定

```
{project_root}/
├── .bmad-workflow-state.json    # 工作流状态
├── .bmad-output/
│   ├── 01-prd.md
│   ├── 02-user-stories.md
│   ├── 03-acceptance-criteria.md
│   ├── 04-architecture.md
│   ├── 05-tasks.md
│   ├── 06-code-skeleton/        # 可选
│   ├── 07-code-review.md        # 可选
│   ├── audit-log.json
│   └── final-report.md
```

---

## 9. 已确认实现（v0.2.0）

- 双工作流：`workflow_type=planning|pipeline`
- `output_dir` 必填，无硬编码默认
- 包名：`@huhai0403/bmad-workflow-mcp`
- 步骤 6/7 默认启用
- batch / epic / story + `list_bmad_batches` 工具
- v0.4 起内置 LLM 调用代码**已移除**（`use_llm` 入参 + `LlmProvider` 类 + `enhancePlanningContent` LLM 增强路径）；AI 审查改走 host 端 `/bmad-code-review` skill 覆盖 fingerprint
- v0.4 新增 `project_root` 缺省回退到 MCP server 启动 cwd，精简入参
- tiktoken 可选依赖

## 9.2 v0.5.0 新增（PARTIAL REVERT）

- **`use_llm` 重新引入**（默认 `true`）：v0.4 删除时 planning 阶段**唯一**能产出高质量内容的能力一并砍掉。事后反馈 PRD ≥ 50 行时（如 8 Epic 120 Story 电商后台）`enhancePlanningContent` 退化为 no-op，产物变成 3 个通用 Story、4 个通用架构选项的模板填充。v0.5.0 恢复 `LlmProvider`（OpenAI 兼容 API：默认 `gpt-4o-mini` / `https://api.openai.com/v1`，可用 `OPENAI_MODEL` / `OPENAI_BASE_URL` 覆盖）与 `enhancePlanningContent` 的真 LLM 路径。无 API key / 调用失败时 fallback 到模板，行为不破坏。
- **新增 `requirement_file`**（相对 `project_root` 的路径，如 `docs/prd.md`）：MCP 端 `fs.readFile` 后注入为 `requirementDescription`。**推荐用于 ≥ 50 行的 PRD**——避免 650 行塞进 MCP 参数导致 token 暴涨。与 `requirement_description` 二选一；都传时 `requirement_file` 优先。
- **planning 产物子目录化**：7 步产物（`01-prd.md` ~ `07-code-review.md`）写到 `output_dir/planning-artifacts/{slug}/` 下，slug 来自 `requirement_description`（`slugify` 后）。`final-report.md` 与 `audit-log.json` 仍在 `output_dir/` 顶层。**修复了 v0.4 时代 `chain_to_pipeline=true` 时无法推断 batch 的隐藏 bug**——v0.4 把产物写错位置，`inferBatchFromPlanningArtifacts` 扫不到 → chain 静默不启动。v0.5.0 起产物路径与原 Skill `_bmad-output/planning-artifacts/{batch}/` 对齐，chain 推断正常。`chain-summary-{workflow_id}.md` 移到 batch 子目录内。
- **AI 代码审查路径不变**：仍走 host 端 `/bmad-code-review` skill 覆盖 fingerprint，不在 MCP 端调 LLM（防绕过 + 简化权限模型）。
- 视为 minor release（0.4.0 → 0.5.0），`use_llm` 默认 `true` 是行为变更但有 fallback 兜底，不破坏现有用户。

---

## 9.1 v0.3.0 新增（BREAKING）

- **`chain_to_pipeline` 默认 `true`**：planning 跑完后引擎在同一次工具调用内自动跑 pipeline（基于 `planning-artifacts/` 推断 batch）。Host 不必再发第二次 `start_bmad_workflow`。回退 v0.2.x 行为：传 `chain_to_pipeline: false`。
- **state.json 新增 `chainPhases: WorkflowState[]` 数组 + `currentChainPhase: number` + `chainToPipeline: boolean`**。旧 schema 自动迁移。
- **`StepAuditEntry.phase?: "planning" | "pipeline"`** 字段，便于审计回溯。
- **响应体截短**：链式结果 > 200 行时截到前 30 行，完整版写入 `.bmad-output/chain-summary-<workflow_id>.md`。
- **`WorkflowRunResult.chainSummaryPath?: string`** 透出给 client。
- **`get_workflow_status` / `resume_bmad_workflow` / `cancel_workflow`** 行为按"当前激活 phase"操作，向后兼容。
- **错误归因**：planning 失败 → chain 中止；pipeline 失败 → 可从 `chainPhases[1]` 续跑。

---

## 10. 参考

- 原 Skill：`../_reference/bmad-auto-dev-workflow/`（本地克隆，仅供开发参考，不纳入发布包）
- MCP TypeScript SDK：https://github.com/modelcontextprotocol/typescript-sdk
