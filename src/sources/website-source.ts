import * as cheerio from "cheerio";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import type { SourceConfiguration } from "../init.js";
import type {
  LoadedSource,
  SourceLoader,
} from "../source-loader.js";

const STATIC_REQUEST_TIMEOUT_MS = 15_000;
const RENDER_TIMEOUT_MS = 30_000;
const BOOT_SCREEN_TIMEOUT_MS = 25_000;

const MAX_CONTENT_LENGTH = 40_000;
const MAX_BODY_TEXT_LENGTH = 15_000;

const MIN_STATIC_MEANINGFUL_TEXT_LENGTH = 300;
const MIN_RENDERED_MEANINGFUL_TEXT_LENGTH = 100;

type ExtractionMode = "static" | "rendered";

interface ExtractedWebsiteContent {
  title: string;
  description: string;
  content: string;
  meaningfulTextLength: number;
  extractionMode: ExtractionMode;
}

interface BrowserLaunchAttempt {
  name: string;
  options: Parameters<typeof chromium.launch>[0];
}

export class WebsiteSourceLoader implements SourceLoader {
  supports(source: SourceConfiguration): boolean {
    return source.type === "website";
  }

  async load(
    source: SourceConfiguration,
  ): Promise<LoadedSource> {
    const websiteUrl = validateWebsiteUrl(source.value);

    let staticExtraction:
      | ExtractedWebsiteContent
      | undefined;

    try {
      const html = await fetchWebsiteHtml(websiteUrl);

      staticExtraction = extractWebsiteContentFromHtml(
        html,
        websiteUrl,
        "static",
      );
    } catch (error) {
      debugLog(
        `Static website extraction failed: ${getErrorMessage(
          error,
        )}`,
      );
    }

    const needsRenderedExtraction =
      !staticExtraction ||
      staticExtraction.meaningfulTextLength <
        MIN_STATIC_MEANINGFUL_TEXT_LENGTH ||
      looksLikeClientRenderedShell(staticExtraction) ||
      looksLikeBootOnlyContent(staticExtraction);

    let finalExtraction = staticExtraction;

    if (needsRenderedExtraction) {
      try {
        debugLog(
          "Static HTML contained limited content. Trying rendered extraction.",
        );

        finalExtraction =
          await extractRenderedWebsiteContent(websiteUrl);
      } catch (error) {
        debugLog(
          `Rendered website extraction failed: ${getErrorMessage(
            error,
          )}`,
        );

        /*
         * Preserve usable static extraction when browser rendering
         * fails. However, loading screens and empty HTML shells are
         * not considered usable.
         */
        if (
          !finalExtraction ||
          looksLikeClientRenderedShell(finalExtraction) ||
          looksLikeBootOnlyContent(finalExtraction)
        ) {
          throw new Error(
            [
              "PCP could not load the rendered website.",
              getErrorMessage(error),
            ].join("\n"),
          );
        }
      }
    }

    if (
      !finalExtraction ||
      finalExtraction.meaningfulTextLength <
        MIN_RENDERED_MEANINGFUL_TEXT_LENGTH ||
      looksLikeBootOnlyContent(finalExtraction)
    ) {
      throw new Error(
        [
          "PCP could not extract enough meaningful text from this website.",
          "",
          "The page may still be displaying a loading screen, require authentication,",
          "block automated browsers, or store most information inside images.",
          "",
          "You can retry or paste the website information manually.",
        ].join("\n"),
      );
    }

    return {
      type: "website",
      originalValue: source.value,
      title: finalExtraction.title,
      content: finalExtraction.content,
      metadata: {
        url: websiteUrl,
        description: finalExtraction.description,
        extractionMode: finalExtraction.extractionMode,
      },
    };
  }
}

function validateWebsiteUrl(value: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value.trim());
  } catch {
    throw new Error(
      "The provided website URL is invalid.",
    );
  }

  if (
    parsedUrl.protocol !== "http:" &&
    parsedUrl.protocol !== "https:"
  ) {
    throw new Error(
      "Website URL must begin with http:// or https://",
    );
  }

  return parsedUrl.toString();
}

