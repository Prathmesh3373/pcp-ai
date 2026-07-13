import {
  spawn,
  spawnSync,
} from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_MEMORY_URL = "http://localhost:6767";
const DEFAULT_WSL_DISTRO = "Ubuntu";

const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;
const HEALTH_CHECK_INTERVAL_MS = 1_000;
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

const MEMORY_DIRECTORY_NAME = ".supermemory";
const PCP_DIRECTORY_NAME = ".pcp";
const BACKUP_DIRECTORY_NAME = "memory-backups";
const BACKUP_MARKER_NAME = "memory-backup-v1.done";

export interface MemoryServiceOptions {
  baseUrl?: string;
  startupTimeoutMs?: number;
  model?: string;
}

export interface MemoryServiceStatus {
  running: boolean;
  baseUrl: string;
  logPath: string;
}

/**
 * Starts PCP's internal local memory service when necessary.
 *
 * Call this from user-facing lifecycle commands such as:
 * - pcp setup
 * - pcp start
 * - pcp connect codex
 *
 * Do not call this from the MCP server handshake.
 */
export async function startLocalMemoryService({
  baseUrl =
    process.env.SUPERMEMORY_BASE_URL ??
    DEFAULT_MEMORY_URL,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  model =
    process.env.PCP_MEMORY_MODEL ??
    "qwen3.5:4b",
}: MemoryServiceOptions = {}): Promise<void> {
  if (await isMemoryServiceAvailable(baseUrl)) {
    return;
  }

  if (!isLocalMemoryUrl(baseUrl)) {
    throw new Error(
      [
        `PCP could not connect to ${baseUrl}.`,
        "Automatic startup is supported only for a local memory service.",
      ].join(" "),
    );
  }

  restoreLatestMemoryBackupIfNeeded();
  createMemoryBackupIfNeeded();

  if (process.platform === "win32") {
    verifyWindowsPrerequisites();
    startMemoryServiceThroughWsl(model);
  } else {
    startMemoryServiceNatively(model);
  }

  await waitForMemoryService({
    baseUrl,
    timeoutMs: startupTimeoutMs,
  });
}

/**
 * Backwards-compatible name for any existing imports.
 */
export async function ensureLocalMemoryService(
  options: MemoryServiceOptions = {},
): Promise<void> {
  await startLocalMemoryService(options);
}

export async function stopLocalMemoryService(
  baseUrl =
    process.env.SUPERMEMORY_BASE_URL ??
    DEFAULT_MEMORY_URL,
): Promise<void> {
  if (!(await isMemoryServiceAvailable(baseUrl))) {
    return;
  }

  if (process.platform !== "win32") {
    throw new Error(
      [
        "Automatic memory-service shutdown is currently implemented for Windows with WSL.",
        "Stop the local memory process manually on this platform.",
      ].join(" "),
    );
  }

  const distro = getWslDistro();

  const result = spawnSync(
    "wsl.exe",
    [
      "-d",
      distro,
      "--",
      "bash",
      "-lc",
      "pkill -f '[s]upermemory local' || true",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    },
  );

  if (result.error) {
    throw new Error(
      `PCP could not stop its local memory service: ${result.error.message}`,
    );
  }

  await waitForMemoryServiceToStop({
    baseUrl,
    timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
  });
}

export async function getLocalMemoryServiceStatus(
  baseUrl =
    process.env.SUPERMEMORY_BASE_URL ??
    DEFAULT_MEMORY_URL,
): Promise<MemoryServiceStatus> {
  return {
    running: await isMemoryServiceAvailable(baseUrl),
    baseUrl,
    logPath: getMemoryLogPath(),
  };
}

export async function isMemoryServiceAvailable(
  baseUrl =
    process.env.SUPERMEMORY_BASE_URL ??
    DEFAULT_MEMORY_URL,
): Promise<boolean> {
  try {
    const response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(
        HEALTH_CHECK_TIMEOUT_MS,
      ),
    });

    return response.ok;
  } catch {
    return false;
  }
}

function verifyWindowsPrerequisites(): void {
  const wslResult = spawnSync(
    "wsl.exe",
    ["--status"],
    {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    },
  );

  if (wslResult.error || wslResult.status !== 0) {
    throw new Error(
      [
        "PCP requires WSL 2 on Windows.",
        "Install WSL and Ubuntu, then run:",
        "  pcp start",
      ].join("\n"),
    );
  }

  const distro = getWslDistro();

  const toolsResult = spawnSync(
    "wsl.exe",
    [
      "-d",
      distro,
      "--",
      "bash",
      "-lc",
      "command -v node >/dev/null && command -v npm >/dev/null && command -v npx >/dev/null",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    },
  );

  if (toolsResult.error || toolsResult.status !== 0) {
    throw new Error(
      [
        `PCP could not find Node.js and npm inside the "${distro}" WSL distribution.`,
        "",
        "Open Ubuntu and install Node.js 20 or newer.",
      ].join("\n"),
    );
  }
}

