import * as cheerio from "cheerio";

import type { SourceConfiguration } from "../init.js";
import type {
  LoadedSource,
  SourceLoader,
} from "../source-loader.js";

export class LinkedInSourceLoader implements SourceLoader {
  supports(source: SourceConfiguration): boolean {
    return source.type === "linkedin";
  }

  async load(source: SourceConfiguration): Promise<LoadedSource> {
    const profileUrl = validateLinkedInUrl(source.value);

    const response = await fetch(profileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 429 || response.status === 999) {
  throw new Error(
    [
      "LinkedIn blocked automated profile access.",
      "Download your LinkedIn profile as a PDF and add it as a document,",
      "or paste your LinkedIn About, Experience, and Education sections manually.",
    ].join("\n"),
  );
}

    if (!response.ok) {
      throw new Error(
        `LinkedIn request failed with status ${response.status}.`,
      );
    }

    const html = await response.text();
    const extracted = extractLinkedInContent(html, profileUrl);

    if (extracted.isBlocked) {
      throw new Error(
        [
          "LinkedIn did not expose the public profile content.",
          "LinkedIn may require login or may have blocked the request.",
          "",
          "Use one of these alternatives:",
          "1. Choose 'Paste text manually' and paste your LinkedIn profile content.",
          "2. Download your LinkedIn profile as a PDF and add it as a document.",
        ].join("\n"),
      );
    }

    if (extracted.content.length < 100) {
      throw new Error(
        "PCP could not extract enough meaningful information from this LinkedIn profile.",
      );
    }

    return {
      type: "linkedin",
      originalValue: source.value,
      title: extracted.title,
      content: extracted.content,
      metadata: {
        profileUrl,
        description: extracted.description,
      },
    };
  }
}

function validateLinkedInUrl(value: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error("The LinkedIn profile URL is invalid.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  const validHost =
    hostname === "linkedin.com" ||
    hostname === "www.linkedin.com" ||
    hostname.endsWith(".linkedin.com");

  if (!validHost) {
    throw new Error(
      "The supplied URL is not a LinkedIn URL.",
    );
  }

  if (!parsedUrl.pathname.startsWith("/in/")) {
    throw new Error(
      "Enter a LinkedIn personal profile URL such as https://www.linkedin.com/in/username",
    );
  }

  return parsedUrl.toString();
}

function extractLinkedInContent(
  html: string,
  profileUrl: string,
): {
  title: string;
  description: string;
  content: string;
  isBlocked: boolean;
} {
  const $ = cheerio.load(html);

  const pageText = cleanText($("body").text()).toLowerCase();

  const blockedIndicators = [
    "sign in",
    "join linkedin",
    "authwall",
    "login",
    "challenge",
  ];

  const isBlocked = blockedIndicators.some((indicator) =>
    pageText.includes(indicator),
  );

  const title =
    cleanText($('meta[property="og:title"]').attr("content") ?? "") ||
    cleanText($("title").first().text()) ||
    "LinkedIn profile";

  const description =
    cleanText(
      $('meta[property="og:description"]').attr("content") ?? "",
    ) ||
    cleanText(
      $('meta[name="description"]').attr("content") ?? "",
    );

  $("script").remove();
  $("style").remove();
  $("noscript").remove();
  $("svg").remove();
  $("iframe").remove();

  const headings = extractTexts($, "h1, h2, h3");
  const paragraphs = extractTexts($, "p");
  const listItems = extractTexts($, "li");

  const content = [
    "LINKEDIN PUBLIC PROFILE",
    `URL: ${profileUrl}`,
    `Title: ${title}`,
    `Description: ${description || "Not provided"}`,
    "",
    "HEADINGS",
    headings.length > 0
      ? headings.join("\n")
      : "No headings found",
    "",
    "PROFILE CONTENT",
    paragraphs.length > 0
      ? paragraphs.join("\n\n")
      : "No paragraphs found",
    "",
    "ADDITIONAL ITEMS",
    listItems.length > 0
      ? listItems.join("\n")
      : "No list items found",
  ]
    .join("\n")
    .slice(0, 30000);

  return {
    title,
    description,
    content,
    isBlocked,
  };
}

function extractTexts(
  $: cheerio.CheerioAPI,
  selector: string,
): string[] {
  const values = new Set<string>();

  $(selector).each((_, element) => {
    const text = cleanText($(element).text());

    if (text.length >= 3) {
      values.add(text);
    }
  });

  return Array.from(values).slice(0, 100);
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}