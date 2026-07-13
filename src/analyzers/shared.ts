import { z } from "zod";

import type {
  AnalyzerInput,
  AnalyzerResult,
} from "../analyzer.js";

export const contextItemSchema = z.object({
  category: z.enum([
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
  ]),
  value: z.string().min(3),
  evidence: z.string().min(3),
  confidence: z.number().min(0).max(1),
  sensitivity: z.enum([
    "public",
    "personal",
    "sensitive",
  ]),
  workspaceId: z.string().min(1),
});

export const analyzerResultSchema = z.object({
  items: z.array(contextItemSchema).max(15),
});

export const contextOutputJsonSchema = {
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
            enum: [
              "public",
              "personal",
              "sensitive",
            ],
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
} as const;

export const geminiContextOutputSchema = {
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
          },
          evidence: {
            type: "string",
          },
          confidence: {
            type: "number",
          },
          sensitivity: {
            type: "string",
            enum: ["public", "personal", "sensitive"],
          },
          workspaceId: {
            type: "string",
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
      },
    },
  },
  required: ["items"],
} as const;

export function buildAnalyzerPrompt(
  input: AnalyzerInput,
): string {
  return `
You are the profile-analysis engine for PCP,
the Personal Context Protocol.

Analyze the source and extract useful,
evidence-backed personal context.

SOURCE TYPE:
${input.sourceType}

SOURCE REFERENCE:
${input.sourceValue}

SOURCE CONTENT:
${input.content}

Extract only information supported by concrete evidence.

Useful context includes:

- identity and background
- goals
- interests
- projects
- previous work and experience
- work style
- learning style
- constraints
- principles and recurring ideas

Rules:

1. Do not invent information.
2. Do not exaggerate expertise.
3. A technology previously used is experience,
   not a permanent technology preference.
4. Do not infer health, religion, political affiliation,
   sexuality, ethnicity, relationships, or other highly
   sensitive characteristics.
5. Every item must include precise evidence.
6. Keep every value concise and independently understandable.
7. Use workspaceId "global" unless the information clearly
   belongs to one particular project.
8. confidence must be between 0 and 1.
9. Return no more than 15 high-quality items.
10. If there is insufficient evidence, return an empty items array.
`.trim();
}

export function validateAnalyzerResult(
  value: unknown,
): AnalyzerResult {
  const result = analyzerResultSchema.safeParse(value);

  if (!result.success) {
    throw new Error(
      `Provider returned an invalid PCP context structure:\n${result.error.message}`,
    );
  }

  return {
    items: result.data.items.filter(isUsefulItem),
  };
}

export function parseJsonText(value: string): unknown {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(normalized);
  } catch {
    throw new Error(
      `Provider returned malformed JSON:\n${value}`,
    );
  }
}

function isUsefulItem(
  item: z.infer<typeof contextItemSchema>,
): boolean {
  const weakPatterns = [
    "appears to",
    "probably",
    "likely",
    "suggests the user",
    "the source is a github profile",
    "indicating active participation",
  ];

  const evidence = item.evidence.toLowerCase();

  return !weakPatterns.some((pattern) =>
    evidence.includes(pattern),
  );
}