function startMemoryServiceThroughWsl(
  model: string,
): void {
  const distro = getWslDistro();
  const logPath = getMemoryLogPath();
  const logFile = openSync(logPath, "a");

  const command = [
    'export SUPERMEMORY_EMBEDDING_PROVIDER="local";',
    'export SUPERMEMORY_EMBEDDING_MODEL="Xenova/bge-base-en-v1.5";',
    'export SUPERMEMORY_EMBEDDING_DIMENSIONS="768";',

    'export OPENAI_BASE_URL="http://localhost:11434/v1";',
    'export OPENAI_API_KEY="ollama";',
    `export OPENAI_MODEL=${quoteBashValue(model)};`,

    "exec npx --yes supermemory local",
  ].join(" ");

  const child = spawn(
    "wsl.exe",
    [
      "-d",
      distro,
      "--",
      "bash",
      "-lc",
      command,
    ],
    {
      detached: true,
      windowsHide: true,
      stdio: [
        "ignore",
        logFile,
        logFile,
      ],
    },
  );

  child.on("error", (error) => {
    appendDiagnosticLog(
      `Could not launch WSL memory service: ${error.message}`,
    );
  });

  child.unref();
}

function startMemoryServiceNatively(
  model: string,
): void {
  const logPath = getMemoryLogPath();
  const logFile = openSync(logPath, "a");

  const child = spawn(
    "npx",
    [
      "--yes",
      "supermemory",
      "local",
    ],
    {
      detached: true,
      stdio: [
        "ignore",
        logFile,
        logFile,
      ],
      env: {
        ...process.env,

        SUPERMEMORY_EMBEDDING_PROVIDER: "local",
        SUPERMEMORY_EMBEDDING_MODEL:
          "Xenova/bge-base-en-v1.5",
        SUPERMEMORY_EMBEDDING_DIMENSIONS: "768",

        OPENAI_BASE_URL:
          process.env.OPENAI_BASE_URL ??
          "http://localhost:11434/v1",
        OPENAI_API_KEY:
          process.env.OPENAI_API_KEY ??
          "ollama",
        OPENAI_MODEL: model,
      },
    },
  );

  child.on("error", (error) => {
    appendDiagnosticLog(
      `Could not launch native memory service: ${error.message}`,
    );
  });

  child.unref();
}

async function waitForMemoryService({
  baseUrl,
  timeoutMs,
}: {
  baseUrl: string;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isMemoryServiceAvailable(baseUrl)) {
      return;
    }

    await sleep(HEALTH_CHECK_INTERVAL_MS);
  }

  throw new Error(
    [
      "PCP attempted to start its local memory service,",
      `but it did not become ready within ${Math.round(
        timeoutMs / 1000,
      )} seconds.`,
      "",
      `Check the service log: ${getMemoryLogPath()}`,
    ].join("\n"),
  );
}

async function waitForMemoryServiceToStop({
  baseUrl,
  timeoutMs,
}: {
  baseUrl: string;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isMemoryServiceAvailable(baseUrl))) {
      return;
    }

    await sleep(HEALTH_CHECK_INTERVAL_MS);
  }

  throw new Error(
    "PCP requested the local memory service to stop, but it is still responding.",
  );
}

function restoreLatestMemoryBackupIfNeeded(): void {
  const memoryDirectory = getMemoryDirectory();

  if (existsSync(memoryDirectory)) {
    return;
  }

  const backupRoot = getBackupRootDirectory();

  if (!existsSync(backupRoot)) {
    return;
  }

  const backupDirectories = readdirSync(backupRoot)
    .map((name) => path.join(backupRoot, name))
    .filter((candidate) => {
      try {
        return statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((first, second) => {
      return (
        statSync(second).mtimeMs -
        statSync(first).mtimeMs
      );
    });

  const newestBackup = backupDirectories[0];

  if (!newestBackup) {
    return;
  }

  cpSync(newestBackup, memoryDirectory, {
    recursive: true,
    errorOnExist: false,
  });
}

function createMemoryBackupIfNeeded(): void {
  const memoryDirectory = getMemoryDirectory();

  if (!existsSync(memoryDirectory)) {
    return;
  }

  const pcpDirectory = getPcpHomeDirectory();
  const markerPath = path.join(
    pcpDirectory,
    BACKUP_MARKER_NAME,
  );

  if (existsSync(markerPath)) {
    return;
  }

  mkdirSync(pcpDirectory, {
    recursive: true,
  });

  const backupRoot = getBackupRootDirectory();

  mkdirSync(backupRoot, {
    recursive: true,
  });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const backupPath = path.join(
    backupRoot,
    `supermemory-${timestamp}`,
  );

  cpSync(memoryDirectory, backupPath, {
    recursive: true,
    errorOnExist: false,
  });

  writeFileSync(
    markerPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        backupPath,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function getMemoryDirectory(): string {
  return path.join(
    os.homedir(),
    MEMORY_DIRECTORY_NAME,
  );
}

function getPcpHomeDirectory(): string {
  return path.join(
    os.homedir(),
    PCP_DIRECTORY_NAME,
  );
}

function getBackupRootDirectory(): string {
  return path.join(
    getPcpHomeDirectory(),
    BACKUP_DIRECTORY_NAME,
  );
}

function getMemoryLogPath(): string {
  return path.join(
    os.tmpdir(),
    "pcp-memory-service.log",
  );
}

function getWslDistro(): string {
  return (
    process.env.PCP_WSL_DISTRO ??
    DEFAULT_WSL_DISTRO
  );
}

function isLocalMemoryUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);

    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1"
    );
  } catch {
    return false;
  }
}

function quoteBashValue(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appendDiagnosticLog(message: string): void {
  try {
    const logPath = getMemoryLogPath();

    writeFileSync(
      logPath,
      `[PCP] ${message}\n`,
      {
        encoding: "utf8",
        flag: "a",
      },
    );
  } catch {
    // Avoid masking the original startup error.
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}