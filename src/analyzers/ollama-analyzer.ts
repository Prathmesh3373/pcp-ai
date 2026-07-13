import { z } from "zod";

import type {
  AnalyzerInput,
  AnalyzerResult,
  ProfileAnalyzer,
} from "../analyzer.js";

const categorySchema = z.enum([
  "identity",
  "goal",
  "interest",
  "experience",
  "project",
  "work_style",
  "learning_style",
  "constraint",
  "principle",
  "other",
]);

const extractedItemSchema = z.object({
  category: categorySchema,
  value: z.string().min(3),
  evidence: z.string().min(3),
  confidence: z.number().min(0).max(1),
  sensitivity: z.enum(["public", "personal", "sensitive"]),
  workspaceId: z.string().min(1),
});

const analyzerResultSchema = z.object({
  items: z.array(extractedItemSchema).max(15),
});

interface OllamaGenerateResponse {
  response?: string;
  thinking?: string;
  done: boolean;
  done_reason?: string;
  error?: string;
}

export class OllamaAnalyzer implements ProfileAnalyzer {
  constructor(
    private readonly model: string,
    private readonly baseUrl = "http://localhost:11434",
  ) {}

  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    const outputSchema = createOutputSchema();
    const prompt = buildAnalysisPrompt(input, outputSchema);

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        think: false,
        format: outputSchema,
        options: {
          temperature: 0,
        },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!response.ok) {
      const errorBody = await response.text();

      throw new Error(
        `Ollama request failed with status ${response.status}: ${errorBody}`,
      );
    }

    const payload = (await response.json()) as OllamaGenerateResponse;

    if (payload.error) {
      throw new Error(`Ollama error: ${payload.error}`);
    }

    const rawOutput = payload.response?.trim();

    if (!rawOutput) {
      throw new Error(
        "Ollama returned an empty final response.",
      );
    }

    const normalizedOutput = stripMarkdownCodeFence(rawOutput);

    let parsedResponse: unknown;

    try {
      parsedResponse = JSON.parse(normalizedOutput);
    } catch {
      throw new Error(
        `Ollama returned malformed JSON:\n${rawOutput}`,
      );
    }

    const adaptedResponse = adaptCommonModelMistakes(parsedResponse);

    const validated = analyzerResultSchema.safeParse(adaptedResponse);

    if (!validated.success) {
      throw new Error(
        [
          "Ollama returned JSON that does not match the PCP schema.",
          "",
          validated.error.message,
          "",
          "Raw model output:",
          rawOutput,
        ].join("\n"),
      );
    }

    return {
      items: validated.data.items.filter(isUsefulContextItem),
    };
  }
}

function buildAnalysisPrompt(
  input: AnalyzerInput,
  outputSchema: Record<string, unknown>,
): string {
  return `
You are the profile-analysis engine for PCP,
the Personal Context Protocol.

Your task is to extract useful, evidence-backed personal context
from the source content below.

SOURCE TYPE:
${input.sourceType}

SOURCE REFERENCE:
${input.sourceValue}

SOURCE CONTENT:
${input.content}

Return only one JSON object that matches this schema exactly:

${JSON.stringify(outputSchema, null, 2)}

Every item must contain exactly these fields:

- category
- value
- evidence
- confidence
- sensitivity
- workspaceId

Never use alternative field names such as:

- context
- fact
- description
- text
- score
- scope

Allowed category values:

- identity
- goal
- interest
- experience
- project
- work_style
- learning_style
- constraint
- principle
- other

Rules:

1. Extract only information supported by concrete evidence.
2. Do not infer that someone is a developer merely because they own a GitHub profile.
3. Technologies should be recorded as experience, never as permanent preferences.
4. Do not exaggerate skill level or claim expertise without strong evidence.
5. Do not infer health, religion, political affiliation, sexuality, ethnicity,
   relationships, or other highly sensitive traits.
6. Keep each value concise and independently understandable.
7. Evidence must reference the exact biography, repository, README,
   project description, document section, or website content.
8. confidence must be a number between 0 and 1.
9. sensitivity must be "public", "personal", or "sensitive".
10. Use workspaceId "global" unless the context clearly belongs to one project.
11. Return no more than 15 high-quality items.
12. If there is insufficient evidence, return:
    {"items":[]}
13. Do not wrap the JSON in Markdown code fences.
14. Do not include explanations before or after the JSON.

Example:

{
  "items": [
    {
      "category": "experience",
      "value": "Has experience building multi-agent AI systems",
      "evidence": "The ClashAI README describes multiple AI models debating and synthesizing responses",
      "confidence": 0.92,
      "sensitivity": "public",
      "workspaceId": "global"
    }
  ]
}
`.trim();
}

function createOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: 15,
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [
                "identity",
                "goal",
                "interest",
                "experience",
                "project",
                "work_style",
                "learning_style",
                "constraint",
                "principle",
                "other",
              ],
            },
            value: {
              type: "string",
              minLength: 3,
            },
            evidence: {
              type: "string",
              minLength: 3,
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            sensitivity: {
              type: "string",
              enum: ["public", "personal", "sensitive"],
            },
            workspaceId: {
              type: "string",
              minLength: 1,
            },
          },
          required: [
            "category",
            "value",
            "evidence",
            "confidence",
            "sensitivity",
            "workspaceId",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * Some models still return sensible information using slightly incorrect
 * field names. This adapter repairs only predictable structural mistakes.
 * It does not invent missing personal context.
 */
function adaptCommonModelMistakes(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    !("items" in value) ||
    !Array.isArray((value as { items?: unknown }).items)
  ) {
    return value;
  }

  const rawItems = (value as { items: unknown[] }).items;

  const items = rawItems.map((rawItem) => {
    if (typeof rawItem !== "object" || rawItem === null) {
      return rawItem;
    }

    const item = rawItem as Record<string, unknown>;

    return {
      category:
        typeof item.category === "string"
          ? item.category
          : inferCategory(item.context ?? item.value),
      value:
        item.value ??
        item.context ??
        item.fact ??
        item.text ??
        item.description,
      evidence:
        item.evidence ??
        item.source ??
        "Evidence was not provided by the analyzer",
      confidence:
        typeof item.confidence === "number"
          ? item.confidence
          : typeof item.score === "number"
            ? item.score
            : 0.7,
      sensitivity:
        typeof item.sensitivity === "string"
          ? item.sensitivity
          : "public",
      workspaceId:
        typeof item.workspaceId === "string"
          ? item.workspaceId
          : typeof item.scope === "string"
            ? item.scope
            : "global",
    };
  });

  return { items };
}

function inferCategory(value: unknown): string {
  if (typeof value !== "string") {
    return "other";
  }

  const text = value.toLowerCase();

  if (
    text.includes("built") ||
    text.includes("developed") ||
    text.includes("worked") ||
    text.includes("experience")
  ) {
    return "experience";
  }

  if (
    text.includes("goal") ||
    text.includes("wants to") ||
    text.includes("aims to")
  ) {
    return "goal";
  }

  if (
    text.includes("interested in") ||
    text.includes("interest")
  ) {
    return "interest";
  }

  if (
    text.includes("student") ||
    text.includes("engineer") ||
    text.includes("developer") ||
    text.includes("filmmaker")
  ) {
    return "identity";
  }

  return "other";
}

function isUsefulContextItem(
  item: z.infer<typeof extractedItemSchema>,
): boolean {
  const weakEvidencePatterns = [
    "the source is a github profile",
    "indicating active participation",
    "appears to",
    "likely",
    "probably",
    "suggests the user",
    "evidence was not provided",
  ];

  const evidence = item.evidence.toLowerCase();

  return !weakEvidencePatterns.some((pattern) =>
    evidence.includes(pattern),
  );
}