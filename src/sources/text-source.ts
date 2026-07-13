import type { SourceConfiguration } from "../init.js";
import type {
  LoadedSource,
  SourceLoader,
} from "../source-loader.js";

export class TextSourceLoader implements SourceLoader {
  supports(source: SourceConfiguration): boolean {
    return source.type === "text";
  }

  async load(source: SourceConfiguration): Promise<LoadedSource> {
    return {
      type: "text",
      originalValue: source.value,
      title: "User-provided text",
      content: source.value,
    };
  }
}