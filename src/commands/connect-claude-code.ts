import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalMemoryService } from "../services/local-memory-service.js";

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: Error;
}

export async function connectClaudeCode(): Promise<void> {
  console.log("\n========================================");
  console.log(" PCP — Connect to Claude Code");
  console.log("========================================\n");

  console.log("Preparing PCP local memory...");

  await startLocalMemoryService();

  console.log("✓ PCP local memory is ready.\n");

  const claudeCommand =
    process.platform === "win32"
      ? "claude.cmd"
      : "claude";

  console.log("Checking for Claude Code...");

  const versionResult = runCommand(
    claudeCommand,
    ["--version"],
  );

  if (!versionResult.success) {
    throw new Error(
      [
        "PCP could not find Claude Code on this computer.",
        "",
        "Install Claude Code and confirm this command works:",
        "  claude --version",
        "",
        getCommandFailureDetails(versionResult),
      ].join("\n"),
    );
  }

  const claudeVersion =
    versionResult.stdout.trim() ||
    versionResult.stderr.trim() ||
    "Claude Code detected";

  console.log(`✓ ${claudeVersion}`);

  const mcpServerPath = getMcpServerPath();

  console.log("\nChecking PCP MCP server...");

  if (!existsSync(mcpServerPath)) {
    throw new Error(
      [
        "The compiled PCP MCP server was not found.",
        "",
        `Expected file: ${mcpServerPath}`,
        "",
        "Build PCP first:",
        "  npm run build",
        "",
        "Then run:",
        "  pcp connect claude-code",
      ].join("\n"),
    );
  }

  console.log("✓ MCP server found");
  console.log(`  ${mcpServerPath}`);

  console.log(
    "\nChecking existing Claude Code connections...",
  );

  const existingConnection = runCommand(
    claudeCommand,
    ["mcp", "get", "pcp"],
  );

  if (existingConnection.success) {
    console.log(
      "✓ PCP is already registered with Claude Code.",
    );

    if (
      !connectionUsesExpectedPath(
        existingConnection,
        mcpServerPath,
      )
    ) {
      console.log(
        "The existing PCP connection points to an older MCP server.",
      );

      await replaceExistingConnection(
        claudeCommand,
        mcpServerPath,
      );
    }

    await verifyConnection(
      claudeCommand,
      mcpServerPath,
    );

    printSuccessMessage();
    return;
  }

  console.log(
    "Registering PCP with Claude Code...",
  );

  const addResult = addConnection(
    claudeCommand,
    mcpServerPath,
  );

  if (!addResult.success) {
    const secondCheck = runCommand(
      claudeCommand,
      ["mcp", "get", "pcp"],
    );

    if (!secondCheck.success) {
      throw new Error(
        [
          "Claude Code could not register the PCP MCP server.",
          "",
          getCommandFailureDetails(addResult),
        ].join("\n"),
      );
    }

    console.log(
      "✓ PCP was already registered with Claude Code.",
    );
  } else {
    console.log(
      "✓ PCP registered with Claude Code.",
    );
  }

  await verifyConnection(
    claudeCommand,
    mcpServerPath,
  );

  printSuccessMessage();
}

async function replaceExistingConnection(
  claudeCommand: string,
  mcpServerPath: string,
): Promise<void> {
  console.log(
    "Updating the Claude Code connection...",
  );

  const removeResult = runCommand(
    claudeCommand,
    [
      "mcp",
      "remove",
      "pcp",
      "--scope",
      "user",
    ],
  );

  if (!removeResult.success) {
    /*
     * Older Claude Code versions may not accept scope during
     * removal, so retry without it.
     */
    const fallbackRemove = runCommand(
      claudeCommand,
      ["mcp", "remove", "pcp"],
    );

    if (!fallbackRemove.success) {
      throw new Error(
        [
          "PCP found an outdated Claude Code connection but could not remove it.",
          "",
          getCommandFailureDetails(
            fallbackRemove,
          ),
        ].join("\n"),
      );
    }
  }

  const addResult = addConnection(
    claudeCommand,
    mcpServerPath,
  );

  if (!addResult.success) {
    throw new Error(
      [
        "PCP removed the outdated Claude Code connection, but could not add the new one.",
        "",
        getCommandFailureDetails(addResult),
      ].join("\n"),
    );
  }

  console.log(
    "✓ Claude Code connection updated.",
  );
}

function addConnection(
  claudeCommand: string,
  mcpServerPath: string,
): CommandResult {
  return runCommand(
    claudeCommand,
    [
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "pcp",
      "--",
      process.execPath,
      mcpServerPath,
    ],
  );
}

