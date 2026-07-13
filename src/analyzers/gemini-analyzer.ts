import type {
  AnalyzerInput,
  AnalyzerResult,
  ProfileAnalyzer,
} from "../analyzer.js";

import {
  buildAnalyzerPrompt,
  geminiContextOutputSchema,
  parseJsonText,
  validateAnalyzerResult,
} from "./shared.js";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class GeminiAnalyzer implements ProfileAnalyzer {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async analyze(
    input: AnalyzerInput,
  ): Promise<AnalyzerResult> {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(this.model)}:generateContent`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildAnalyzerPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: geminiContextOutputSchema,
        },
      }),
      signal: AbortSignal.timeout(180000),
    });

    const payload =
      (await response.json()) as GeminiResponse;

    if (!response.ok) {
      throw new Error(
        `Gemini request failed: ${
          payload.error?.message ??
          `HTTP ${response.status}`
        }`,
      );
    }

    const text =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();

    if (!text) {
      throw new Error(
        "Gemini returned an empty response.",
      );
    }

    return validateAnalyzerResult(
      parseJsonText(text),
    );
  }
}