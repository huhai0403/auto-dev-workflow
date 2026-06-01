# @huhai0403/bmad-workflow-mcp

BMAD 自动化开发工作流 MCP Server — 可在 Cursor、OpenCode 等客户端中调用，无需安装 BMAD 本体或 Skill 文件。

## 功能

- **双工作流模式**
  - `planning`：PRD → 用户故事 → AC → 架构 → 任务 → 代码生成 → 代码审查 → 审计
  - `pipeline`：Story Discovery → Dev → Test → Review → Status → Checkpoint → Audit
- **batch / epic / story** 粒度控制（pipeline 模式）
- **LLM 可选增强**：`use_llm=true` + `OPENAI_API_KEY`，失败自动回退模板
- **状态持久化**、**dry-run**、**断点续传**、**审计日志**
- **Token 估算**：优先 tiktoken，否则字符数 ÷ 4

## 安装

```bash
npm install -g @huhai0403/bmad-workflow-mcp
```

本地开发：

```bash
npm install
npm run build
```

## Cursor 配置

`~/.cursor/mcp.json`：

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

或发布后：

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

## MCP 工具

| 工具 | 说明 |
|------|------|
| `start_bmad_workflow` | 启动工作流 |
| `resume_bmad_workflow` | 断点续传 |
| `get_workflow_status` | 查询进度 |
| `cancel_workflow` | 软取消 |
| `list_bmad_batches` | 列出可用 batch |

### start_bmad_workflow 主要参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `project_root` | ✅ | | 项目根目录 |
| `output_dir` | ✅ | | 产物根目录（如 `.bmad-output` 或 `_bmad-output`） |
| `workflow_type` | | `planning` | `planning` 或 `pipeline` |
| `requirement_description` | planning 必填 | | 需求描述 |
| `mode` | | `normal` | `dry-run` 仅预览 |
| `include_codegen` | | `true` | 启用代码生成步骤 |
| `include_code_review` | | `true` | 启用代码审查（尝试 `npm run lint`） |
| `use_llm` | | `false` | LLM 增强（需 `OPENAI_API_KEY`） |
| `batch` | pipeline 推荐 | | batch 名称 |
| `epic` | | | epic 过滤（如 `"1"`） |
| `story` | | | story 过滤（如 `"1-3"`） |

## 环境变量（LLM 可选）

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | LLM API Key |
| `OPENAI_BASE_URL` | 兼容 API 地址（默认 OpenAI） |
| `OPENAI_MODEL` | 模型名（默认 `gpt-4o-mini`） |

## 输出结构

### planning 模式

```
{project_root}/{output_dir}/
├── 01-prd.md … final-report.md
└── audit-log.json

{project_root}/.bmad-workflow-state.json
```

### pipeline 模式

```
{project_root}/{output_dir}/
├── planning-artifacts/{batch}/
└── implementation-artifacts/{batch}/mcp-workflow-run/
    ├── 01-story-discovery.md … 08-completion-audit.md
    └── audit-log.json
```

## 开发调试

```bash
npm run build
npm run inspector    # MCP Inspector
npm run test:smoke   # 冒烟测试
```

## 文档

- [需求规格](./docs/REQUIREMENTS.md)
- [已确认决策](./docs/OPEN_QUESTIONS.md)

## License

MIT
