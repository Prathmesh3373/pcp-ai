#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { PCPMemoryStore } from "../stores/pcp-memory-store.js";
import { registerGetProfileTool } from "./tools/get-profile.js";
import { registerSearchContextTool } from "./tools/search-context.js";

async function main(): Promise<void> {
  const memoryStore = new PCPMemoryStore();

  /*
   * Keep the MCP handshake fast.
   *
   * Heavy initialization, WSL startup, npm resolution,
   * and model preparation belong in:
   *
   *   pcp setup
   *   pcp start
   *   pcp connect <client>
   */
  await memoryStore.checkConnection();

  const server = new McpServer({
    name: "pcp",
    version: "0.1.0",
  });

  registerSearchContextTool(server, memoryStore);
  registerGetProfileTool(server, memoryStore);

  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(
    [
      `[PCP MCP] ${getErrorMessage(error)}`,
      "",
      "Start PCP's local service first:",
      "  pcp start",
    ].join("\n"),
  );

  process.exit(1);
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}