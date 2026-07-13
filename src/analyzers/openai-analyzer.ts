import type {
  AnalyzerInput,
  AnalyzerResult,
  ProfileAnalyzer,
} from "../analyzer.js";

import {
  buildAnalyzerPrompt,
  contextOutputJsonSchema,
  parseJsonText,
  validateAnalyzerResult,
} from "./shared.js";

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class OpenAIAnalyzer implements ProfileAnalyzer {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async analyze(
    input: AnalyzerInput,
  ): Promise<AnalyzerResult> {
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You extract evidence-backed personal context for PCP.",
            },
            {
              role: "user",
              content: buildAnalyzerPrompt(input),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "pcp_context_analysis",
              strict: true,
              schema: contextOutputJsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(180000),
      },
    );

    const payload =
      (await response.json()) as OpenAIResponse;

    if (!response.ok) {
      throw new Error(
        `OpenAI request failed: ${
          payload.error?.message ??
          `HTTP ${response.status}`
        }`,
      );
    }

    const text =
      payload.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error(
        "OpenAI returned an empty response.",
      );
    }

    return validateAnalyzerResult(
      parseJsonText(text),
    );
  }
}