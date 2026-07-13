import type {
  AnalyzerConfiguration,
  ProfileAnalyzer,
} from "./analyzer.js";

import { ClaudeAnalyzer } from "./analyzers/claude-analyzer.js";
import { GeminiAnalyzer } from "./analyzers/gemini-analyzer.js";
import { OllamaAnalyzer } from "./analyzers/ollama-analyzer.js";
import { OpenAIAnalyzer } from "./analyzers/openai-analyzer.js";

export function createAnalyzer(
  configuration: AnalyzerConfiguration,
): ProfileAnalyzer {
  switch (configuration.provider) {
    case "ollama": {
      requireModel(configuration);

      return new OllamaAnalyzer(configuration.model);
    }

    case "gemini": {
      requireCloudConfiguration(configuration);

      return new GeminiAnalyzer(
        configuration.apiKey,
        configuration.model,
      );
    }

    case "openai": {
      requireCloudConfiguration(configuration);

      return new OpenAIAnalyzer(
        configuration.apiKey,
        configuration.model,
      );
    }

    case "claude": {
      requireCloudConfiguration(configuration);

      return new ClaudeAnalyzer(
        configuration.apiKey,
        configuration.model,
      );
    }

    case "later":
      throw new Error(
        "No profile analyzer has been configured.",
      );

    default: {
      const unsupported: never =
        configuration.provider;

      throw new Error(
        `Unsupported analyzer provider: ${String(
          unsupported,
        )}`,
      );
    }
  }
}

function requireModel(
  configuration: AnalyzerConfiguration,
): asserts configuration is AnalyzerConfiguration & {
  model: string;
} {
  if (!configuration.model) {
    throw new Error(
      "No analyzer model was configured.",
    );
  }
}

function requireCloudConfiguration(
  configuration: AnalyzerConfiguration,
): asserts configuration is AnalyzerConfiguration & {
  model: string;
  apiKey: string;
} {
  if (!configuration.model) {
    throw new Error(
      "No analyzer model was configured.",
    );
  }

  if (!configuration.apiKey) {
    throw new Error(
      "No API key was provided for the selected analyzer.",
    );
  }
}