# 待确认问题（Open Questions）

> 状态：**已确认**（2026-05-28）

---

## 确认结果汇总

| 编号 | 问题 | 你的选择 |
|------|------|----------|
| Q1 | 八步流程 | **两套都支持**，通过 mode/参数切换 |
| Q2 | 文档生成 | **A + C**：默认模板填充，可选 LLM 增强 |
| Q3 | 输出目录 | **仅通过 `output_dir` 参数配置**，不设固定默认值 |
| Q4 | npm 包名 | **`@huhai0403/bmad-workflow-mcp`**，计划发布 npm |
| Q5 | batch 模式 | **首版就要支持** batch / epic / story 控制 |
| Q6 | 步骤 6/7 | **默认启用**代码生成与代码审查 |
| Q7 | Token 计算 | **默认 ÷4**，tiktoken 作为可选依赖 |
| Q8 | 并发/cancel | **软取消**（同项目单 running，状态标记） |

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

## 下一步实现优先级

1. **P0** — 更新包名、默认参数（Q4、Q6）、输出目录逻辑（Q3）
2. **P1** — 双流程切换（Q1）、LLM 可选增强（Q2）、tiktoken 可选依赖（Q7）
3. **P2** — batch / epic / story 支持（Q5，工作量最大）
