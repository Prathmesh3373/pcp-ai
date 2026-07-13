import Supermemory from "supermemory";

import type { ReviewedContextItem } from "../review.js";

export interface SaveContextResult {
  stored: number;
  failed: number;
}

export interface PCPMemoryResult {
  documentId: string;
  content: string;
  score: number;
  title?: string;
  category?: string;
  workspaceId?: string;
  sensitivity?: string;
  evidence?: string;
}

export interface SearchContextOptions {
  query: string;
  limit?: number;
  subjectId?: string;
  workspaceId?: string;
}

interface SupermemorySearchClient {
  search?: {
    documents?: (
      input: Record<string, unknown>,
    ) => Promise<unknown>;

    memories?: (
      input: Record<string, unknown>,
    ) => Promise<unknown>;

    execute?: (
      input: Record<string, unknown>,
    ) => Promise<unknown>;
  };
}

export class PCPMemoryStore {
  private readonly client: Supermemory;

  constructor(
    private readonly baseUrl =
      process.env.SUPERMEMORY_BASE_URL ??
      "http://localhost:6767",
    apiKey =
      process.env.SUPERMEMORY_API_KEY ??
      "pcp-local-development",
  ) {
    this.client = new Supermemory({
      baseURL: this.baseUrl,
      apiKey,
    });
  }

  async checkConnection(): Promise<void> {
    try {
      const response = await fetch(this.baseUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch {
      throw new Error(
        [
          "PCP local memory service is not running.",
          "Start the local memory service and try again.",
        ].join(" "),
      );
    }
  }

  async saveApprovedItems(
    items: ReviewedContextItem[],
    subjectId = "local-user",
  ): Promise<SaveContextResult> {
    let stored = 0;
    let failed = 0;

    for (const item of items) {
      if (item.reviewStatus !== "approved") {
        continue;
      }

      try {
        await this.client.add({
          content: buildMemoryContent(item),

          containerTag: createContainerTag(
            subjectId,
            item.workspaceId,
          ),

          metadata: {
            pcpCategory: item.category,
            pcpWorkspaceId: item.workspaceId,
            pcpSensitivity: item.sensitivity,
            pcpConfidence: item.confidence,
            pcpEvidence: item.evidence,
            pcpVerification: "user-approved",
            pcpStoredAt: new Date().toISOString(),
          },
        });

        stored += 1;
      } catch (error) {
        failed += 1;

        const message = getErrorMessage(error);

        console.error(`Could not save: ${item.value}`);
        console.error(`  ${message}`);

        if (
          message.includes("container_tag_merge_job") ||
          message.includes(
            "Failed to verify container tag write state",
          )
        ) {
          throw new Error(
            [
              "PCP local memory database is incompatible",
              "with the running local service.",
              "Restart it using a fresh data directory",
              "and try again.",
            ].join(" "),
          );
        }
      }
    }

    return {
      stored,
      failed,
    };
  }

  async searchContext({
    query,
    limit = 8,
    subjectId = "local-user",
    workspaceId = "global",
  }: SearchContextOptions): Promise<PCPMemoryResult[]> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      throw new Error(
        "Context search query cannot be empty.",
      );
    }

    const safeLimit = normalizeLimit(limit);

    const containerTag = createContainerTag(
      subjectId,
      workspaceId,
    );

    const response = await this.executeSearch({
      query: normalizedQuery,
      limit: safeLimit,
      containerTag,
    });

    const results = normalizeSearchResponse(
      response,
      safeLimit,
    );

    if (
      results.length === 0 &&
      process.env.PCP_DEBUG === "true"
    ) {
      console.error(
        "[PCP DEBUG] Search query:",
        normalizedQuery,
      );

      console.error(
        "[PCP DEBUG] Container tag:",
        containerTag,
      );

      console.error(
        "[PCP DEBUG] Raw search response:",
        JSON.stringify(response, null, 2),
      );
    }

    return results;
  }

  private async executeSearch({
    query,
    limit,
    containerTag,
  }: {
    query: string;
    limit: number;
    containerTag: string;
  }): Promise<unknown> {
    const client =
      this.client as unknown as SupermemorySearchClient;

    /*
     * Prefer document search because PCP saves each approved
     * context item as a separate document with metadata.
     */
    if (
      client.search &&
      typeof client.search.documents === "function"
    ) {
      return client.search.documents({
        q: query,
        limit,
        containerTags: [containerTag],
      });
    }

    /*
     * Support SDK versions that expose memory search directly.
     */
    if (
      client.search &&
      typeof client.search.memories === "function"
    ) {
      return client.search.memories({
        q: query,
        limit,
        containerTag,
        searchMode: "hybrid",
      });
    }

    /*
     * Final fallback for SDK versions exposing execute().
     */
    if (
      client.search &&
      typeof client.search.execute === "function"
    ) {
      return client.search.execute({
        q: query,
        limit,
        containerTag,
        threshold: 0,
        rerank: false,
        rewriteQuery: false,
      });
    }

    throw new Error(
      [
        "The installed Supermemory SDK does not expose",
        "a supported search method.",
        "Expected search.documents(), search.memories(),",
        "or search.execute().",
      ].join(" "),
    );
  }
}

