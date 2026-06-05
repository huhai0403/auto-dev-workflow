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
npm run test:smoke       # 冒烟测试
npm run test:interactive # 交互式测试
npm run test:stability   # 稳定性测试
npm run test:all         # 跑完交互 + 稳定两套
```

调试步骤：先 `npm run build && node dist/index.js` 确认进程能起，再回到客户端检查 MCP 注册。

## 文档

- [需求规格](./docs/REQUIREMENTS.md)
- [已确认决策](./docs/OPEN_QUESTIONS.md)
- [MCP 协议规范](https://modelcontextprotocol.io)

## License

[MIT](https://opensource.org/licenses/MIT)