async function fetchWebsiteHtml(
  url: string,
): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Safari/537.36",

      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

      "Accept-Language": "en-US,en;q=0.9",
    },

    redirect: "follow",

    signal: AbortSignal.timeout(
      STATIC_REQUEST_TIMEOUT_MS,
    ),
  });

  if (!response.ok) {
    throw new Error(
      `Website request failed with status ${response.status}.`,
    );
  }

  const contentType =
    response.headers.get("content-type");

  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error(
      `Expected HTML but received ${contentType}.`,
    );
  }

  return response.text();
}

async function extractRenderedWebsiteContent(
  websiteUrl: string,
): Promise<ExtractedWebsiteContent> {
  const browser = await launchAvailableBrowser();

  let context: BrowserContext | undefined;

  try {
    context = await browser.newContext({
      viewport: {
        width: 1440,
        height: 1000,
      },

      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Safari/537.36",

      locale: "en-US",
      ignoreHTTPSErrors: false,
    });

    const page = await context.newPage();

    await blockUnnecessaryResources(page);

    await page.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: RENDER_TIMEOUT_MS,
    });

    /*
     * Some websites keep analytics or animation requests open.
     * Therefore networkidle is useful, but not mandatory.
     */
    await page
      .waitForLoadState("networkidle", {
        timeout: 10_000,
      })
      .catch(() => undefined);

    await waitForMeaningfulBody(page);

    await waitForBootScreenToFinish(page);

    /*
     * Scrolling causes lazy-loaded portfolio sections and
     * intersection-observer animations to mount.
     */
    await autoScrollPage(page);

    await waitForStablePageContent(page);

    await expandCommonHiddenSections(page);

    await autoScrollPage(page);

    await waitForStablePageContent(page);

    const renderedHtml = await page.content();

    return extractWebsiteContentFromHtml(
      renderedHtml,
      websiteUrl,
      "rendered",
    );
  } finally {
    if (context) {
      await context
        .close()
        .catch(() => undefined);
    }

    await browser
      .close()
      .catch(() => undefined);
  }
}

async function launchAvailableBrowser(): Promise<Browser> {
  const attempts: BrowserLaunchAttempt[] = [
    {
      name: "Microsoft Edge",
      options: {
        channel: "msedge",
        headless: true,
      },
    },
    {
      name: "Google Chrome",
      options: {
        channel: "chrome",
        headless: true,
      },
    },
    {
      name: "Playwright Chromium",
      options: {
        headless: true,
      },
    },
  ];

  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      debugLog(
        `Trying browser: ${attempt.name}`,
      );

      return await chromium.launch({
        ...attempt.options,

        args: [
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-extensions",
          "--no-first-run",
        ],
      });
    } catch (error) {
      errors.push(
        `${attempt.name}: ${getErrorMessage(error)}`,
      );
    }
  }

  throw new Error(
    [
      "PCP could not launch a browser for rendered website extraction.",
      "",
      "Install Playwright Chromium with:",
      "  npx playwright install chromium",
      "",
      "Browser attempts:",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"),
  );
}

async function blockUnnecessaryResources(
  page: Page,
): Promise<void> {
  await page.route("**/*", async (route) => {
    const resourceType =
      route.request().resourceType();

    /*
     * JavaScript and stylesheets must remain available because
     * they are required for React/Vite/Next.js rendering.
     */
    if (
      resourceType === "image" ||
      resourceType === "media" ||
      resourceType === "font"
    ) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

async function waitForMeaningfulBody(
  page: Page,
): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const bodyText =
          document.body?.innerText
            ?.replace(/\s+/g, " ")
            .trim() ?? "";

        return bodyText.length >= 100;
      },
      undefined,
      {
        timeout: 12_000,
      },
    )
    .catch(() => undefined);
}

