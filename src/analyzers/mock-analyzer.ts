import type {
  AnalyzerInput,
  AnalyzerResult,
  ProfileAnalyzer,
} from "../analyzer.ts";

export class MockAnalyzer implements ProfileAnalyzer {
  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    const content = input.content.toLowerCase();

    const items: AnalyzerResult["items"] = [];

    if (content.includes("ai")) {
      items.push({
        category: "interest",
        value: "Interested in artificial intelligence",
        evidence: `Detected repeated reference to AI in ${input.sourceType}.`,
        confidence: 0.8,
        sensitivity: "public",
        workspaceId: "global",
      });
    }

    if (content.includes("entrepreneur")) {
      items.push({
        category: "goal",
        value: "Interested in entrepreneurship",
        evidence: `Entrepreneurship was mentioned in ${input.sourceType}.`,
        confidence: 0.75,
        sensitivity: "public",
        workspaceId: "global",
      });
    }

    if (content.includes("project")) {
      items.push({
        category: "experience",
        value: "Has experience working on projects",
        evidence: `Project-related information was found in ${input.sourceType}.`,
        confidence: 0.7,
        sensitivity: "public",
        workspaceId: "global",
      });
    }

    return {
      items,
    };
  }
}