# @huhai0403/bmad-workflow-mcp

[![npm version](https://img.shields.io/npm/v/@huhai0403/bmad-workflow-mcp.svg)](https://www.npmjs.com/package/@huhai0403/bmad-workflow-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io)

BMAD 自动化开发工作流 MCP Server — 可在 Cursor、OpenCode 等 MCP 客户端中直接调用，无需安装 BMAD 本体或 Skill 文件。

相对原版 BMAD 的差异：双工作流模式（`planning` 全流程 / `pipeline` 增量批处理）、可选 LLM 增强（失败自动回退模板，工作流不中断）、原生 MCP 协议、状态持久化与断点续传。

## 目录

- [功能](#功能)
- [环境要求](#环境要求)
- [安装](#安装)
- [配置](#配置)
  - [Cursor](#cursor-配置)
  - [OpenCode](#opencode-配置)
- [快速开始](#快速开始)
- [MCP 工具](#mcp-工具)
- [环境变量](#环境变量llm-可选)
- [输出结构](#输出结构)
- [常见问题](#常见问题)
- [开发调试](#开发调试)
- [文档](#文档)
- [License](#license)

## 功能

- **双工作流模式**
  - `planning`：PRD → 用户故事 → AC → 架构 → 任务 → 代码生成 → 代码审查 → 审计
  - `pipeline`：Story Discovery → Dev → Test → Review → Status → Checkpoint → Audit
- **batch / epic / story 粒度控制**（pipeline 模式；留空则全量运行）
- **LLM 可选增强**：`use_llm=true` + `OPENAI_API_KEY`，失败自动回退模板，工作流不中断
- **AI 代码审查**：自动检测 git diff 中的变更文件，调用 LLM 评审，输出 APPROVE/CHANGES_REQUESTED/BLOCKED 结论与分级发现
- **4-checkpoint 完成审计**：每个 story 必须同时具备 Test Output、Lint Output、Code Review Summary、Definition of Done 四项证据，缺一即重排队为 `in-progress` 并返回 workflow 失败
- **状态持久化**、**dry-run**、**断点续传**、**审计日志**
- **Token 估算**：优先 `tiktoken`（可选依赖），否则字符数 ÷ 4

## 环境要求

- Node.js **>= 18**（见 `package.json` 的 `engines` 字段）
- 支持 MCP 协议的客户端：Cursor / OpenCode / Claude Desktop / 其他 MCP Host
- 可选：`OPENAI_API_KEY`（启用 LLM 增强时需要）

## 安装

全局安装（推荐，使用已发布版本）：

```bash
npm install -g @huhai0403/bmad-workflow-mcp
```

本地开发（克隆仓库后）：

```bash
npm install
npm run build
```

## 配置

### Cursor 配置

编辑 `~/.cursor/mcp.json`：

本地构建版本（路径请替换为你的实际位置）：

```json
{
  "mcpServers": {
    "bmad-workflow": {
      "command": "node",
      "args": ["D:/auto-dev-workflow/dist/index.js"]
    }
  }
}
```

npm 全局安装版本：

```json
{
  "mcpServers": {
    "bmad-workflow": {
      "command": "npx",
      "args": ["-y", "@huhai0403/bmad-workflow-mcp"]
    }
  }
}
```

> Windows 路径建议统一使用正斜杠 `/`，避免 JSON 转义问题。

### OpenCode 配置

OpenCode 的 MCP 配置位于 `mcp` 字段。

**项目级**（`<project>/opencode.json`，仅当前项目生效）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "bmad-workflow": {
      "type": "local",
      "command": ["node", "D:/auto-dev-workflow/dist/index.js"]
    }
  }
}
```

**全局**（`~/.config/opencode/opencode.json`，所有项目共享，推荐使用 `npx`）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "bmad-workflow": {
      "type": "local",
      "command": ["npx", "-y", "@huhai0403/bmad-workflow-mcp"]
    }
  }
}
```

macOS / Linux 路径示例：

```json
{
  "mcp": {
    "bmad-workflow": {
      "type": "local",
      "command": ["node", "/Users/you/projects/auto-dev-workflow/dist/index.js"]
    }
  }
}
```

也可通过 OpenCode CLI 临时注册（仅当前会话）：

```bash
opencode mcp add bmad-workflow -- node /path/to/auto-dev-workflow/dist/index.js
```

> 配置完成后重启 Cursor / OpenCode 使 MCP Server 生效。具体字段以 OpenCode 官方文档为准。

## 快速开始

在 Cursor / OpenCode 中对模型说：

> 用 bmad-workflow 跑一次 planning 工作流，项目根目录是 `D:/demo`，输出到 `.bmad-output`，需求是"实现一个 TODO 列表的 Web 应用"。

模型会自动调用 `start_bmad_workflow`：

```json
{
  "project_root": "D:/demo",
  "output_dir": ".bmad-output",
  "workflow_type": "planning",
  "requirement_description": "实现一个 TODO 列表的 Web 应用"
}
```

想先看产物结构、不落盘？加 `mode: "dry-run"`。

## 使用流程

### 全新项目（从 0 开始）

| # | 用户对模型说 | 关键参数 |
|---|---|---|
| 1 | "用 bmad-workflow 跑一次 planning dry-run，项目根 `D:/demo-new`，需求：XXX" | `mode: dry-run, include_codegen: false` |
| 2 | "刚才那条改成正常模式" | 去掉 `mode: dry-run` |
| 3 | 读 `01-prd.md` ~ `04-architecture.md`；偏差大就："用 bmad-workflow 取消 workflow_id=xxx" | `cancel_workflow` |
| 4 | "再跑一次 planning，include_codegen 改回 true" | `include_codegen: true` |
| 5 | 后续特性切 pipeline："用 bmad-workflow 跑 pipeline，project_root=D:/demo-new，batch=todo-v1，先 dry-run" | `workflow_type: pipeline, mode: dry-run` |

### 既有项目（增量迭代）

| # | 用户对模型说 | 关键参数 |
|---|---|---|
| 1 | "用 bmad-workflow 列出 `D:/demo` 的所有 batch" | `list_bmad_batches` |
| 2 | "用 bmad-workflow 跑 pipeline，batch=xxx，epic=1，story=1-2，开 LLM" | `epic: "1", story: "1-2", use_llm: true` |
| 3 | 中断时："用 bmad-workflow 续 workflow_id=xxx" | `resume_bmad_workflow` |
| 4 | 纯实现时："include_code_review 改 false 再跑一次" | `include_code_review: false` |
| 5 | 读 `audit-log.json`，对 skipped/failed 项针对性补 | — |

### 反模式
- planning 一次性开 `include_codegen=true` 跑全量 — 中间决策被跳过
- pipeline 不带 `epic/story` 一次全跑 — 失败要重跑整批
- 改完代码不复跑 — `audit-log` 与实际代码脱节

## MCP 工具

| 工具 | 说明 |
|------|------|
| `start_bmad_workflow` | 启动工作流 |
| `resume_bmad_workflow` | 断点续传（按 `workflow_id` 恢复） |
| `get_workflow_status` | 查询进度 |
| `cancel_workflow` | 软取消（保留已生成产物） |
| `list_bmad_batches` | 列出可用 batch |

### start_bmad_workflow 主要参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `project_root` | ✅ | | 项目根目录（绝对路径） |
| `output_dir` | ✅ | | 产物根目录（如 `.bmad-output` 或 `_bmad-output`） |
| `workflow_type` | | `planning` | `planning` 或 `pipeline` |
| `requirement_description` | planning 必填 | | 需求描述 |
| `mode` | | `normal` | `dry-run` 仅预览不落盘 |
| `include_codegen` | | `true` | 启用代码生成步骤；纯文档场景可设 `false` 提速 |
| `include_code_review` | | `true` | 启用代码审查（尝试 `npm run lint`） |
| `use_llm` | | `false` | LLM 增强（需 `OPENAI_API_KEY`）；失败自动回退 |
| `batch` | pipeline 推荐 | | batch 名称（pipeline 模式；留空全量） |
| `epic` | | | epic 过滤（如 `"1"`） |
| `story` | | | story 过滤（如 `"1-3"`） |

### resume_bmad_workflow

| 参数 | 必填 | 说明 |
|------|------|------|
| `workflow_id` | ✅ | 启动时返回的 ID；也写入 `.bmad-workflow-state.json` 的 `id` 字段 |

### get_workflow_status

| 参数 | 必填 | 说明 |
|------|------|------|
| `workflow_id` | ✅ | 工作流 ID |

### cancel_workflow

| 参数 | 必填 | 说明 |
|------|------|------|
| `workflow_id` | ✅ | 工作流 ID；已生成产物保留 |

### list_bmad_batches

无需参数，返回 `output_dir/planning-artifacts/` 下所有 batch 列表。

## 环境变量（LLM 可选）

仅当 `use_llm=true` 时生效。

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `OPENAI_API_KEY` | ✅ | | LLM API Key |
| `OPENAI_BASE_URL` | | OpenAI 官方 | 兼容 OpenAI 协议的 API 地址（Azure、自建网关等） |
| `OPENAI_MODEL` | | `gpt-4o-mini` | 模型名 |

## 输出结构

假设 `project_root=D:/demo`，`output_dir=.bmad-output`：

### planning 模式

```
D:/demo/.bmad-output/
├── 01-prd.md
├── 02-user-stories.md
├── 03-acceptance-criteria.md
├── 04-architecture.md
├── 05-tasks.md
├── 06-generated-code/
├── 07-code-review.md
├── final-report.md
└── audit-log.json

D:/demo/.bmad-workflow-state.json
```

### pipeline 模式

```
D:/demo/.bmad-output/
├── planning-artifacts/{batch}/
└── implementation-artifacts/{batch}/mcp-workflow-run/
    ├── 01-story-discovery.md
    ├── 02-dev.md
    ├── 03-test.md
    ├── 04-review.md
    ├── 05-status.md
    ├── 06-checkpoint.md
    ├── 07-audit.md
    ├── 08-completion-audit.md
    └── audit-log.json
```

## 常见问题

**Q: LLM 调用失败会中断工作流吗？**
A: 不会。`use_llm=true` 时若 API 报错或超时，自动回退到模板输出，工作流继续推进。

**Q: 如何从中断处继续？**
A: 调用 `resume_bmad_workflow` 并传入 `workflow_id`（启动时返回，也写入项目根的 `.bmad-workflow-state.json`）。

**Q: Windows 路径在 MCP 配置中报"找不到文件"？**
A: 统一使用正斜杠（`D:/auto-dev-workflow/dist/index.js`），避免反斜杠在 JSON 中需双重转义。也可改用 `npx -y @huhai0403/bmad-workflow-mcp` 免维护路径。

**Q: pipeline 模式只想跑某一个 story？**
A: 设置 `epic="1"` `story="1-3"`，会跳过其它 story；`batch` 留空则全量。

**Q: dry-run 模式产物会落盘吗？**
A: 不会。`mode: "dry-run"` 仅生成预览文本到响应中，便于审阅工作流结构。

**Q: Cursor / OpenCode 启动后看不到工具？**
A: 检查客户端日志中 MCP Server 是否成功注册；本地构建版本需先 `npm run build`，路径指向 `dist/index.js`（不是 `src/`）。

## 开发调试

```bash
npm run build            # 编译 TypeScript
npm run dev              # tsx 直接跑源码（开发热试）
npm run inspector        # 启动 MCP Inspector，可视化调试所有工具
npm run test:unit        # Vitest 单元测试（112 用例，含 AI 审查与 4-checkpoint 审计）
npm run test:unit:coverage  # 单元测试 + v8 coverage
npm run test:smoke       # 冒烟测试
npm run test:interactive # 交互式测试（28 用例，含 4-checkpoint 失败重排队）
npm run test:stability   # 稳定性测试（2 小时长跑）
npm run test:all         # 跑完 unit + smoke + interactive + stability 四套
```

调试步骤：先 `npm run build && node dist/index.js` 确认进程能起，再回到客户端检查 MCP 注册。

## AI 代码审查（含防绕过）

`code_review` / `code_review_pipeline` 步骤会自动：

1. 收集 git 变更文件（`git diff` 暂存 + 工作区 + 未跟踪，跳过 node_modules / 锁文件 / 二进制 / 超过 60KB 的文件，最多 25 个）
2. 调 `lint`（`npm run lint` 存在时执行）
3. 若 `use_llm=true` 且 `OPENAI_API_KEY` 已设，把变更文件 + lint 输出交给 LLM，按 System Prompt 中固定的 Markdown schema 返回 Verdict（APPROVE/CHANGES_REQUESTED/BLOCKED）与分级发现
4. 渲染为 `07-code-review.md` / `05-code-review.md`，写入 step 产物与故事文件（带 sentinel）

**Verdict 与 source 强约束**（防虚假跳过）：

| reviewSource | 来源 | 能否给出 APPROVE | 原因 |
|--------------|------|------------------|------|
| `llm` | LLM API 实际调用 | ✅ | 真实评审 |
| `lint` | 仅 lint 输出 | ❌ 必为 changes_requested | LLM 未执行 |
| `no_changes` | git 无变更 | ❌ 必为 changes_requested | 无对象可评审 |
| `no_lint_script` | lint 脚本缺失 | ❌ 必为 changes_requested | LLM 未执行 |
| `llm_disabled` | `use_llm=false` | ❌ 必为 changes_requested | LLM 未执行 |
| `llm_error` | LLM 报错 | ❌ 必为 changes_requested | LLM 未执行 |

**Fingerprint**：每次审查都会写入 `bmad-fingerprint:` 块（source / review_hash / model / reviewed_at / lint_executed / file_count），审计以此判断审查是否真发生。

**BLOCKED**：verdict 为 BLOCKED 时，pipeline `code_review_pipeline` 步**直接返回 `success: false`**，workflow 整体失败（不再等审计）。

## 4-Checkpoint 完成审计（含防绕过）

`pipeline` 模式 `completion_audit` 步强制每个 story 满足 BMAD ANTI-SKIP GUARDRAIL 全部 4 项证据。

### 4 项证据

| 证据 | 解析方式 | 缺失后果 |
|------|---------|---------|
| **Test Output** | 故事文件存在 `## Test Output` 段 + 内容非占位符 + **MCP sentinel** | 重排队 |
| **Lint Output** | 存在 `## Lint Output` 段 + 非空 + **MCP sentinel** | 重排队 |
| **Code Review Summary** | 存在 `## Code Review Summary` 段 + 包含 verdict + **MCP sentinel** + **`bmad-fingerprint` 块** + **source 必须为 `llm`** | 重排队 |
| **Definition of Done** | 存在 `## Definition of Done` 段，所有 `- [ ]` 已勾选；或 `## Acceptance Criteria` 段全部勾选 | 重排队 |

### 防绕过机制（5 个攻击路径被封堵）

1. **用户手写 4 段假内容** — 每段必须含 `<!-- bmad-evidence:{test|lint|review} step=... at=... workflow=... -->` sentinel；缺失即拒
2. **从其他 workflow 复制 sentinel** — 审计传入 `workflowId`，sentinel 的 `workflow` 必须匹配
3. **claim 是 LLM 但实际 fingerprint 缺失** — `## Code Review Summary` 段必须含 `bmad-fingerprint: source=llm` 行
4. **用户手写一个假 LLM fingerprint** — 故事文件内容与 step artifact `04-testing.md` / `05-code-review.md` 用 60 字符探针字符串交叉对照，不匹配即拒
5. **复制 code_review_summary 段但没改 fingerprint** — 同上，探针不匹配即拒

`onRequeue` 把失败 story 状态改回 `in-progress`，并把 `state.lastError` 与 `state.status = "failed"` 写回。审计报告 (`08-completion-audit.md`) 列出每项证据的 PASS/FAIL、sentinel 来源、cross-reference 结果。

### Sentinel 格式

`<!-- bmad-evidence:{kind} step={stepId} at={ISO8601} workflow={workflowId} -->`

- `kind`: `test` / `lint` / `review`
- `stepId`: 写入该段的 MCP 步骤 ID（`testing` / `code_review_pipeline` 等）
- `at`: ISO 8601 时间戳
- `workflow`: 当前 workflow run ID（`bmad-YYYYMMDD-{uuid8}`）

用户/agent 手工添加的段**不携带**这个 sentinel，因此会被识别为非 MCP 写入并被审计拒绝。

### Fingerprint 格式

```
bmad-fingerprint: source={llm|lint|no_changes|no_lint_script|llm_disabled|llm_error}
bmad-fingerprint: review_hash={sha256-prefix-16}
bmad-fingerprint: model={openai-model-name}    # 仅 LLM 路径
bmad-fingerprint: reviewed_at={ISO8601}
bmad-fingerprint: lint_executed={true|false}
bmad-fingerprint: file_count={n}
```

`review_hash` 是 review 输出内容的 SHA-256 截断，跨文件交叉对照时使用。

## 文档

- [需求规格](./docs/REQUIREMENTS.md)
- [已确认决策](./docs/OPEN_QUESTIONS.md)
- [MCP 协议规范](https://modelcontextprotocol.io)

## License

[MIT](https://opensource.org/licenses/MIT)
