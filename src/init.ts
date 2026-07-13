import {
  confirm,
  input,
  password,
  select,
} from "@inquirer/prompts";

export type AnalyzerProvider =
  | "ollama"
  | "gemini"
  | "openai"
  | "claude"
  | "later";

export interface AnalyzerConfiguration {
  provider: AnalyzerProvider;
  model?: string;
  apiKey?: string;
}

export type SourceType =
  | "github"
  | "website"
  | "document"
  | "linkedin"
  | "text";

export interface SourceConfiguration {
  type: SourceType;
  value: string;
}

export interface PCPInitializationResult {
  analyzer: AnalyzerConfiguration;
  sources: SourceConfiguration[];
}

interface OllamaModel {
  name: string;
  model?: string;
  size?: number;
  modified_at?: string;
}

interface OllamaTagsResponse {
  models?: OllamaModel[];
}

export async function runInitializationWizard(): Promise<PCPInitializationResult> {
  console.log("\n========================================");
  console.log(" PCP — Personal Context Protocol");
  console.log("========================================\n");

  console.log(
    "PCP builds a local, portable personal context profile for your AI tools.\n",
  );

  const provider = await select<AnalyzerProvider>({
    message: "Where should profile analysis run?",
    loop: false,
    pageSize: 8,
    choices: [
      {
        name: "Local model through Ollama",
        value: "ollama",
        description:
          "Your imported content is analyzed by a model running locally.",
      },
      {
        name: "Google Gemini",
        value: "gemini",
        description: "Uses your own Gemini API key.",
      },
      {
        name: "OpenAI",
        value: "openai",
        description: "Uses your own OpenAI API key.",
      },
      {
        name: "Anthropic Claude",
        value: "claude",
        description: "Uses your own Anthropic API key.",
      },
      {
        name: "Configure the analyzer later",
        value: "later",
      },
    ],
  });

  const analyzer = await configureAnalyzer(provider);
  const sources = await collectSources();

  return {
    analyzer,
    sources,
  };
}

async function configureAnalyzer(
  provider: AnalyzerProvider,
): Promise<AnalyzerConfiguration> {
  if (provider === "later") {
    return {
      provider: "later",
    };
  }

  if (provider === "ollama") {
    return configureOllamaAnalyzer();
  }

  return configureCloudAnalyzer(provider);
}

async function configureOllamaAnalyzer(): Promise<AnalyzerConfiguration> {
  console.log("\nChecking for locally installed Ollama models...\n");

  const availableModels = await getInstalledOllamaModels();

  if (availableModels.length === 0) {
    console.log("No installed Ollama models were found.\n");

    const action = await select<"manual" | "later">({
      message: "What would you like to do?",
      loop: false,
      choices: [
        {
          name: "Enter an Ollama model name manually",
          value: "manual",
          description:
            "Use this if the model exists but PCP could not detect it.",
        },
        {
          name: "Configure the analyzer later",
          value: "later",
        },
      ],
    });

    if (action === "later") {
      return {
        provider: "later",
      };
    }

    const manualModel = await input({
      message: "Enter the Ollama model name:",
      validate(value) {
        return (
          value.trim().length > 0 ||
          "Enter a valid Ollama model name."
        );
      },
    });

    return {
      provider: "ollama",
      model: manualModel.trim(),
    };
  }

  const selectedModel = await select<string>({
    message:
      "Choose the local model that should analyze your personal sources:",
    loop: false,
    pageSize: 12,
    choices: [
      ...availableModels.map((installedModel) => ({
        name: formatOllamaModelChoice(installedModel),
        value: installedModel.name,
        description:
          typeof installedModel.size === "number"
            ? `${formatBytes(installedModel.size)} installed locally`
            : "Installed locally",
      })),
      {
        name: "Enter another model name manually",
        value: "__manual__",
      },
    ],
  });

  if (selectedModel === "__manual__") {
    const manualModel = await input({
      message: "Enter the Ollama model name:",
      validate(value) {
        return (
          value.trim().length > 0 ||
          "Enter a valid Ollama model name."
        );
      },
    });

    return {
      provider: "ollama",
      model: manualModel.trim(),
    };
  }

  return {
    provider: "ollama",
    model: selectedModel,
  };
}

async function configureCloudAnalyzer(
  provider: Exclude<AnalyzerProvider, "ollama" | "later">,
): Promise<AnalyzerConfiguration> {
  const providerName = getProviderName(provider);

  console.log(
    `\nYou selected ${providerName} for profile analysis.`,
  );

  console.log(
    "Your API key will be used locally by PCP to call the selected provider.",
  );

  console.log(
    "The sources you import will be sent to that provider for analysis.",
  );

  console.log(
    "Your complete PCP profile remains stored locally.\n",
  );

  const accepted = await confirm({
    message: "Do you understand and want to continue?",
    default: false,
  });

  if (!accepted) {
    return {
      provider: "later",
    };
  }

  const apiKey = await password({
    message: `Enter your ${providerName} API key:`,
    mask: "*",
    validate(value) {
      return (
        value.trim().length > 0 ||
        "API key cannot be empty."
      );
    },
  });

  const model = await input({
    message: `Enter the ${providerName} model you want PCP to use:`,
    validate(value) {
      return (
        value.trim().length > 0 ||
        "Model name cannot be empty."
      );
    },
  });

  return {
    provider,
    apiKey: apiKey.trim(),
    model: model.trim(),
  };
}