async function verifyConnection(
  claudeCommand: string,
  expectedPath: string,
): Promise<void> {
  console.log("\nVerifying the connection...");

  const getResult = runCommand(
    claudeCommand,
    ["mcp", "get", "pcp"],
  );

  if (!getResult.success) {
    throw new Error(
      [
        "PCP was registered, but Claude Code could not verify it.",
        "",
        getCommandFailureDetails(getResult),
      ].join("\n"),
    );
  }

  const combinedOutput = combineOutput(getResult);

  if (
    !combinedOutput.toLowerCase().includes("pcp")
  ) {
    throw new Error(
      [
        "Claude Code did not return details for the PCP MCP server.",
        "",
        combinedOutput.trim() ||
          "(No output returned)",
      ].join("\n"),
    );
  }

  if (
    !normalizedOutputIncludesPath(
      combinedOutput,
      expectedPath,
    )
  ) {
    throw new Error(
      [
        "Claude Code registered PCP, but it appears to reference a different MCP server path.",
        "",
        `Expected: ${expectedPath}`,
        "",
        "Claude Code output:",
        combinedOutput.trim(),
      ].join("\n"),
    );
  }

  console.log(
    "✓ PCP appears in Claude Code's MCP configuration.",
  );

  const usefulLines = combinedOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  for (const line of usefulLines) {
    console.log(`  ${line}`);
  }
}

function connectionUsesExpectedPath(
  result: CommandResult,
  expectedPath: string,
): boolean {
  return normalizedOutputIncludesPath(
    combineOutput(result),
    expectedPath,
  );
}

function normalizedOutputIncludesPath(
  output: string,
  expectedPath: string,
): boolean {
  return normalizePathText(output).includes(
    normalizePathText(expectedPath),
  );
}

function normalizePathText(
  value: string,
): string {
  return value
    .replace(/\\/g, "/")
    .replace(/["']/g, "")
    .toLowerCase();
}

function getMcpServerPath(): string {
  const currentFilePath =
    fileURLToPath(import.meta.url);

  const currentDirectory =
    path.dirname(currentFilePath);

  return path.resolve(
    currentDirectory,
    "..",
    "mcp",
    "server.js",
  );
}

function runCommand(
  command: string,
  args: string[],
): CommandResult {
  if (process.platform === "win32") {
    return runWindowsCommand(
      command,
      args,
    );
  }

  const result = spawnSync(
    command,
    args,
    {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    },
  );

  return normalizeCommandResult(result);
}

function runWindowsCommand(
  command: string,
  args: string[],
): CommandResult {
  const commandProcessor =
    process.env.ComSpec ??
    "C:\\Windows\\System32\\cmd.exe";

  const commandLine =
    createWindowsCommandLine(
      command,
      args,
    );

  const result = spawnSync(
    commandProcessor,
    ["/d", "/s", "/c", commandLine],
    {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    },
  );

  return normalizeCommandResult(result);
}

function createWindowsCommandLine(
  command: string,
  args: string[],
): string {
  return [
    command,
    ...args.map(quoteWindowsArgument),
  ].join(" ");
}

function quoteWindowsArgument(
  value: string,
): string {
  if (!/[\s"&|<>^()%!]/.test(value)) {
    return value;
  }

  const escapedValue =
    value.replace(/"/g, '""');

  return `"${escapedValue}"`;
}

function normalizeCommandResult(
  result: ReturnType<typeof spawnSync>,
): CommandResult {
  return {
    success:
      result.status === 0 &&
      !result.error,

    stdout:
      typeof result.stdout === "string"
        ? result.stdout
        : result.stdout?.toString() ??
          "",

    stderr:
      typeof result.stderr === "string"
        ? result.stderr
        : result.stderr?.toString() ??
          "",

    error:
      result.error instanceof Error
        ? result.error
        : undefined,
  };
}

function combineOutput(
  result: CommandResult,
): string {
  return [
    result.stdout,
    result.stderr,
  ]
    .filter(Boolean)
    .join("\n");
}

function getCommandFailureDetails(
  result: CommandResult,
): string {
  const details: string[] = [];

  if (result.error) {
    details.push(
      `Error: ${result.error.message}`,
    );
  }

  if (result.stderr.trim()) {
    details.push(
      result.stderr.trim(),
    );
  }

  if (result.stdout.trim()) {
    details.push(
      result.stdout.trim(),
    );
  }

  return details.length > 0
    ? details.join("\n")
    : "The command failed without returning additional information.";
}

function printSuccessMessage(): void {
  console.log("\n========================================");
  console.log(" PCP connected to Claude Code");
  console.log("========================================\n");

  console.log("Available PCP tools:");
  console.log("- pcp_get_profile");
  console.log("- pcp_search_context");

  console.log("\nStart Claude Code:");
  console.log("  claude");

  console.log("\nInside Claude Code, verify with:");
  console.log("  /mcp");

  console.log("\nThen try:");
  console.log(
    '  "Use PCP to understand my profile and suggest what I should build next."',
  );
}