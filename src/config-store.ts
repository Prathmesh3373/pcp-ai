import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AnalyzerProvider,
  SourceConfiguration,
} from "./init.js";

export interface SavedAnalyzerConfiguration {
  provider: AnalyzerProvider;
  model?: string;
}

export interface PCPConfiguration {
  version: number;
  analyzer: SavedAnalyzerConfiguration;
  sources: SourceConfiguration[];
  createdAt: string;
  updatedAt: string;
}

const PCP_DIRECTORY = path.join(
  os.homedir(),
  ".pcp",
);

const CONFIG_FILE = path.join(
  PCP_DIRECTORY,
  "config.json",
);

/*
 * Previous PCP versions stored configuration relative to
 * the directory from which the user ran the command.
 */
const LEGACY_PCP_DIRECTORY = path.join(
  process.cwd(),
  ".pcp",
);

const LEGACY_CONFIG_FILE = path.join(
  LEGACY_PCP_DIRECTORY,
  "config.json",
);

export async function saveConfiguration(
  config: PCPConfiguration,
): Promise<void> {
  await ensureGlobalConfigurationDirectory();

  const existingConfiguration =
    await loadConfiguration();

  const normalizedConfiguration: PCPConfiguration = {
    ...config,

    createdAt:
      existingConfiguration?.createdAt ??
      config.createdAt,

    updatedAt: new Date().toISOString(),
  };

  await writeFile(
    CONFIG_FILE,
    JSON.stringify(
      normalizedConfiguration,
      null,
      2,
    ),
    "utf8",
  );
}

export async function loadConfiguration(): Promise<PCPConfiguration | null> {
  await migrateLegacyConfigurationIfNeeded();

  try {
    const rawConfig = await readFile(
      CONFIG_FILE,
      "utf8",
    );

    const parsed = JSON.parse(
      rawConfig,
    ) as PCPConfiguration;

    validateConfiguration(parsed);

    return parsed;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new Error(
        [
          "PCP configuration contains invalid JSON.",
          `Configuration: ${CONFIG_FILE}`,
        ].join("\n"),
      );
    }

    throw error;
  }
}

export function getConfigurationPath(): string {
  return CONFIG_FILE;
}

export function getPCPDirectoryPath(): string {
  return PCP_DIRECTORY;
}

async function ensureGlobalConfigurationDirectory(): Promise<void> {
  await mkdir(PCP_DIRECTORY, {
    recursive: true,
  });
}

async function migrateLegacyConfigurationIfNeeded(): Promise<void> {
  /*
   * Avoid migration when the old and new paths happen to be
   * identical, such as when PCP is run directly from home.
   */
  if (
    normalizePath(LEGACY_CONFIG_FILE) ===
    normalizePath(CONFIG_FILE)
  ) {
    return;
  }

  if (await fileExists(CONFIG_FILE)) {
    return;
  }

  if (!(await fileExists(LEGACY_CONFIG_FILE))) {
    return;
  }

  await ensureGlobalConfigurationDirectory();

  try {
    /*
     * Rename is preferred because it avoids leaving sensitive
     * source metadata duplicated in multiple directories.
     */
    await rename(
      LEGACY_CONFIG_FILE,
      CONFIG_FILE,
    );
  } catch {
    /*
     * Cross-device moves can fail. Copying is a safe fallback.
     */
    await copyFile(
      LEGACY_CONFIG_FILE,
      CONFIG_FILE,
    );
  }
}

function validateConfiguration(
  config: PCPConfiguration,
): void {
  if (
    !config ||
    typeof config !== "object"
  ) {
    throw new Error(
      "PCP configuration must contain a JSON object.",
    );
  }

  if (
    typeof config.version !== "number" ||
    !Number.isFinite(config.version)
  ) {
    throw new Error(
      "PCP configuration has an invalid version.",
    );
  }

  if (
    !config.analyzer ||
    typeof config.analyzer.provider !== "string"
  ) {
    throw new Error(
      "PCP configuration has an invalid analyzer configuration.",
    );
  }

  if (!Array.isArray(config.sources)) {
    throw new Error(
      "PCP configuration has an invalid sources list.",
    );
  }

  if (
    typeof config.createdAt !== "string" ||
    typeof config.updatedAt !== "string"
  ) {
    throw new Error(
      "PCP configuration has invalid timestamps.",
    );
  }
}

async function fileExists(
  filePath: string,
): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizePath(
  filePath: string,
): string {
  const normalized = path.resolve(
    filePath,
  );

  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function isFileNotFoundError(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}