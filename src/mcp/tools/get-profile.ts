import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  PCPMemoryStore,
  type PCPMemoryResult,
} from "../../stores/pcp-memory-store.js";

const PROFILE_QUERY = [
  "user identity",
  "education",
  "background",
  "projects",
  "experience",
  "skills",
  "interests",
  "goals",
  "learning style",
  "work style",
  "principles",
  "constraints",
].join(", ");

export function registerGetProfileTool(
  server: McpServer,
  memoryStore: PCPMemoryStore,
): void {
  server.registerTool(
    "pcp_get_profile",
    {
      title: "Get personal context profile",
      description: [
        "Retrieve a compact overview of the user's approved",
        "personal context from PCP.",
        "Use this at the beginning of a conversation when a",
        "general understanding of the user would meaningfully",
        "improve the response.",
        "For focused questions, prefer pcp_search_context.",
      ].join(" "),
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe(
            "Maximum number of profile facts. Default: 12.",
          ),
      },
    },
    async ({ limit }) => {
      try {
        const memories = await memoryStore.searchContext({
          query: PROFILE_QUERY,
          limit: limit ?? 12,
        });

        if (memories.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No approved PCP profile context was found.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: formatProfile(memories),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `PCP profile retrieval failed: ${getErrorMessage(
                error,
              )}`,
            },
          ],
        };
      }
    },
  );
}

function formatProfile(
  memories: PCPMemoryResult[],
): string {
  const grouped = new Map<string, string[]>();

  for (const memory of memories) {
    const category = memory.category ?? "other";
    const value = extractPersonalContext(memory.content);

    const current = grouped.get(category) ?? [];

    if (!current.includes(value)) {
      current.push(value);
    }

    grouped.set(category, current);
  }

  const lines = [
    "Approved PCP personal context profile",
    "",
  ];

  for (const [category, values] of grouped) {
    lines.push(`${formatCategory(category)}:`);

    for (const value of values) {
      lines.push(`- ${value}`);
    }

    lines.push("");
  }

  lines.push(
    "Use this profile only when it is relevant to the current request.",
  );

  lines.push(
    "Do not reveal private context unnecessarily.",
  );

  return lines.join("\n");
}

function extractPersonalContext(content: string): string {
  const match = content.match(
    /^Personal context:\s*(.+)$/m,
  );

  return match?.[1]?.trim() ?? content.trim();
}

function formatCategory(category: string): string {
  return category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}