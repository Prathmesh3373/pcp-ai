import type { SourceConfiguration } from "../init.js";
import type {
  LoadedSource,
  SourceLoader,
} from "../source-loader.js";

interface GitHubUser {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  public_repos: number;
  followers: number;
  following: number;
  html_url: string;
}

interface GitHubRepository {
  name: string;
  description: string | null;
  language: string | null;
  topics?: string[];
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  html_url: string;
  created_at: string;
  updated_at: string;
}

interface GitHubReadmeResponse {
  content: string;
  encoding: string;
}

interface RepositoryWithReadme {
  repository: GitHubRepository;
  readme: string | null;
}

export class GitHubRateLimitError extends Error {
  constructor(
    public readonly resetAt?: Date,
  ) {
    super("GitHub public API rate limit reached.");
    this.name = "GitHubRateLimitError";
  }
}

export class GitHubSourceLoader implements SourceLoader {
  supports(source: SourceConfiguration): boolean {
    return source.type === "github";
  }

  async load(source: SourceConfiguration): Promise<LoadedSource> {
    const username = extractGitHubUsername(source.value);

    const [user, repositories] = await Promise.all([
      fetchGitHubUser(username),
      fetchGitHubRepositories(username),
    ]);

    const originalRepositories = repositories.filter(
      (repository) => !repository.fork,
    );

    /*
     * For the MVP, analyze only the 10 most recently updated
     * original repositories.
     *
     * This prevents very large prompts when the user has many repos.
     */
    const selectedRepositories = originalRepositories.slice(0, 10);

    const repositoriesWithReadmes = await Promise.all(
      selectedRepositories.map(async (repository) => ({
        repository,
        readme: await fetchRepositoryReadme(
          username,
          repository.name,
        ),
      })),
    );

    return {
      type: "github",
      originalValue: source.value,
      title: `GitHub profile: ${username}`,
      content: buildGitHubContent(
        user,
        repositoriesWithReadmes,
      ),
      metadata: {
        username,
        profileUrl: user.html_url,
        publicRepositories: user.public_repos,
        originalRepositories: originalRepositories.length,
        analyzedRepositories: selectedRepositories.length,
        repositoriesWithReadmes:
          repositoriesWithReadmes.filter(
            ({ readme }) => readme !== null,
          ).length,
      },
    };
  }
}

function extractGitHubUsername(profileUrl: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(profileUrl);
  } catch {
    throw new Error("The supplied GitHub URL is invalid.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (
    hostname !== "github.com" &&
    hostname !== "www.github.com"
  ) {
    throw new Error(
      "The supplied URL is not a GitHub profile URL.",
    );
  }

  const username = parsedUrl.pathname
    .split("/")
    .filter(Boolean)[0];

  if (!username) {
    throw new Error(
      "Could not extract the GitHub username.",
    );
  }

  return username;
}

async function fetchGitHubUser(
  username: string,
): Promise<GitHubUser> {
  const response = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username)}`,
    {
      headers: createGitHubHeaders(),
      signal: AbortSignal.timeout(15000),
    },
  );

  await ensureGitHubResponse(
    response,
    `GitHub user "${username}"`,
  );

  return response.json() as Promise<GitHubUser>;
}

async function fetchGitHubRepositories(
  username: string,
): Promise<GitHubRepository[]> {
  const response = await fetch(
    `https://api.github.com/users/${encodeURIComponent(
      username,
    )}/repos?type=owner&sort=updated&per_page=30`,
    {
      headers: createGitHubHeaders(),
      signal: AbortSignal.timeout(15000),
    },
  );

  await ensureGitHubResponse(
    response,
    "GitHub repositories",
  );

  return response.json() as Promise<GitHubRepository[]>;
}

async function fetchRepositoryReadme(
  username: string,
  repositoryName: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(
        username,
      )}/${encodeURIComponent(repositoryName)}/readme`,
      {
        headers: createGitHubHeaders(),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (
      response.status === 403 ||
      response.status === 429
    ) {
      const remaining = response.headers.get(
        "x-ratelimit-remaining",
      );

      if (
        remaining === "0" ||
        response.status === 429
      ) {
        return null;
      }
    }

    if (!response.ok) {
      return null;
    }

    const payload =
      (await response.json()) as GitHubReadmeResponse;

    if (payload.encoding !== "base64") {
      return null;
    }

    const decodedReadme = Buffer.from(
      payload.content.replace(/\n/g, ""),
      "base64",
    ).toString("utf8");

    return cleanReadme(decodedReadme);
  } catch {
    /*
     * One missing or unavailable README should not stop
     * the entire GitHub profile import.
     */
    return null;
  }
}

async function ensureGitHubResponse(
  response: Response,
  resourceName: string,
): Promise<void> {
  if (response.status === 404) {
    throw new Error(`${resourceName} was not found.`);
  }

  if (
    response.status === 403 ||
    response.status === 429
  ) {
    const remaining = response.headers.get(
      "x-ratelimit-remaining",
    );

    const resetTimestamp = response.headers.get(
      "x-ratelimit-reset",
    );

    if (
      remaining === "0" ||
      response.status === 429
    ) {
      const resetAt = resetTimestamp
        ? new Date(Number(resetTimestamp) * 1000)
        : undefined;

      throw new GitHubRateLimitError(resetAt);
    }

    throw new Error(
      "GitHub denied the request. Please try again later.",
    );
  }

  if (!response.ok) {
    throw new Error(
      `${resourceName} request failed with status ${response.status}.`,
    );
  }
}

function createGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "PCP-Personal-Context-Protocol",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  /*
   * This token is optional.
   * It may be set temporarily by the PCP terminal flow
   * if GitHub's public rate limit is reached.
   */
  const token = process.env.GITHUB_TOKEN;

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function cleanReadme(readme: string): string {
  return readme
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 5000);
}

function buildGitHubContent(
  user: GitHubUser,
  repositories: RepositoryWithReadme[],
): string {
  const profile = [
    `GitHub username: ${user.login}`,
    `Name: ${user.name ?? "Not provided"}`,
    `Bio: ${user.bio ?? "Not provided"}`,
    `Company: ${user.company ?? "Not provided"}`,
    `Location: ${user.location ?? "Not provided"}`,
    `Website: ${user.blog || "Not provided"}`,
    `Public repositories: ${user.public_repos}`,
    `Followers: ${user.followers}`,
    `Following: ${user.following}`,
  ].join("\n");

  const repositoryText = repositories
    .map(({ repository, readme }, index) => {
      return [
        `Repository ${index + 1}: ${repository.name}`,
        `Description: ${
          repository.description ?? "No description"
        }`,
        `Primary language: ${
          repository.language ?? "Not specified"
        }`,
        `Topics: ${
          repository.topics?.join(", ") || "None"
        }`,
        `Stars: ${repository.stargazers_count}`,
        `Archived: ${repository.archived}`,
        `Created: ${repository.created_at}`,
        `Updated: ${repository.updated_at}`,
        `URL: ${repository.html_url}`,
        "",
        "README CONTENT:",
        readme ?? "No README available",
      ].join("\n");
    })
    .join("\n\n------------------------------\n\n");

  return [
    "GITHUB PROFILE",
    profile,
    "",
    "PUBLIC ORIGINAL REPOSITORIES",
    repositoryText || "No original repositories found",
  ].join("\n");
}