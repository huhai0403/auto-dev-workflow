# 待确认问题（Open Questions）

> 状态：**已确认**（2026-05-28）

---

## 确认结果汇总

| 编号 | 问题 | 你的选择 |
|------|------|----------|
| Q1 | 八步流程 | **两套都支持**，通过 mode/参数切换 |
| Q2 | 文档生成 | **A + C**：默认模板填充，可选 LLM 增强（v0.4 起仅保留 A — 内置 LLM 调用已移除） |
| Q3 | 输出目录 | **仅通过 `output_dir` 参数配置**，不设固定默认值 |
| Q4 | npm 包名 | **`@huhai0403/bmad-workflow-mcp`**，计划发布 npm |
| Q5 | batch 模式 | **首版就要支持** batch / epic / story 控制 |
| Q6 | 步骤 6/7 | **默认启用**代码生成与代码审查 |
| Q7 | Token 计算 | **默认 ÷4**，tiktoken 作为可选依赖 |
| Q8 | 并发/cancel | **软取消**（同项目单 running，状态标记） |
| Q9 | v0.3.0 链式 | **升级默认行为**：`chain_to_pipeline` 默认 `true`（一次调用跑完 planning + pipeline） |
| Q10 | v0.3.0 state 格式 | **单文件多阶段数组** `chainPhases`，旧 schema 自动迁移 |
| Q11 | v0.3.0 响应体 | **截短 + 落盘**完整版到 `.bmad-output/chain-summary-<id>.md` |

---

## Q1. 八步流程定义差异 ✅

**已确认**：两套流程都支持，通过 `mode` 或参数切换。

| 模式 | 流程 |
|------|------|
| `planning`（规划导向） | PRD → 用户故事 → AC → 架构 → 任务拆解 → 代码生成 → 代码审查 → 审计报告 |
| `pipeline`（实现流水线） | Story Discovery → Create Story → Development → Testing → Code Review → Status Update → Checkpoint → Audit |

**实现影响**：
- 新增 `workflow_type: "planning" | "pipeline"` 参数
- 两套步骤定义独立注册，共享状态机与持久化层

---

## Q2. 文档内容如何生成 ✅

**已确认**：A + C — 默认模板填充，可选 LLM 增强。

| 层级 | 行为 |
|------|------|
| 默认 | 内嵌 BMAD 模板 + `requirement_description` 结构化填充 |
| 可选 | 读取 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 等环境变量，调用 LLM 生成高质量内容 |
| 降级 | 无 API Key 或调用失败时，自动回退到模板填充 |

**实现影响**：
- 新增 `use_llm?: boolean` 参数（默认 `false`）
- 新增 `LLMProvider` 抽象层，支持 OpenAI 兼容 API

> **v0.4 更新**：上述「可选 / 降级」两层连同 `use_llm` 参数、`LLMProvider` 抽象层已**完全移除**。AI 增强责任改由 host 端 `/bmad-code-review` skill 承担——MCP 端只产出 lint-only 初始 fingerprint，host skill 负责重写为 `source=llm` 才能 APPROVE。

---

## Q3. 输出目录命名 ✅

**已确认**：不设固定默认值，完全由 `output_dir` 参数决定。

**实现影响**：
- 移除硬编码 `.bmad-output` 默认值
- `start_bmad_workflow` 的 `output_dir` 改为**必填**，或提供显式 convention 文档说明推荐值
- 状态文件路径跟随 `output_dir` 或在项目根固定（待细化）

---

## Q4. npm 包名与发布 ✅

**已确认**：`@huhai0403/bmad-workflow-mcp`，计划发布 npm。

**实现影响**：
- 更新 `package.json` name 字段
- README 发布说明

---

## Q5. batch 模式 ✅

**已确认**：首版就要支持 batch / epic / story 粒度控制。

**实现影响**（较大）：
- 移植原 Skill 的 batch 解析、sprint-status 解析、fuzzy matching
- 新增参数：`batch?`, `epic?`, `story?`
- 状态文件需支持 batch 维度

