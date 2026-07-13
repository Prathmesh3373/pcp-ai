import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PDFParse } from "pdf-parse";

import type { SourceConfiguration } from "../init.js";
import type {
  LoadedSource,
  SourceLoader,
} from "../source-loader.js";

export class DocumentSourceLoader implements SourceLoader {
  supports(source: SourceConfiguration): boolean {
    return source.type === "document";
  }

  async load(source: SourceConfiguration): Promise<LoadedSource> {
    const filePath = normalizeDocumentPath(source.value);

    await validateDocument(filePath);

    const extension = path.extname(filePath).toLowerCase();

    if (extension === ".pdf") {
      return loadPdf(filePath, source.value);
    }

    if (
      extension === ".txt" ||
      extension === ".md" ||
      extension === ".json"
    ) {
      return loadTextDocument(filePath, source.value);
    }

    throw new Error(
      `Unsupported document format "${extension}". PCP currently supports PDF, TXT, MD, and JSON files.`,
    );
  }
}

function normalizeDocumentPath(value: string): string {
  const trimmedValue = value
  .trim()
  .replace(/^["']|["']$/g, "");

  if (!trimmedValue) {
    throw new Error("Document path cannot be empty.");
  }

  if (trimmedValue.startsWith("file://")) {
    try {
      return fileURLToPath(trimmedValue);
    } catch {
      throw new Error("The supplied file URL is invalid.");
    }
  }

  return path.resolve(trimmedValue);
}

async function validateDocument(filePath: string): Promise<void> {
  let fileStats;

  try {
    fileStats = await stat(filePath);
  } catch {
    throw new Error(`Document was not found at:\n${filePath}`);
  }

  if (!fileStats.isFile()) {
    throw new Error(`The supplied path is not a file:\n${filePath}`);
  }

  const maximumSize = 15 * 1024 * 1024;

  if (fileStats.size > maximumSize) {
    throw new Error(
      "The document is larger than 15 MB. Use a smaller file for the current PCP MVP.",
    );
  }
}

async function loadPdf(
  filePath: string,
  originalValue: string,
): Promise<LoadedSource> {
  const buffer = await readFile(filePath);

  const parser = new PDFParse({
    data: buffer,
  });

  try {
    const result = await parser.getText();

    const content = cleanDocumentText(result.text);

    if (content.length < 50) {
      throw new Error(
        "PCP could not extract meaningful text from this PDF. It may be scanned or image-based.",
      );
    }

    return {
      type: "document",
      originalValue,
      title: `Document: ${path.basename(filePath)}`,
      content: [
        "LOCAL DOCUMENT",
        `Filename: ${path.basename(filePath)}`,
        `File type: PDF`,
        "",
        "DOCUMENT CONTENT",
        content,
      ].join("\n"),
      metadata: {
        filePath,
        filename: path.basename(filePath),
        extension: ".pdf",
        pageCount: result.total,
      },
    };
  } finally {
    await parser.destroy();
  }
}

async function loadTextDocument(
  filePath: string,
  originalValue: string,
): Promise<LoadedSource> {
  const rawContent = await readFile(filePath, "utf8");
  const content = cleanDocumentText(rawContent);

  if (content.length < 20) {
    throw new Error(
      "The document does not contain enough meaningful text.",
    );
  }

  return {
    type: "document",
    originalValue,
    title: `Document: ${path.basename(filePath)}`,
    content: [
      "LOCAL DOCUMENT",
      `Filename: ${path.basename(filePath)}`,
      `File type: ${path.extname(filePath).toUpperCase()}`,
      "",
      "DOCUMENT CONTENT",
      content,
    ].join("\n"),
    metadata: {
      filePath,
      filename: path.basename(filePath),
      extension: path.extname(filePath),
    },
  };
}

function cleanDocumentText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 40000);
}