async function waitForBootScreenToFinish(
  page: Page,
): Promise<void> {
  const initialText = await readPageBodyText(page);

  if (!containsBootScreenSignals(initialText)) {
    await waitForStablePageContent(page);
    return;
  }

  debugLog(
    "Boot screen detected. Waiting for the main website content.",
  );

  await page
    .waitForFunction(
      ({
        previousText,
        previousLength,
      }: {
        previousText: string;
        previousLength: number;
      }) => {
        const currentText =
          document.body?.innerText
            ?.replace(/\s+/g, " ")
            .trim() ?? "";

        const bootTextStillVisible =
          /booting portfolio|system_boot_logs|initializing design system|retrieving profile|establishing secure link/i.test(
            currentText,
          );

        const previousPrefix =
          previousText.slice(0, 100);

        const contentChanged =
          currentText.length >=
            Math.max(
              previousLength + 150,
              300,
            ) ||
          (
            previousPrefix.length > 0 &&
            !currentText.includes(previousPrefix)
          );

        return (
          !bootTextStillVisible &&
          contentChanged
        );
      },
      {
        previousText: initialText,
        previousLength: initialText.length,
      },
      {
        timeout: BOOT_SCREEN_TIMEOUT_MS,
      },
    )
    .catch(() => {
      debugLog(
        "Boot-screen wait timed out. Inspecting the latest rendered page.",
      );
    });

  /*
   * Give React, route transitions and exit animations time to
   * finish after the loading screen disappears.
   */
  await page.waitForTimeout(1_500);

  await waitForStablePageContent(page);
}

async function waitForStablePageContent(
  page: Page,
): Promise<void> {
  let previousText = "";
  let stableChecks = 0;

  for (
    let attempt = 0;
    attempt < 12;
    attempt += 1
  ) {
    const currentText =
      await readPageBodyText(page);

    if (
      currentText.length >= 200 &&
      currentText === previousText
    ) {
      stableChecks += 1;
    } else {
      stableChecks = 0;
    }

    if (stableChecks >= 2) {
      return;
    }

    previousText = currentText;

    await page.waitForTimeout(750);
  }
}

async function autoScrollPage(
  page: Page,
): Promise<void> {
  await page
    .evaluate(async () => {
      await new Promise<void>((resolve) => {
        let previousHeight = 0;
        let unchangedHeightCount = 0;
        let steps = 0;

        const timer = window.setInterval(() => {
          const documentHeight = Math.max(
            document.body?.scrollHeight ?? 0,
            document.documentElement
              ?.scrollHeight ?? 0,
          );

          const scrollAmount = Math.max(
            window.innerHeight * 0.8,
            600,
          );

          window.scrollBy({
            top: scrollAmount,
            behavior: "instant",
          });

          if (
            documentHeight === previousHeight
          ) {
            unchangedHeightCount += 1;
          } else {
            unchangedHeightCount = 0;
          }

          previousHeight = documentHeight;
          steps += 1;

          const reachedBottom =
            window.scrollY +
              window.innerHeight >=
            documentHeight - 50;

          if (
            (
              reachedBottom &&
              unchangedHeightCount >= 2
            ) ||
            steps >= 35
          ) {
            window.clearInterval(timer);

            window.scrollTo({
              top: 0,
              behavior: "instant",
            });

            resolve();
          }
        }, 200);
      });
    })
    .catch(() => undefined);

  await page.waitForTimeout(750);
}

async function expandCommonHiddenSections(
  page: Page,
): Promise<void> {
  /*
   * Only click controls that normally reveal content.
   * Do not automatically click navigation links such as
   * About, Projects or Contact because they may navigate away.
   */
  const labels = [
    "View more",
    "Show more",
    "Read more",
    "Load more",
    "See more",
    "View all",
  ];

  for (const label of labels) {
    const locator = page.getByText(label, {
      exact: true,
    });

    const count = Math.min(
      await locator.count(),
      3,
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      await locator
        .nth(index)
        .click({
          timeout: 1_000,
        })
        .catch(() => undefined);
    }
  }

  await page
    .waitForTimeout(500)
    .catch(() => undefined);
}

async function readPageBodyText(
  page: Page,
): Promise<string> {
  const text = await page
    .locator("body")
    .innerText()
    .catch(() => "");

  return cleanText(text);
}

