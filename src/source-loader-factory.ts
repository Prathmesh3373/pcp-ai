import type { SourceConfiguration } from "./init.js";
import type {
  LoadedSource,
  SourceLoader,
} from "./source-loader.js";

import { GitHubSourceLoader } from "./sources/github-source.js";
import { LinkedInSourceLoader } from "./sources/linkedin-source.js";
import { TextSourceLoader } from "./sources/text-source.js";
import { WebsiteSourceLoader } from "./sources/website-source.js";
import { DocumentSourceLoader } from "./sources/document-source.js";

const loaders: SourceLoader[] = [
  new GitHubSourceLoader(),
  new WebsiteSourceLoader(),
  new LinkedInSourceLoader(),
  new TextSourceLoader(),
    new DocumentSourceLoader(),
];

export async function loadSource(
  source: SourceConfiguration,
): Promise<LoadedSource> {
  const loader = loaders.find((candidate) =>
    candidate.supports(source),
  );

  if (!loader) {
    throw new Error(
      `Source type "${source.type}" has not been implemented yet.`,
    );
  }

  return loader.load(source);
}