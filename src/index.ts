#!/usr/bin/env node

import {
  input,
  password,
  select,
} from "@inquirer/prompts";

import {
  getLocalMemoryServiceStatus,
  startLocalMemoryService,
  stopLocalMemoryService,
} from "./services/local-memory-service.js";

import { connectClaudeCode } from "./commands/connect-claude-code.js";
import { launchClaudeCode } from "./commands/launch-claude-code.js";
import { launchCodex } from "./commands/launch-codex.js";
import { connectCodex } from "./commands/connect-codex.js";
import { createAnalyzer } from "./analyzer-factory.js";
import type { ExtractedContextItem } from "./analyzer.js";
import {
  getConfigurationPath,
  saveConfiguration,
} from "./config-store.js";
import {
  runInitializationWizard,
  type SourceConfiguration,
  type SourceType,
} from "./init.js";
import { reviewContextItems } from "./review.js";
import { loadSource } from "./source-loader-factory.js";
import type { LoadedSource } from "./source-loader.js";
import { GitHubRateLimitError } from "./sources/github-source.js";
import { PCPMemoryStore } from "./stores/pcp-memory-store.js";

type FailureStage = "loading" | "analysis";

async function main(): Promise<void> {
  try {
    const handledCommand = await handleCliCommand();

    if (handledCommand) {
      return;
    }
    const result = await runInitializationWizard();

    const now = new Date().toISOString();

    await saveConfiguration({
      version: 1,
      analyzer: {
        provider: result.analyzer.provider,
        model: result.analyzer.model,
      },
      sources: result.sources,
      createdAt: now,
      updatedAt: now,
    });

    console.log("\nPreparing PCP local memory...");

    await startLocalMemoryService({
      model:
        result.analyzer.provider === "ollama"
          ? result.analyzer.model
          : undefined,
    });

    console.log("✓ PCP local memory is ready.");


    console.log("\n========================================");
    console.log(" PCP initialization completed");
    console.log("========================================\n");

    console.log(`Analyzer: ${result.analyzer.provider}`);

    if (result.analyzer.model) {
      console.log(`Model: ${result.analyzer.model}`);
    }

    console.log(`Sources added: ${result.sources.length}`);
    console.log(`Configuration: ${getConfigurationPath()}`);

    if (result.sources.length === 0) {
      console.log("\nNo sources were added.");
      return;
    }

    if (result.analyzer.provider === "later") {
      console.log(
        "\nNo analyzer has been configured. Configure an analyzer and run PCP again.",
      );
      return;
    }

    const analyzer = createAnalyzer(result.analyzer);
    const allExtractedItems: ExtractedContextItem[] = [];

    console.log("\nAnalyzing sources...\n");

    for (const originalSource of result.sources) {
      let currentSource: SourceConfiguration | null =
        originalSource;

      let sourceCompleted = false;

      while (currentSource && !sourceCompleted) {
        console.log(
          `Loading source: ${currentSource.type}...`,
        );

        let loadedSource: LoadedSource;

        try {
          const loadedResult =
            await loadSourceWithGitHubRetry(currentSource);

          if (!loadedResult) {
            console.log(
              `${getSourceDisplayName(currentSource.type)} skipped.\n`,
            );

            sourceCompleted = true;
            break;
          }

          loadedSource = loadedResult;
        } catch (error) {
          const errorMessage = getErrorMessage(error);

          printSourceFailure(
            currentSource,
            "loading",
            errorMessage,
          );

          currentSource = await recoverFailedSource({
            source: currentSource,
            stage: "loading",
          });

          if (!currentSource) {
            console.log("\nSource skipped.\n");
            sourceCompleted = true;
          }

          continue;
        }

        console.log(`Loaded: ${loadedSource.title}`);

        console.log("\nLoaded content preview:");
        console.log(loadedSource.content.slice(0, 1200));
        console.log("\n--- End content preview ---\n");

        try {
          const analysis = await analyzer.analyze({
            sourceType: loadedSource.type,
            sourceValue: loadedSource.originalValue,
            content: loadedSource.content,
          });

          console.log(
            `Analysis completed for: ${loadedSource.title}`,
          );

          console.log(
            `Extracted items: ${analysis.items.length}\n`,
          );

          allExtractedItems.push(...analysis.items);
          sourceCompleted = true;
        } catch (error) {
          const errorMessage = getErrorMessage(error);

          console.error(
            `Could not analyze ${loadedSource.title}:`,
          );
          console.error(`${errorMessage}\n`);

          currentSource = await recoverFailedSource({
            source: currentSource,
            stage: "analysis",
          });

          if (!currentSource) {
            console.log("\nSource skipped.\n");
            sourceCompleted = true;
          }
        }
      }
    }

    if (allExtractedItems.length === 0) {
      console.log(
        "\nPCP could not extract any context items from the supplied sources.",
      );
      return;
    }

    const reviewedItems = await reviewContextItems({
      items: allExtractedItems,
    });

    const approvedItems = reviewedItems.filter(
      (item) => item.reviewStatus === "approved",
    );

    const rejectedItems = reviewedItems.filter(
      (item) => item.reviewStatus === "rejected",
    );

    console.log("\n========================================");
    console.log(" PCP review completed");
    console.log("========================================\n");

    console.log(`Approved: ${approvedItems.length}`);
    console.log(`Rejected: ${rejectedItems.length}`);

    if (approvedItems.length === 0) {
      console.log("\nNo context items were approved.");
      return;
    }

    console.log("\nApproved context:\n");

    for (const item of approvedItems) {
      console.log(`✓ ${item.value}`);
      console.log(`  Category: ${item.category}`);
      console.log(`  Evidence: ${item.evidence}\n`);
    }

    const memoryStore = new PCPMemoryStore();

    console.log(
      "\nSaving your personal context profile...",
    );

    await memoryStore.checkConnection();

    const storageResult =
      await memoryStore.saveApprovedItems(approvedItems);

    console.log("\n========================================");
    console.log(" PCP profile ready");
    console.log("========================================\n");

    console.log(`Saved: ${storageResult.stored}`);
    console.log(`Failed: ${storageResult.failed}`);

    if (storageResult.failed === 0) {
      console.log(
        "\nYour personal context profile is ready for connected AI tools.",
      );
    } else {
      console.log(
        "\nSome approved context items could not be saved.",
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "ExitPromptError"
    ) {
      console.log("\nPCP initialization cancelled.");
      return;
    }

    console.error("\nPCP failed:");

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  }
}

interface RecoverFailedSourceOptions {
  source: SourceConfiguration;
  stage: FailureStage;
}

async function recoverFailedSource({
  source,
  stage,
}: RecoverFailedSourceOptions): Promise<SourceConfiguration | null> {
  console.log(
    stage === "loading"
      ? "PCP could not load this source."
      : "PCP loaded the source but could not analyze it.",
  );

  console.log(
    "You can retry it, provide the same information another way, or skip it.\n",
  );

  const choices: Array<{
    name: string;
    value:
      | "retry"
      | "replace_url"
      | "replace_document"
      | "replace_text"
      | "skip";
    description?: string;
  }> = [
    {
      name:
        stage === "loading"
          ? "Retry this source"
          : "Retry loading and analyzing this source",
      value: "retry",
    },
  ];

  if (isUrlSource(source.type)) {
    choices.push({
      name: `Enter another ${getSourceDisplayName(
        source.type,
      )} URL`,
      value: "replace_url",
    });
  }

  if (source.type === "document") {
    choices.push({
      name: "Enter another document path",
      value: "replace_document",
    });
  } else {
    choices.push({
      name: "Upload a local document instead",
      value: "replace_document",
      description:
        "Use a PDF, TXT, Markdown, or supported local document.",
    });
  }

  if (source.type === "text") {
    choices.push({
      name: "Paste different text",
      value: "replace_text",
    });
  } else {
    choices.push({
      name: "Paste the source content manually",
      value: "replace_text",
    });
  }

  choices.push({
    name: "Skip this source",
    value: "skip",
  });

  const action = await select<
    | "retry"
    | "replace_url"
    | "replace_document"
    | "replace_text"
    | "skip"
  >({
    message: "How would you like to continue?",
    loop: false,
    pageSize: 8,
    choices,
  });

  if (action === "retry") {
    console.log("\nRetrying source...\n");
    return source;
  }

  if (action === "replace_url") {
    const replacementUrl = await promptForUrl(
      source.type,
    );

    return {
      type: source.type,
      value: replacementUrl,
    };
  }

  if (action === "replace_document") {
    const documentPath = await promptForDocumentPath();

    return {
      type: "document",
      value: documentPath,
    };
  }

  if (action === "replace_text") {
    const text = await promptForManualText(source);

    return {
      type: "text",
      value: text,
    };
  }

  return null;
}

async function promptForUrl(
  sourceType: SourceType,
): Promise<string> {
  const url = await input({
    message: `Enter the ${getSourceDisplayName(
      sourceType,
    )} URL:`,
    validate(value) {
      return validateUrl(value);
    },
  });

  return url.trim();
}

async function promptForDocumentPath(): Promise<string> {
  const documentPath = await input({
    message: "Enter the full local path of the document:",
    validate(value) {
      return (
        removeWrappingQuotes(value).length > 0 ||
        "Document path cannot be empty."
      );
    },
  });

  return removeWrappingQuotes(documentPath);
}

async function promptForManualText(
  originalSource: SourceConfiguration,
): Promise<string> {
  console.log(
    `\nPaste the important content from ${getSourceDisplayName(
      originalSource.type,
    )}.`,
  );

  console.log(
    "For example: About, experience, education, projects, goals, interests, or work preferences.\n",
  );

  const text = await input({
    message: "Paste the content PCP should analyze:",
    validate(value) {
      return (
        value.trim().length > 0 ||
        "The pasted content cannot be empty."
      );
    },
  });

  return text.trim();
}

function printSourceFailure(
  source: SourceConfiguration,
  stage: FailureStage,
  errorMessage: string,
): void {
  const sourceName = getSourceDisplayName(source.type);

  if (stage === "loading") {
    console.error(
      `Could not process ${sourceName}:`,
    );
  } else {
    console.error(
      `Could not analyze ${sourceName}:`,
    );
  }

  console.error(`${errorMessage}\n`);
}

async function loadSourceWithGitHubRetry(
  source: SourceConfiguration,
): Promise<LoadedSource | null> {
  try {
    return await loadSource(source);
  } catch (error) {
    if (!(error instanceof GitHubRateLimitError)) {
      throw error;
    }

    return handleGitHubRateLimit(source, error);
  }
}

async function handleGitHubRateLimit(
  source: SourceConfiguration,
  error: GitHubRateLimitError,
): Promise<LoadedSource | null> {
  console.log(
    "\nGitHub's public API limit has been reached.",
  );

  if (error.resetAt) {
    console.log(
      `Public access may reset around ${error.resetAt.toLocaleString()}.`,
    );
  }

  const action = await select<
    "token" | "retry_later" | "skip"
  >({
    message: "How would you like to continue?",
    loop: false,
    choices: [
      {
        name: "Enter an optional GitHub token",
        value: "token",
        description:
          "The token is used only during this PCP process.",
      },
      {
        name: "Try this source again later",
        value: "retry_later",
      },
      {
        name: "Skip GitHub for now",
        value: "skip",
      },
    ],
  });

  if (action !== "token") {
    return null;
  }

  const token = await password({
    message: "Enter your GitHub token:",
    mask: "*",
    validate(value) {
      return (
        value.trim().length > 0 ||
        "GitHub token cannot be empty."
      );
    },
  });

  process.env.GITHUB_TOKEN = token.trim();

  console.log(
    "\nThe token is available only to this running PCP process.",
  );

  console.log(
    "It will not be stored in the PCP profile or configuration file.\n",
  );

  try {
    return await loadSource(source);
  } catch (retryError) {
    if (retryError instanceof GitHubRateLimitError) {
      throw new Error(
        "GitHub still rejected the request after authentication. Check the token and try again.",
      );
    }

    throw retryError;
  }
}

function isUrlSource(type: SourceType): boolean {
  return (
    type === "github" ||
    type === "website" ||
    type === "linkedin"
  );
}

function getSourceDisplayName(type: SourceType): string {
  const names: Record<SourceType, string> = {
    github: "GitHub profile",
    website: "personal website or portfolio",
    document: "resume or local document",
    linkedin: "LinkedIn profile",
    text: "manually entered text",
  };

  return names[type];
}

function validateUrl(value: string): true | string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "URL cannot be empty.";
  }

  try {
    const parsedUrl = new URL(trimmedValue);

    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      return "URL must begin with http:// or https://";
    }

    return true;
  } catch {
    return "Enter a valid URL beginning with http:// or https://";
  }
}