async function collectSources(): Promise<SourceConfiguration[]> {
  const sources: SourceConfiguration[] = [];

  console.log("\nAdd sources PCP can use to build your profile.\n");

  while (true) {
    console.log(`Sources currently added: ${sources.length}\n`);

    const sourceType = await select<SourceType | "finish">({
      message: "Choose a source:",
      loop: false,
      pageSize: 8,
      choices: [
        {
          name: "GitHub profile",
          value: "github",
        },
        {
          name: "Personal website or portfolio",
          value: "website",
        },
        {
          name: "Resume or local document",
          value: "document",
        },
        {
          name: "LinkedIn profile",
          value: "linkedin",
        },
        {
          name: "Paste text manually",
          value: "text",
        },
        {
          name: "Finish adding sources",
          value: "finish",
        },
      ],
    });

    if (sourceType === "finish") {
      return sources;
    }

    const value = await askForSourceValue(sourceType);

    if (value === null) {
      console.log("\nReturned to source list.\n");
      continue;
    }

    sources.push({
      type: sourceType,
      value,
    });

    console.log(
      `\n✓ ${getSourceName(sourceType)} added successfully.`,
    );
    console.log(`Total sources: ${sources.length}\n`);
  }
}

async function askForSourceValue(
  sourceType: SourceType,
): Promise<string | null> {
  const initialAction = await select<"continue" | "back">({
    message: `Add ${getSourceName(sourceType)}?`,
    loop: false,
    choices: [
      {
        name: "Continue",
        value: "continue",
      },
      {
        name: "Back to source list",
        value: "back",
      },
    ],
  });

  if (initialAction === "back") {
    return null;
  }

  while (true) {
    const value = await promptForSourceValue(sourceType);

    console.log("\nSource preview:");
    console.log(createPreview(value));
    console.log();

    const action = await select<"add" | "retry" | "back">({
      message: "What would you like to do?",
      loop: false,
      choices: [
        {
          name: "Add this source",
          value: "add",
        },
        {
          name: "Enter it again",
          value: "retry",
        },
        {
          name: "Back to source list",
          value: "back",
        },
      ],
    });

    if (action === "add") {
      return value;
    }

    if (action === "back") {
      return null;
    }

    console.log("\nEnter the source again.\n");
  }
}

async function promptForSourceValue(
  sourceType: SourceType,
): Promise<string> {
  if (sourceType === "document") {
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

  if (sourceType === "text") {
    const text = await input({
      message: "Paste the text PCP should analyze:",
      validate(value) {
        return (
          value.trim().length > 0 ||
          "Text cannot be empty."
        );
      },
    });

    return text.trim();
  }

  const url = await input({
    message: `Enter the ${getSourceName(sourceType)} URL:`,
    validate(value) {
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
    },
  });

  return url.trim();
}

async function getInstalledOllamaModels(): Promise<OllamaModel[]> {
  try {
    const response = await fetch(
      "http://localhost:11434/api/tags",
      {
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Ollama returned status ${response.status}.`,
      );
    }

    const payload = (await response.json()) as OllamaTagsResponse;

    return payload.models ?? [];
  } catch {
    console.log("PCP could not connect to Ollama.");

    console.log(
      "Make sure Ollama is installed and running on http://localhost:11434.\n",
    );

    return [];
  }
}

function formatOllamaModelChoice(model: OllamaModel): string {
  if (!model.modified_at) {
    return model.name;
  }

  const modifiedDate = new Date(model.modified_at);

  if (Number.isNaN(modifiedDate.getTime())) {
    return model.name;
  }

  return `${model.name} — updated ${modifiedDate.toLocaleDateString()}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "Unknown size";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  const value = bytes / 1024 ** unitIndex;

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${
    units[unitIndex]
  }`;
}

function getProviderName(
  provider: Exclude<AnalyzerProvider, "ollama" | "later">,
): string {
  const names: Record<
    Exclude<AnalyzerProvider, "ollama" | "later">,
    string
  > = {
    gemini: "Gemini",
    openai: "OpenAI",
    claude: "Claude",
  };

  return names[provider];
}

function getSourceName(type: SourceType): string {
  const names: Record<SourceType, string> = {
    github: "GitHub profile",
    website: "personal website or portfolio",
    document: "resume or local document",
    linkedin: "LinkedIn profile",
    text: "manually entered text",
  };

  return names[type];
}

function createPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 120)}...`;
}

function removeWrappingQuotes(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "");
}