function extractWebsiteContentFromHtml(
  html: string,
  websiteUrl: string,
  extractionMode: ExtractionMode,
): ExtractedWebsiteContent {
  const $ = cheerio.load(html);

  removeWebsiteNoise($);

  const title =
    cleanText($("title").first().text()) ||
    cleanText($("h1").first().text()) ||
    `Website: ${websiteUrl}`;

  const description =
    cleanText(
      $('meta[name="description"]').attr(
        "content",
      ) ?? "",
    ) ||
    cleanText(
      $('meta[property="og:description"]').attr(
        "content",
      ) ?? "",
    );

  const headings = extractUniqueTexts(
    $,
    "h1, h2, h3, h4, h5, h6",
    120,
  );

  const paragraphs = extractUniqueTexts(
    $,
    [
      "main p",
      "article p",
      "section p",
      "[role='main'] p",
      "body p",
    ].join(", "),
    180,
  );

  const listItems = extractUniqueTexts(
    $,
    [
      "main li",
      "article li",
      "section li",
      "[role='main'] li",
      "body li",
    ].join(", "),
    180,
  );

  const semanticBlocks =
    extractSemanticBlocks($);

  const links = extractRelevantLinks(
    $,
    websiteUrl,
  );

  const bodyText = extractCleanBodyText($);

  const meaningfulText = deduplicateTexts([
    ...headings,
    ...paragraphs,
    ...listItems,
    ...semanticBlocks,
    bodyText,
  ])
    .join(" ")
    .trim();

  const content = [
    "WEBSITE PROFILE",
    `URL: ${websiteUrl}`,
    `Extraction mode: ${extractionMode}`,
    `Title: ${title}`,
    `Description: ${
      description || "Not provided"
    }`,
    "",
    "HEADINGS",
    headings.length > 0
      ? headings.join("\n")
      : "No headings found",
    "",
    "PAGE CONTENT",
    paragraphs.length > 0
      ? paragraphs.join("\n\n")
      : bodyText || "No paragraphs found",
    "",
    "SEMANTIC SECTIONS",
    semanticBlocks.length > 0
      ? semanticBlocks.join("\n\n")
      : "No semantic sections found",
    "",
    "LIST ITEMS",
    listItems.length > 0
      ? listItems.join("\n")
      : "No list items found",
    "",
    "VISIBLE PAGE TEXT",
    bodyText || "No additional visible text found",
    "",
    "RELEVANT LINKS",
    links.length > 0
      ? links.join("\n")
      : "No relevant links found",
  ]
    .join("\n")
    .slice(0, MAX_CONTENT_LENGTH);

  return {
    title,
    description,
    content,
    meaningfulTextLength:
      meaningfulText.length,
    extractionMode,
  };
}

function removeWebsiteNoise(
  $: cheerio.CheerioAPI,
): void {
  $(
    [
      "script",
      "style",
      "noscript",
      "svg",
      "iframe",
      "canvas",
      "template",
      "picture",
      "video",
      "audio",
      "form",
      "dialog",
      "[aria-hidden='true']",
      "[hidden]",
      ".cookie-banner",
      ".cookie-consent",
      ".modal",
      ".popup",
      ".toast",
    ].join(", "),
  ).remove();
}

function extractUniqueTexts(
  $: cheerio.CheerioAPI,
  selector: string,
  limit: number,
): string[] {
  const values: string[] = [];

  $(selector).each((_, element) => {
    const value = cleanText(
      $(element).text(),
    );

    if (
      value.length >= 3 &&
      value.length <= 2_000 &&
      !isInterfaceNoise(value)
    ) {
      values.push(value);
    }
  });

  return deduplicateTexts(values).slice(
    0,
    limit,
  );
}

function extractSemanticBlocks(
  $: cheerio.CheerioAPI,
): string[] {
  const values: string[] = [];

  $(
    [
      "main",
      "article",
      "section",
      "[role='main']",
      "[data-section]",
      "[data-testid*='section']",
      "[id*='about']",
      "[id*='project']",
      "[id*='experience']",
      "[id*='skill']",
      "[id*='education']",
      "[id*='work']",
      "[class*='about']",
      "[class*='project']",
      "[class*='experience']",
      "[class*='skill']",
      "[class*='education']",
      "[class*='work']",
    ].join(", "),
  ).each((_, element) => {
    const value = cleanText(
      $(element).text(),
    );

    if (
      value.length >= 40 &&
      value.length <= 5_000 &&
      !isInterfaceNoise(value)
    ) {
      values.push(value);
    }
  });

  return deduplicateTexts(values).slice(
    0,
    80,
  );
}

