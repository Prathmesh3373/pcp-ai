import { spawn } from "node:child_process";

import { connectClaudeCode } from "./connect-claude-code.js";
import { startLocalMemoryService } from "../services/local-memory-service.js";

export async function launchClaudeCode(): Promise<void> {
  console.log("\n========================================");
  console.log(" PCP — Launch Claude Code");
  console.log("========================================\n");

  console.log(
    "Preparing PCP local memory...",
  );

  await startLocalMemoryService();

  console.log(
    "✓ PCP local memory is ready.\n",
  );

  await connectClaudeCode();

  console.log(
    "\nLaunching Claude Code...\n",
  );

  const claudeCommand =
    process.platform === "win32"
      ? "claude.cmd"
      : "claude";

  launchInteractiveCommand(
    claudeCommand,
  );
}

function launchInteractiveCommand(
  command: string,
): void {
  if (process.platform === "win32") {
    const commandProcessor =
      process.env.ComSpec ??
      "C:\\Windows\\System32\\cmd.exe";

    const child = spawn(
      commandProcessor,
      ["/d", "/s", "/c", command],
      {
        stdio: "inherit",
        windowsHide: false,
        shell: false,
      },
    );

    child.on("error", (error) => {
      console.error(
        `PCP could not launch Claude Code: ${error.message}`,
      );

      process.exitCode = 1;
    });

    child.on("exit", (code) => {
      if (
        typeof code === "number" &&
        code !== 0
      ) {
        process.exitCode = code;
      }
    });

    return;
  }

  const child = spawn(
    command,
    [],
    {
      stdio: "inherit",
      shell: false,
    },
  );

  child.on("error", (error) => {
    console.error(
      `PCP could not launch Claude Code: ${error.message}`,
    );

    process.exitCode = 1;
  });

  child.on("exit", (code) => {
    if (
      typeof code === "number" &&
      code !== 0
    ) {
      process.exitCode = code;
    }
  });
}