function removeWrappingQuotes(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function handleCliCommand(): Promise<boolean> {
  const [command, target, ...extraArguments] =
    process.argv.slice(2);

  if (!command) {
    return false;
  }

  if (command === "setup" || command === "init") {
    return false;
  }

  if (command === "start") {
  if (target || extraArguments.length > 0) {
    printUsage();
    throw new Error("The start command takes no arguments.");
  }

  console.log("\nStarting PCP local memory...");

  await startLocalMemoryService();

  console.log("✓ PCP local memory is running.");
  return true;
}

if (command === "stop") {
  if (target || extraArguments.length > 0) {
    printUsage();
    throw new Error("The stop command takes no arguments.");
  }

  console.log("\nStopping PCP local memory...");

  await stopLocalMemoryService();

  console.log("✓ PCP local memory is stopped.");
  return true;
}

if (command === "status") {
  if (target || extraArguments.length > 0) {
    printUsage();
    throw new Error("The status command takes no arguments.");
  }

  const status = await getLocalMemoryServiceStatus();

  console.log("\nPCP local memory status\n");
  console.log(
    `Status: ${status.running ? "running" : "stopped"}`,
  );
  console.log(`Endpoint: ${status.baseUrl}`);
  console.log(`Log: ${status.logPath}`);

  return true;
}

if (command === "launch") {
  if (extraArguments.length > 0) {
    printUsage();

    throw new Error(
      `Unexpected arguments: ${extraArguments.join(" ")}`,
    );
  }

  if (!target) {
    printUsage();

    throw new Error(
      "Choose an AI application to launch.",
    );
  }

  if (target === "codex") {
    await launchCodex();
    return true;
  }
  if (
  target === "claude-code" ||
  target === "claude"
) {
  await launchClaudeCode();
  return true;
}

  printUsage();

  throw new Error(
    `PCP does not support launching "${target}" yet.`,
  );
}

  if (command === "connect") {
    if (extraArguments.length > 0) {
      printUsage();
      throw new Error(
        `Unexpected arguments: ${extraArguments.join(" ")}`,
      );
    }

    if (!target) {
      printUsage();
      throw new Error(
        "Choose an AI application to connect.",
      );
    }

    if (target === "codex") {
      await connectCodex();
      return true;
    }
    if (
  target === "claude-code" ||
  target === "claude"
  ) {
    await connectClaudeCode();
    return true;
  }

    printUsage();

    throw new Error(
      `PCP does not support "${target}" yet.`,
    );
  }

  if (
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printUsage();
    return true;
  }

  printUsage();

  throw new Error(`Unknown PCP command: ${command}`);
}

function printUsage(): void {
  console.log("\nPCP — Personal Context Protocol\n");

  console.log("Usage:");
  console.log("  pcp");
  console.log("  pcp setup");
  console.log("  pcp start");
  console.log("  pcp stop");
  console.log("  pcp status");
  console.log("  pcp connect codex");
  console.log("  pcp help");
  console.log("  pcp launch codex");
  console.log(
  "  pcp connect claude-code",
  );
  console.log(
    "  pcp launch claude-code",
  );

  console.log("\nCommands:");
  console.log(
    "  setup           Build or update your personal context profile.",
  );
  console.log(
    "  start           Start PCP's local memory service.",
  );
  console.log(
    "  stop            Stop PCP's local memory service.",
  );
  console.log(
    "  status          Show PCP's local memory status.",
  );
  console.log(
    "  connect codex   Prepare PCP and connect it to Codex.",
  );
  console.log(
    "  help            Show the available commands.",
  );
  console.log(
  "  launch codex    Start PCP memory and launch Codex.",
  );
  console.log(
    "  connect claude-code   Prepare PCP and connect it to Claude Code.",
  );

  console.log(
    "  launch claude-code    Start PCP memory and launch Claude Code.",
  );
}

void main();