import type { AnalyzerProvider } from "./init.ts";

export interface AnalyzerInput {
  sourceType: string;
  sourceValue: string;
  content: string;
}

export interface ExtractedContextItem {
  category:
    | "identity"
    | "goal"
    | "interest"
    | "experience"
    | "project"
    | "work_style"
    | "learning_style"
    | "constraint"
    | "principle"
    | "other";

  value: string;
  evidence: string;
  confidence: number;
  sensitivity: "public" | "personal" | "sensitive";
  workspaceId: string;
}

export interface AnalyzerResult {
  items: ExtractedContextItem[];
}

export interface AnalyzerConfiguration {
  provider: AnalyzerProvider;
  model?: string;
  apiKey?: string;
}

export interface ProfileAnalyzer {
  analyze(input: AnalyzerInput): Promise<AnalyzerResult>;
}