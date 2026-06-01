# bmad-auto-dev-workflow → MCP Server 需求规格

> 记录日期：2026-05-28 | 实现版本：0.2.0 | 决策见 [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)

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
- LLM 可选（`use_llm` + 环境变量）
- tiktoken 可选依赖

---

## 10. 参考

- 原 Skill：`../_reference/bmad-auto-dev-workflow/`（本地克隆，仅供开发参考，不纳入发布包）
- MCP TypeScript SDK：https://github.com/modelcontextprotocol/typescript-sdk