function extractCleanBodyText(
  $: cheerio.CheerioAPI,
): string {
  const body = $("body").clone();

  body
    .find(
      [
        "script",
        "style",
        "noscript",
        "svg",
        "form",
        "dialog",
        ".cookie-banner",
        ".cookie-consent",
        ".modal",
        ".popup",
        ".toast",
      ].join(", "),
    )
    .remove();

  const value = cleanText(body.text());

  if (
    value.length < 20 ||
    isInterfaceNoise(value)
  ) {
    return "";
  }

  return value.slice(
    0,
    MAX_BODY_TEXT_LENGTH,
  );
}

function extractRelevantLinks(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): string[] {
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const label = cleanText(
      $(element).text(),
    );

    const href = $(element).attr("href");

    if (!href) {
      return;
    }

    try {
      const resolvedUrl = new URL(
        href,
        baseUrl,
      );

      if (
        resolvedUrl.protocol !== "http:" &&
        resolvedUrl.protocol !== "https:"
      ) {
        return;
      }

      const meaningfulLabel =
        label ||
        inferLinkLabel(resolvedUrl);

      if (
        !meaningfulLabel ||
        isInterfaceNoise(meaningfulLabel)
      ) {
        return;
      }

      links.add(
        `${meaningfulLabel}: ${resolvedUrl.toString()}`,
      );
    } catch {
      // Ignore malformed or unsupported URLs.
    }
  });

  return Array.from(links).slice(0, 80);
}

function inferLinkLabel(url: URL): string {
  const host = url.hostname
    .replace(/^www\./, "")
    .toLowerCase();

  if (host.includes("github.com")) {
    return "GitHub";
  }

  if (host.includes("linkedin.com")) {
    return "LinkedIn";
  }

  if (
    host.includes("twitter.com") ||
    host.includes("x.com")
  ) {
    return "X / Twitter";
  }

  if (host.includes("youtube.com")) {
    return "YouTube";
  }

  return host;
}

function looksLikeClientRenderedShell(
  extraction: ExtractedWebsiteContent,
): boolean {
  const content =
    extraction.content.toLowerCase();

  const missingSections = [
    "no headings found",
    "no paragraphs found",
    "no list items found",
    "no semantic sections found",
  ].filter((value) =>
    content.includes(value),
  ).length;

  return missingSections >= 3;
}

function looksLikeBootOnlyContent(
  extraction: ExtractedWebsiteContent,
): boolean {
  const normalized =
    extraction.content.toLowerCase();

  const bootSignals = [
    "system_boot_logs",
    "booting portfolio",
    "initializing design system",
    "retrieving profile",
    "establishing secure link",
  ];

  const detectedSignals =
    bootSignals.filter((signal) =>
      normalized.includes(signal),
    ).length;

  const portfolioSignals = [
    "projects",
    "experience",
    "education",
    "skills",
    "about me",
    "my work",
    "featured work",
    "technologies",
    "contact",
  ];

  const detectedPortfolioSignals =
    portfolioSignals.filter((signal) =>
      normalized.includes(signal),
    ).length;

  return (
    detectedSignals >= 2 &&
    detectedPortfolioSignals === 0
  );
}

function containsBootScreenSignals(
  value: string,
): boolean {
  return /booting portfolio|system_boot_logs|initializing design system|retrieving profile|establishing secure link/i.test(
    value,
  );
}

function deduplicateTexts(
  values: string[],
): string[] {
  const results: string[] = [];
  const normalizedValues = new Set<string>();

  for (const value of values) {
    const cleaned = cleanText(value);

    if (!cleaned) {
      continue;
    }

    const normalized = cleaned.toLowerCase();

    if (normalizedValues.has(normalized)) {
      continue;
    }

    normalizedValues.add(normalized);
    results.push(cleaned);
  }

  return results;
}

function isInterfaceNoise(
  value: string,
): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  /*
   * Section names such as Projects, Skills, Experience,
   * Education and About are meaningful profile information.
   * Therefore they are intentionally not removed here.
   */
  const exactNoise = new Set([
    "menu",
    "close",
    "next",
    "previous",
    "back",
    "open menu",
    "close menu",
    "skip",
    "skip intro",
    "scroll",
    "scroll down",
    "loading",
    "please wait",
  ]);

  return exactNoise.has(normalized);
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function debugLog(message: string): void {
  if (process.env.PCP_DEBUG === "true") {
    console.error(
      `[PCP Website] ${message}`,
    );
  }
}

function getErrorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}