---

## Q6. 步骤 6/7 默认行为 ✅

**已确认**：默认启用代码生成（步骤 6）和代码审查（步骤 7）。

**实现影响**：
- `include_codegen` 默认值改为 `true`
- `include_code_review` 默认值改为 `true`
- 步骤 7：有 `npm run lint` 则执行，否则写占位报告

---

## Q7. Token 计算精度 ✅

**已确认**：默认字符数 ÷4，tiktoken 作为可选依赖自动降级。

**实现影响**：
- `tiktoken` 加入 `optionalDependencies`
- `estimateTokens()` 优先 tiktoken，失败则 ÷4

---

## Q8. 并发与 cancel 语义 ✅

**已确认**：同项目仅允许一个 `running` 工作流；cancel 为软取消（状态标记，下一步检查点退出）。

**实现影响**：维持当前实现，无需变更。

---

## Q9. v0.3.0 链式触发（chain_to_pipeline）✅

**背景**：v0.2.x 下，`planning` 完成后需要 host 端 LLM 主动发起第二次 `start_bmad_workflow(workflow_type=pipeline)`。在 Cursor / OpenCode 中表现为"每到关键节点停下来问用户"。

**已确认**：**升级为默认行为**。`chain_to_pipeline` 默认 `true`，planning 跑完后引擎在**同一次工具调用内**自动从 `.bmad-output/planning-artifacts/` 推断 batch 并跑完 pipeline。Host 无需再发第二次调用。

**实现要点**：
- `StartWorkflowOptions.chainToPipeline?: boolean`（默认 `true`）
- `WorkflowState.chainPhases?: WorkflowState[]` 数组
- `StepAuditEntry.phase?: "planning" | "pipeline"` 区分阶段
- 失败归因：planning 失败 → chain 立即终止；pipeline 失败 → resume 从 phase[1] 续跑
- 视为 breaking change，`package.json` 升到 0.3.0

**如何回到 v0.2.x 行为**：显式传 `chain_to_pipeline: false`。

---

## Q10. v0.3.0 state.json 格式 ✅

**已确认**：**单文件多阶段数组**。`chainPhases: [phase0, phase1, ...]` 与 `currentChainPhase: number`。两个阶段都能独立 `resume_bmad_workflow` 续跑。

**实现要点**：
- 顶层 `state.workflowType` / `status` / `currentStep` / `progressPercent` 始终反映"当前激活"phase 的状态（向后兼容 `get_workflow_status` 等）
- 旧 schema（无 `chainPhases` 字段）首次 `loadState` 时自动迁移：把整个 state 包装为 `chainPhases[0]`
- `appendChainPhase(parent, phase)` 工具函数：追加 + 设 `currentChainPhase = phases.length - 1`

---

## Q11. v0.3.0 响应体长度 ✅

**已确认**：**截短 + 落盘**。`formatRunResult` 行数 > 200 时截到前 30 行 + 完整版路径提示。完整汇总写到 `.bmad-output/chain-summary-<workflow_id>.md`，包含 planning/pipeline 各自的 status、步骤数、duration、batch、产物目录。

**实现要点**：
- `WorkflowRunResult.chainSummaryPath?: string` 字段
- `structuredContent` 同步只回 `chainPhases[].{workflowType, status, completedSteps}`，不回审计明细，避免 host token 爆
- `server.ts` `CHAIN_MAX_SUMMARY_LINES = 200`、`CHAIN_PREVIEW_LINES = 30` 常量

---

## 下一步实现优先级

1. **P0** — 更新包名、默认参数（Q4、Q6）、输出目录逻辑（Q3）
2. **P1** — 双流程切换（Q1）、LLM 可选增强（Q2，v0.4 起移除）、tiktoken 可选依赖（Q7）
3. **P2** — batch / epic / story 支持（Q5，工作量最大）
