# PCP — Personal Context Protocol

PCP builds a reviewed, local personal-context profile and exposes it to MCP-compatible AI applications.

PCP lets users import information from sources such as GitHub, portfolios, resumes, documents, LinkedIn, and manually entered text. An AI analyzer converts those sources into structured personal context, the user reviews and approves the extracted information, and PCP stores the approved context locally.

Connected AI applications can then use PCP through MCP to retrieve relevant personal context when answering the user.

## Current Features

- Local-first personal context storage
- GitHub profile import
- Website and portfolio import
- Resume and document import
- LinkedIn fallback support
- Manual text import
- Local analysis through Ollama
- Cloud analysis through user-provided API keys
- Review and approval before storage
- Semantic context retrieval
- MCP tools for connected AI applications
- Automatic local memory-service startup
- Codex MCP connection support

## MCP Tools

PCP currently exposes two MCP tools:

- `pcp_get_profile`
- `pcp_search_context`

`pcp_get_profile` returns a compact approved personal profile.

`pcp_search_context` searches the user's approved local context for information relevant to a specific query.

## Requirements

### Required

- Node.js 20 or newer
- npm
- Windows with WSL 2 and Ubuntu

### Optional

- Ollama, when using a local model for profile analysis
- Codex, when connecting PCP to Codex
- An API key, when using Gemini, OpenAI, or Anthropic Claude for analysis

PCP automatically starts its internal local memory service when the MCP server is launched.

## Installation

Install PCP globally:

```bash
npm install -g pcp

# SetUp
pcp setup
# Connect to Codex
pcp connect codex

#Then open Codex and ask:

"""" Use PCP to understand my profile and suggest what I should build next.""""

#MCP Tools
pcp_get_profile
pcp_search_context

#Privacy

PCP stores approved context locally.

When a local Ollama model is selected, imported content is analyzed locally.

When a cloud analyzer is selected, imported source content is sent to that chosen provider for analysis.