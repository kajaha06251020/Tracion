# Using Traceforge with Claude Code

Traceforge is the only observability platform built natively for Claude Code and the MCP ecosystem.

## Setup (30 seconds)

### 1. Start Traceforge

```bash
docker compose up -d
```

### 2. Register the MCP server

```bash
claude mcp add traceforge -- npx traceforge-mcp
```

Or with a local dev build:

```bash
claude mcp add traceforge-dev -- bun run packages/mcp-server/src/index.ts
```

### 3. Verify it works

In Claude Code, ask:
> "List my recent traces"

Claude will call `list_traces` and show you what's been recorded.

## Available MCP Tools

| Tool | Description | Example |
|------|-------------|---------|
| `list_traces` | List recent traces with filters | "Show me failed traces from today" |
| `get_trace` | Full trace detail with all spans | "Show me trace abc123 in detail" |
| `search_traces` | Full-text search across trace names | "Find traces containing 'generate_code'" |

## Example prompts

- "How much did my agent spend on API calls today?"
- "Show me the slowest traces from the last hour"
- "Find all error traces and explain what went wrong"
- "Compare the cost of my last 10 generate_code traces"

## Environment variables

```bash
# In your shell or .env
export TRACEFORGE_API_URL=http://localhost:3001
export TRACEFORGE_API_KEY=           # leave empty for local dev
export TRACEFORGE_POLL_INTERVAL=30000  # ms between new-trace notifications
```
