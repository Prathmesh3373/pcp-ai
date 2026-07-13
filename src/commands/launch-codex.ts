import { spawn } from "node:child_process";

import { connectCodex } from "./connect-codex.js";
import { startLocalMemoryService } from "../services/local-memory-service.js";

export async function launchCodex(): Promise<void> {
  console.log("\n========================================");
  console.log(" PCP — Launch Codex");
  console.log("========================================\n");

  console.log("Preparing PCP local memory...");

  await startLocalMemoryService();

  console.log("✓ PCP local memory is ready.\n");

  /*
   * connectCodex() is safe to call repeatedly.
   * If PCP is already registered, it only verifies it.
   */
  await connectCodex();

  console.log("\nLaunching Codex...\n");

  const codexCommand =
    process.platform === "win32"
      ? "codex.cmd"
      : "codex";

  launchInteractiveCommand(codexCommand);
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
        `PCP could not launch Codex: ${error.message}`,
      );

      process.exitCode = 1;
    });

    child.on("exit", (code) => {
      if (typeof code === "number" && code !== 0) {
        process.exitCode = code;
      }
    });

    return;
  }

  const child = spawn(command, [], {
    stdio: "inherit",
    shell: false,
  });

  child.on("error", (error) => {
    console.error(
      `PCP could not launch Codex: ${error.message}`,
    );

    process.exitCode = 1;
  });

  child.on("exit", (code) => {
    if (typeof code === "number" && code !== 0) {
      process.exitCode = code;
    }
  });
}