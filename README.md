# MCP Code Analyzer

MCP orchestrator for code security, quality, and architecture analysis. This tool coordinates multiple MCP servers to provide comprehensive code analysis.

## Features

- **Security Analysis**: Vulnerability scanning via Semgrep, Trivy
- **Code Quality**: Linting via ESLint, SonarQube
- **Dependency Analysis**: Vulnerability scanning via Snyk, npm audit
- **Architecture Analysis**: Complexity metrics, dead code detection
- **Knowledge Graph**: Semantic code analysis, impact analysis
- **Scoring System**: 0-100 scores with A-F grades
- **Historical Trends**: Track improvements over time

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Interfaces                                      │
├─────────────┬─────────────────────┬─────────────────────────────────┤
│   CLI       │    REST API         │    MCP Server (for Claude)      │
└─────────────┴─────────────────────┴─────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  MCP ORCHESTRATOR │
                    │  - Client Manager │
                    │  - Job Scheduler  │
                    │  - Retry Logic    │
                    │  - Normalizer     │
                    │  - Score Engine   │
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌─────▼─────┐         ┌────▼────┐
   │ Semgrep │          │  ESLint   │         │  Snyk   │
   │  Trivy  │          │ SonarQube │         │npm audit│
   └─────────┘          └───────────┘         └─────────┘
```

## Installation

```bash
npm install -g mcp-code-analyzer
```

Or run directly with npx:

```bash
npx mcp-code-analyzer analyze ./my-project
```

## Usage

### CLI

```bash
# Analyze a local project
mcp-analyze analyze ./my-project

# Analyze a GitHub repository
mcp-analyze analyze https://github.com/user/repo

# Specify scanners
mcp-analyze analyze ./my-project --scanners security,quality

# Generate report
mcp-analyze report <analysis-id> --format md

# View history
mcp-analyze history ./my-project

# Compare analyses
mcp-analyze compare <id1> <id2>

# Start REST API
mcp-analyze serve --port 3000

# Start MCP server (for Claude)
mcp-analyze mcp
```

### MCP Integration (Claude Desktop)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "mcp-code-analyzer", "mcp"]
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `analyze_project` | Run full analysis on a project |
| `get_analysis_report` | Get detailed report |
| `compare_analyses` | Compare two analyses |
| `list_project_analyses` | View analysis history |
| `get_findings` | Get filtered findings |
| `get_code_graph` | Get semantic code graph |
| `analyze_impact` | Analyze impact of changes |

## Scoring

Each category is scored 0-100:

| Category | Weight |
|----------|--------|
| Security | 35% |
| Quality | 25% |
| Dependencies | 25% |
| Architecture | 15% |

Grades: A (90-100), B (80-89), C (70-79), D (60-69), F (<60)

## Configuration

Create `.mcp-analyzer.json` in your project root:

```json
{
  "servers": {
    "semgrep": { "enabled": true },
    "eslint": { "enabled": true },
    "snyk": { "enabled": false }
  },
  "scoring": {
    "weights": {
      "security": 0.4,
      "quality": 0.3,
      "dependencies": 0.2,
      "architecture": 0.1
    }
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

## License

MIT