function normalizeSearchResponse(
  response: unknown,
  limit: number,
): PCPMemoryResult[] {
  const responseRecord = asRecord(response);

  if (!responseRecord) {
    return [];
  }

  const rawResults =
    readArray(responseRecord, "results") ??
    readArray(responseRecord, "documents") ??
    readArray(responseRecord, "memories") ??
    readArray(responseRecord, "data") ??
    [];

  const normalized: PCPMemoryResult[] = [];

  for (const rawResult of rawResults) {
    if (typeof rawResult === "string") {
      const content = rawResult.trim();

      if (content) {
        normalized.push({
          documentId: createFallbackId(normalized.length),
          content,
          score: 0,
        });
      }

      continue;
    }

    const result = asRecord(rawResult);

    if (!result) {
      continue;
    }

    const nestedDocument =
      asRecord(result.document) ??
      asRecord(result.memory);

    const metadata =
      asRecord(result.metadata) ??
      asRecord(result.documentMetadata) ??
      asRecord(nestedDocument?.metadata);

    const documentId =
      readString(result, "documentId") ??
      readString(result, "document_id") ??
      readString(result, "docId") ??
      readString(result, "id") ??
      readString(nestedDocument, "id") ??
      createFallbackId(normalized.length);

    const title =
      readString(result, "title") ??
      readString(nestedDocument, "title") ??
      readString(metadata, "title");

    const resultScore =
      readNumber(result, "score") ??
      readNumber(result, "similarity") ??
      readNumber(result, "relevance") ??
      readNumber(result, "rank") ??
      0;

    const chunks =
      readArray(result, "chunks") ??
      readArray(result, "matchedChunks") ??
      readArray(result, "matches") ??
      [];

    if (chunks.length > 0) {
      for (const rawChunk of chunks) {
        if (typeof rawChunk === "string") {
          const content = rawChunk.trim();

          if (!content) {
            continue;
          }

          normalized.push({
            documentId,
            content,
            score: resultScore,
            title,
            category: readMetadataString(
              metadata,
              "pcpCategory",
            ),
            workspaceId: readMetadataString(
              metadata,
              "pcpWorkspaceId",
            ),
            sensitivity: readMetadataString(
              metadata,
              "pcpSensitivity",
            ),
            evidence: readMetadataString(
              metadata,
              "pcpEvidence",
            ),
          });

          continue;
        }

        const chunk = asRecord(rawChunk);

        if (!chunk) {
          continue;
        }

        const content = readContent(chunk);

        if (!content) {
          continue;
        }

        const chunkMetadata =
          asRecord(chunk.metadata) ?? metadata;

        normalized.push({
          documentId,
          content,
          score:
            readNumber(chunk, "score") ??
            readNumber(chunk, "similarity") ??
            readNumber(chunk, "relevance") ??
            resultScore,
          title,
          category: readMetadataString(
            chunkMetadata,
            "pcpCategory",
          ),
          workspaceId: readMetadataString(
            chunkMetadata,
            "pcpWorkspaceId",
          ),
          sensitivity: readMetadataString(
            chunkMetadata,
            "pcpSensitivity",
          ),
          evidence: readMetadataString(
            chunkMetadata,
            "pcpEvidence",
          ),
        });
      }

      continue;
    }

    const content =
      readContent(result) ??
      (nestedDocument
        ? readContent(nestedDocument)
        : undefined);

    if (!content) {
      continue;
    }

    normalized.push({
      documentId,
      content,
      score: resultScore,
      title,
      category: readMetadataString(
        metadata,
        "pcpCategory",
      ),
      workspaceId: readMetadataString(
        metadata,
        "pcpWorkspaceId",
      ),
      sensitivity: readMetadataString(
        metadata,
        "pcpSensitivity",
      ),
      evidence: readMetadataString(
        metadata,
        "pcpEvidence",
      ),
    });
  }

  return deduplicateResults(normalized)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit);
}

function buildMemoryContent(
  item: ReviewedContextItem,
): string {
  return [
    `Personal context: ${item.value}`,
    `Category: ${item.category}`,
    `Workspace: ${item.workspaceId}`,
    `Evidence: ${item.evidence}`,
    `Confidence: ${item.confidence}`,
    `Sensitivity: ${item.sensitivity}`,
    "Verification: user-approved",
  ].join("\n");
}

function createContainerTag(
  subjectId: string,
  workspaceId: string,
): string {
  return [
    "pcp",
    sanitize(subjectId),
    sanitize(workspaceId || "global"),
  ].join("-");
}

function sanitize(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return sanitized || "default";
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 8;
  }

  return Math.min(
    Math.max(Math.floor(limit), 1),
    20,
  );
}

function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readArray(
  record: Record<string, unknown> | undefined,
  key: string,
): unknown[] | undefined {
  if (!record) {
    return undefined;
  }

  const value = record[key];

  return Array.isArray(value)
    ? value
    : undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!record) {
    return undefined;
  }

  const value = record[key];

  return typeof value === "string"
    ? value
    : undefined;
}

function readNumber(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!record) {
    return undefined;
  }

  const value = record[key];

  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : undefined;
}

function readContent(
  record: Record<string, unknown>,
): string | undefined {
  const value =
    readString(record, "content") ??
    readString(record, "text") ??
    readString(record, "memory") ??
    readString(record, "chunk") ??
    readString(record, "body") ??
    readString(record, "summary");

  const normalized = value?.trim();

  return normalized || undefined;
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return readString(metadata, key);
}

function createFallbackId(index: number): string {
  return `pcp-result-${index + 1}`;
}

function deduplicateResults(
  results: PCPMemoryResult[],
): PCPMemoryResult[] {
  const seen = new Set<string>();
  const unique: PCPMemoryResult[] = [];

  for (const result of results) {
    const key = result.content
      .trim()
      .toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(result);
  }

  return unique;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}