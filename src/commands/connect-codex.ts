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

export async function connectCodex(): Promise<void> {
  console.log("\n========================================");
  console.log(" PCP — Connect to Codex");
  console.log("========================================\n");

  console.log("Preparing PCP local memory...");

  await startLocalMemoryService();

  console.log("✓ PCP local memory is ready.\n");

  const codexCommand =
    process.platform === "win32" ? "codex.cmd" : "codex";

  console.log("Checking for Codex...");

  const versionResult = runCommand(codexCommand, [
    "--version",
  ]);

  if (!versionResult.success) {
    throw new Error(
      [
        "PCP could not find Codex on this computer.",
        "",
        "Install Codex and confirm this command works:",
        "  codex --version",
        "",
        getCommandFailureDetails(versionResult),
      ].join("\n"),
    );
  }

  const codexVersion =
    versionResult.stdout.trim() || "Codex detected";

  console.log(`✓ ${codexVersion}`);

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
        "  pcp connect codex",
      ].join("\n"),
    );
  }

  console.log("✓ MCP server found");
  console.log(`  ${mcpServerPath}`);

  console.log("\nChecking existing Codex connections...");

  const existingConnections = runCommand(codexCommand, [
    "mcp",
    "list",
  ]);

  if (
    existingConnections.success &&
    hasPcpConnection(existingConnections.stdout)
  ) {
    console.log("✓ PCP is already registered with Codex.");

    await verifyConnection(codexCommand);
    printSuccessMessage();

    return;
  }

  console.log("Registering PCP with Codex...");

  const addResult = runCommand(codexCommand, [
    "mcp",
    "add",
    "pcp",
    "--",
    "node",
    mcpServerPath,
  ]);

  if (!addResult.success) {
    const secondCheck = runCommand(codexCommand, [
      "mcp",
      "list",
    ]);

    if (
      secondCheck.success &&
      hasPcpConnection(secondCheck.stdout)
    ) {
      console.log(
        "✓ PCP was already registered with Codex.",
      );
    } else {
      throw new Error(
        [
          "Codex could not register the PCP MCP server.",
          "",
          getCommandFailureDetails(addResult),
        ].join("\n"),
      );
    }
  } else {
    console.log("✓ PCP registered with Codex.");
  }

  await verifyConnection(codexCommand);
  printSuccessMessage();
}

async function verifyConnection(
  codexCommand: string,
): Promise<void> {
  console.log("\nVerifying the connection...");

  const verificationResult = runCommand(codexCommand, [
    "mcp",
    "list",
  ]);

  if (!verificationResult.success) {
    throw new Error(
      [
        "PCP was registered, but the connection could not be verified.",
        "",
        getCommandFailureDetails(verificationResult),
      ].join("\n"),
    );
  }

  if (!hasPcpConnection(verificationResult.stdout)) {
    throw new Error(
      [
        "Codex did not report a PCP MCP connection.",
        "",
        "Codex MCP output:",
        verificationResult.stdout.trim() ||
          "(No output returned)",
      ].join("\n"),
    );
  }

  console.log(
    "✓ PCP appears in the Codex MCP server list.",
  );

  const pcpLine = findPcpConnectionLine(
    verificationResult.stdout,
  );

  if (pcpLine) {
    console.log(`  ${pcpLine}`);
  }
}

function getMcpServerPath(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirectory = path.dirname(currentFilePath);

  /*
   * Installed/compiled structure:
   *
   * dist/
   *   index.js
   *   commands/
   *     connect-codex.js
   *   mcp/
   *     server.js
   */
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
    return runWindowsCommand(command, args);
  }

  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });

  return normalizeCommandResult(result);
}

function runWindowsCommand(
  command: string,
  args: string[],
): CommandResult {
  const commandProcessor =
    process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";

  const commandLine = createWindowsCommandLine(
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

function quoteWindowsArgument(value: string): string {
  /*
   * cmd.exe requires arguments containing spaces or special
   * characters to be wrapped in quotes.
   */
  if (!/[\s"&|<>^()%!]/.test(value)) {
    return value;
  }

  const escapedValue = value.replace(/"/g, '""');

  return `"${escapedValue}"`;
}

function normalizeCommandResult(
  result: ReturnType<typeof spawnSync>,
): CommandResult {
  return {
    success: result.status === 0 && !result.error,

    stdout:
      typeof result.stdout === "string"
        ? result.stdout
        : result.stdout?.toString() ?? "",

    stderr:
      typeof result.stderr === "string"
        ? result.stderr
        : result.stderr?.toString() ?? "",

    error:
      result.error instanceof Error
        ? result.error
        : undefined,
  };
}

function hasPcpConnection(output: string): boolean {
  return output
    .split(/\r?\n/)
    .some((line) => /^\s*pcp(?:\s|:|$)/i.test(line));
}

function findPcpConnectionLine(
  output: string,
): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^pcp(?:\s|:|$)/i.test(line));
}

function getCommandFailureDetails(
  result: CommandResult,
): string {
  const details: string[] = [];

  if (result.error) {
    details.push(`Error: ${result.error.message}`);
  }

  if (result.stderr.trim()) {
    details.push(result.stderr.trim());
  }

  if (result.stdout.trim()) {
    details.push(result.stdout.trim());
  }

  return details.length > 0
    ? details.join("\n")
    : "The command failed without returning additional information.";
}

function printSuccessMessage(): void {
  console.log("\n========================================");
  console.log(" PCP connected to Codex");
  console.log("========================================\n");

  console.log("Available PCP tools:");
  console.log("- pcp_get_profile");
  console.log("- pcp_search_context");

  console.log("\nStart Codex:");

  console.log("  codex");

  console.log("\nThen try:");

  console.log(
    '  "Use PCP to understand my profile and suggest what I should build next."',
  );
}