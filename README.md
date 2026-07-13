# PCP - Personal Context Protocol

PCP builds a reviewed personal-context profile from a user's own sources, stores the approved context locally, and exposes it to MCP-compatible AI applications.

The goal is simple:

> Your AI tools should understand who you are, what you have built, what you care about, and how you prefer to work, without rebuilding that context separately in every AI application.

PCP can import sources such as GitHub profiles, personal websites, portfolios, resumes, local documents, LinkedIn content, and manually entered text.

An AI analyzer converts those sources into structured personal context. The user reviews the extracted items and decides what should be approved before anything is stored.

Connected AI applications can then retrieve relevant approved context through MCP.

---

## How PCP Works

```text
Import personal sources
        |
        v
Analyze with Ollama or a cloud model
        |
        v
Extract structured personal context
        |
        v
Review and approve context items
        |
        v
Store approved context locally
        |
        v
Connect PCP to an MCP-compatible AI application
        |
        v
Retrieve relevant personal context when needed
```

## Features

- Local-first personal context storage
- User review before context is saved
- GitHub profile and repository import
- JavaScript-rendered website and portfolio import
- Resume and local document import
- PDF text extraction
- LinkedIn fallback through document upload or pasted text
- Manual text import
- Local analysis through Ollama
- Cloud analysis through user-provided API keys
- Google Gemini analyzer support
- OpenAI analyzer support
- Anthropic Claude analyzer support
- Semantic personal-context retrieval
- MCP server integration
- Codex connection support
- Claude Code connection support
- Automatic local memory-service lifecycle commands

## MCP Tools

PCP exposes two MCP tools.

### `pcp_get_profile`

Returns a compact approved personal profile containing information such as:

- identity
- education
- interests
- projects
- experience
- work style
- learning style
- principles

### `pcp_search_context`

Searches the user's approved context for information relevant to a specific query.

Example:

```text
Use PCP to understand my background and recommend what I should build next.
```

The connected AI application can search PCP for relevant projects, interests, skills, goals, and experience before generating its answer.

## Requirements

### Required

- Node.js 20 or newer
- npm
- Windows
- WSL 2
- Ubuntu installed in WSL

### Optional

- Ollama, when using a local model for profile analysis
- Codex CLI, when connecting PCP to Codex
- Claude Code CLI, when connecting PCP to Claude Code
- Gemini, OpenAI, or Anthropic API key for cloud analysis
- Chromium, Chrome, or Microsoft Edge for rendered website extraction

## Installation

Once the package is published to npm:

```bash
npm install -g pcp-ai
```

The npm package name is:

```text
pcp-ai
```

The CLI command is:

```bash
pcp
```

For local development:

```bash
git clone https://github.com/Prathmesh3373/pcp-ai.git
cd pcp-ai

npm install
npx playwright install chromium

npm run typecheck
npm run build
npm link
```

## Build Your PCP Profile

Run:

```bash
pcp setup
```

PCP will ask you to:

1. Choose an analyzer.
2. Choose a model.
3. Add personal sources.
4. Review extracted context.
5. Approve or reject context items.
6. Store approved context locally.

Supported sources include:

- GitHub profile
- personal website or portfolio
- resume or local document
- LinkedIn profile fallback
- manually entered text

## Analyzer Options

### Local Analysis

PCP can use an installed Ollama model.

Example models:

- `qwen3.5:4b`
- `qwen2.5:7b`
- `llama3.2`
- `mistral`

Imported content remains on the user's computer when local analysis is used.

### Cloud Analysis

PCP can also analyze sources through:

- Google Gemini
- OpenAI
- Anthropic Claude

The user provides their own API key.

API keys are used only during the running PCP process and are not stored in the PCP profile.

Imported source content is sent to the selected provider when cloud analysis is used.

## Local Memory Commands

Start PCP's local memory service:

```bash
pcp start
```

Stop it:

```bash
pcp stop
```

Check its status:

```bash
pcp status
```

Example output:

```text
PCP local memory status

Status: running
Endpoint: http://localhost:6767
```

## Connect to Codex

Register PCP with Codex:

```bash
pcp connect codex
```

Launch Codex with PCP memory prepared:

```bash
pcp launch codex
```

Inside Codex, try:

```text
Use PCP to understand my profile and suggest what I should build next.
```

Codex can call:

- `pcp_get_profile`
- `pcp_search_context`

## Connect to Claude Code

Register PCP with Claude Code:

```bash
pcp connect claude-code
```

Launch Claude Code with PCP memory prepared:

```bash
pcp launch claude-code
```

Verify the connection:

```bash
claude mcp get pcp
```

Inside Claude Code, you can also run:

```text
/mcp
```

Then try:

```text
Use PCP to understand my background, projects, and interests before recommending my next project.
```

## CLI Commands

```bash
pcp
pcp setup
pcp start
pcp stop
pcp status
pcp connect codex
pcp launch codex
pcp connect claude-code
pcp launch claude-code
pcp help
```

## Example Use Cases

### Personalized Project Recommendations

```text
Use PCP to recommend a project that matches my experience and interests.
```

### Career Guidance

```text
Search PCP for my technical background and suggest what I should learn next.
```

### Personalized Coding Assistance

```text
Use PCP to understand my preferred stack and past projects before helping me design this application.
```

### Portfolio and Resume Support

```text
Use PCP to identify my strongest projects and create a concise portfolio introduction.
```

## Privacy

PCP follows a review-first and local-first design.

- Extracted context is shown to the user before storage.
- Only approved context is stored.
- Approved context is stored locally.
- API keys are not stored in the personal profile.
- When Ollama is selected, source analysis happens locally.
- When a cloud analyzer is selected, source content is sent only to the selected provider.
- MCP clients receive context only when they call PCP tools.

The local PCP configuration is stored at:

```text
~/.pcp/config.json
```

On Windows, this is normally:

```text
C:\Users\<username>\.pcp\config.json
```

## Architecture

```text
PCP CLI
|-- Analyzer selection
|-- Source import
|-- Context extraction
|-- User review
|-- Local memory lifecycle
`-- MCP client connection

Source Loaders
|-- GitHub
|-- Rendered website
|-- PDF and documents
|-- LinkedIn fallback
`-- Manual text

Analyzers
|-- Ollama
|-- Gemini
|-- OpenAI
`-- Anthropic Claude

Local Memory
`-- Approved personal context

MCP Server
|-- pcp_get_profile
`-- pcp_search_context

Connected Clients
|-- Codex
`-- Claude Code
```

## Current Limitations

- The current local memory lifecycle is primarily tested on Windows with WSL 2 and Ubuntu.
- Some websites may block automated browser extraction.
- LinkedIn commonly blocks automatic profile scraping, so PCP provides document and pasted-text fallbacks.
- Extracted items from multiple sources may occasionally overlap.
- Users should review AI-extracted context carefully before approval.
- More MCP clients can be added in future versions.

## Project Status

PCP is an early-stage hackathon prototype.

The current version demonstrates:

- portable personal context
- multi-source profile creation
- user-controlled memory approval
- local semantic storage
- context retrieval through MCP
- shared personal context across Codex and Claude Code

## Future Work

- Cursor integration
- Claude Desktop integration
- more MCP-compatible client connectors
- context deduplication
- profile editing and deletion commands
- encrypted export and import
- optional encrypted cloud synchronization
- workspace-specific context
- better source freshness and update detection
- cross-platform local memory support
