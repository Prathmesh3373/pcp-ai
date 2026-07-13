import type { SourceConfiguration } from "./init.js";

export interface LoadedSource {
  type: SourceConfiguration["type"];
  originalValue: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SourceLoader {
  supports(source: SourceConfiguration): boolean;
  load(source: SourceConfiguration): Promise<LoadedSource>;
}