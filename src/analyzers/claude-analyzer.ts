import type {
  AnalyzerInput,
  AnalyzerResult,
  ProfileAnalyzer,
} from "../analyzer.js";

import {
  buildAnalyzerPrompt,
  contextOutputJsonSchema,
  validateAnalyzerResult,
} from "./shared.js";

interface ClaudeResponse {
  content?: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "tool_use";
        id: string;
        name: string;
        input: unknown;
      }
  >;
  error?: {
    message?: string;
  };
}

export class ClaudeAnalyzer implements ProfileAnalyzer {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async analyze(
    input: AnalyzerInput,
  ): Promise<AnalyzerResult> {
    const response = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          temperature: 0,
          system:
            "You extract evidence-backed personal context for PCP.",
          messages: [
            {
              role: "user",
              content: buildAnalyzerPrompt(input),
            },
          ],
          tools: [
            {
              name: "submit_pcp_context",
              description:
                "Submit the structured personal context extracted from the source.",
              input_schema: contextOutputJsonSchema,
            },
          ],
          tool_choice: {
            type: "tool",
            name: "submit_pcp_context",
          },
        }),
        signal: AbortSignal.timeout(180000),
      },
    );

    const payload =
      (await response.json()) as ClaudeResponse;

    if (!response.ok) {
      throw new Error(
        `Claude request failed: ${
          payload.error?.message ??
          `HTTP ${response.status}`
        }`,
      );
    }

    const toolCall = payload.content?.find(
      (
        block,
      ): block is Extract<
        NonNullable<ClaudeResponse["content"]>[number],
        { type: "tool_use" }
      > =>
        block.type === "tool_use" &&
        block.name === "submit_pcp_context",
    );

    if (!toolCall) {
      throw new Error(
        "Claude did not return structured PCP context.",
      );
    }

    return validateAnalyzerResult(toolCall.input);
  }
}