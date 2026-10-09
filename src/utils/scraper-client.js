const { ApiError } = require("./api-error");

let tlsClientFetch = null;
let tlsClientIdentifier = null;
try {
  const tls = require("tls-client-node");
  tlsClientFetch = tls.fetch;
  tlsClientIdentifier = tls.ClientIdentifier?.chrome_120 || "chrome_120";
} catch (_e) {
  // tls-client-node not available or unsupported on this platform
}

let gotScrapingModule = null;
async function getGotScraping() {
  if (!gotScrapingModule) {
    try {
      const mod = await import("got-scraping");
      gotScrapingModule = mod.gotScraping;
    } catch (_e) {
      gotScrapingModule = null;
    }
  }
  return gotScrapingModule;
}

// In-memory cache for recent responses (URL -> { timestamp, data })
const cache = new Map();
const DEFAULT_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// Session cookies extracted from stealth solver (domain -> { cookieHeader, userAgent, updatedAt })
const sessionCookies = new Map();
const SESSION_COOKIE_TTL = 2 * 60 * 60 * 1000; // 2 hours

// Concurrency mutex to prevent running multiple Puppeteer instances simultaneously
let pendingSolverPromise = null;

function isCloudflareBlock(text, status) {
  if (typeof text !== "string") return false;
  if (status === 403 || status === 503) {
    if (
      text.includes("Just a moment...") ||
      text.includes("cf-browser-verification") ||
      text.includes("Checking your browser") ||
      text.includes("Cloudflare") ||
      text.includes("Attention Required! | Cloudflare")
    ) {
      return true;
    }
  }
  return (
    text.includes("<title>Just a moment...</title>") ||
    text.includes("cf-browser-verification")
  );
}

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Upgrade-Insecure-Requests": "1",
};

const SOCIAL_CRAWLER_UAS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Twitterbot/1.0",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
];

/**
 * Lightweight, RAM-optimized Puppeteer Stealth solver
 * Launches only when direct HTTP requests encounter Cloudflare challenges.
 * Aborts heavy media/fonts to stay well below Render's 512MB RAM cap.
 */
async function solveWithPuppeteerStealth(url, referer = null, timeoutMs = 25000) {
  // If a solver is already running, wait for it instead of spawning parallel browsers
  if (pendingSolverPromise) {
    try {
      await pendingSolverPromise;
      // After waiting, check if session cookie is now available
      const host = new URL(url).hostname;
      if (sessionCookies.has(host)) {
        // Try fast HTTP with newly resolved cookie
        return await fetchHtmlFast(url, { referer, timeoutMs });
      }
    } catch (_e) {}
  }

  const solverTask = (async () => {
    let browser = null;
    try {
      const puppeteer = require("puppeteer-extra");
      const StealthPlugin = require("puppeteer-extra-plugin-stealth");
      puppeteer.use(StealthPlugin());

      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
        ],
      });

      const page = await browser.newPage();

      // Intercept and cancel heavy assets to reduce RAM consumption to ~80MB
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const type = req.resourceType();
        if (["image", "media", "font"].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      if (referer) {
        await page.setExtraHTTPHeaders({ Referer: referer });
      }

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });

      // Poll until challenge resolves or timeout
      let retries = 0;
      let content = "";
      while (retries < 6) {
        content = await page.content();
        if (
          !content.includes("Just a moment...") &&
          !content.includes("cf-browser-verification") &&
          !content.includes("Checking your browser") &&
          content.length > 500
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
        retries++;
      }

      // Save session cookies and user-agent for fast HTTP reuse
      try {
        const cookies = await page.cookies();
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        const ua = await page.evaluate(() => navigator.userAgent);
        const host = new URL(url).hostname;

        if (cookieHeader) {
          sessionCookies.set(host, {
            cookieHeader,
            userAgent: ua,
            updatedAt: Date.now(),
          });
        }
      } catch (_e) {}

      return content;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  })();

  pendingSolverPromise = solverTask;
  try {
    return await solverTask;
  } finally {
    pendingSolverPromise = null;
  }
}

/**
 * Fast HTTP request using stored cookies, TLS emulation, or social crawler bypass
 */
async function fetchHtmlFast(url, options = {}) {
  const { referer = null, timeoutMs = 12000 } = options;
  const host = new URL(url).hostname;
  const session = sessionCookies.get(host);

  const isSessionValid = session && Date.now() - session.updatedAt < SESSION_COOKIE_TTL;
  const cookieHeader = isSessionValid ? session.cookieHeader : null;
  const customUa = isSessionValid ? session.userAgent : null;

  const baseHeaders = {
    ...DEFAULT_HEADERS,
    ...(customUa ? { "User-Agent": customUa } : {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(options.headers || {}),
    ...(referer ? { Referer: referer } : {}),
  };

  // 1. Try with tls-client-node
  if (tlsClientFetch) {
    try {
      const response = await tlsClientFetch(url, {
        clientIdentifier: tlsClientIdentifier,
        headers: baseHeaders,
        timeoutSeconds: Math.ceil(timeoutMs / 1000),
      });

      const status = response.status;
      const text = await response.text();

      if (status >= 200 && status < 400 && !isCloudflareBlock(text, status)) {
        if (text && text.length > 200) {
          return text;
        }
      }
    } catch (_err) {}
  }

  // 2. Try with got-scraping
  try {
    const gotScraping = await getGotScraping();
    if (gotScraping) {
      const response = await gotScraping.get(url, {
        headers: baseHeaders,
        timeout: { request: timeoutMs },
        throwHttpErrors: false,
      });

      const status = response.statusCode;
      const text = response.body;

      if (status >= 200 && status < 400 && !isCloudflareBlock(text, status)) {
        if (text && text.length > 200) {
          return text;
        }
      }
    }
  } catch (_err) {}

  // 3. Try social crawlers (Facebook, Twitter) which Cloudflare frequently exempts from Turnstile
  for (const crawlerUa of SOCIAL_CRAWLER_UAS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);

      const crawlerHeaders = {
        ...baseHeaders,
        "User-Agent": crawlerUa,
      };

      const response = await fetch(url, {
        headers: crawlerHeaders,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const status = response.status;
      const text = await response.text();

      if (status >= 200 && status < 400 && !isCloudflareBlock(text, status)) {
        if (text && text.length > 200) {
          return text;
        }
      }
    } catch (_err) {}
  }

  return null;
}

/**
 * Master HTML fetcher with Cache -> Fast HTTP -> Puppeteer Stealth solver
 */
async function fetchHtml(url, options = {}) {
  const {
    referer = null,
    timeoutMs = 15000,
    useCache = false,
    cacheTtlMs = DEFAULT_CACHE_TTL,
  } = options;

  const cacheKey = `html:${url}`;
  if (useCache && cache.has(cacheKey)) {
    const entry = cache.get(cacheKey);
    if (Date.now() - entry.timestamp < cacheTtlMs) {
      return entry.data;
    }
  }

  // Step 1: Attempt fast HTTP (using cookies or TLS emulation)
  try {
    const fastContent = await fetchHtmlFast(url, { referer, timeoutMs });
    if (fastContent) {
      if (useCache) {
        cache.set(cacheKey, { timestamp: Date.now(), data: fastContent });
      }
      return fastContent;
    }
  } catch (_err) {}

  // Step 2: Fall back to internal Puppeteer Stealth solver
  try {
    const stealthContent = await solveWithPuppeteerStealth(url, referer, 25000);
    if (stealthContent && !isCloudflareBlock(stealthContent, 200) && stealthContent.length > 500) {
      if (useCache) {
        cache.set(cacheKey, { timestamp: Date.now(), data: stealthContent });
      }
      return stealthContent;
    }
  } catch (stealthErr) {
    console.warn(`[ScraperClient]: Stealth solver failed: ${stealthErr.message}`);
  }

  // Return stale cache if available
  if (cache.has(cacheKey)) {
    console.warn(`[ScraperClient]: Returning stale cache for ${url}.`);
    return cache.get(cacheKey).data;
  }

  throw new ApiError(
    500,
    `No se pudo obtener contenido desde ${new URL(url).hostname}`,
    "Error al conectar con la fuente tras agotar métodos internos"
  );
}

/**
 * Master JSON fetcher
 */
async function fetchJson(url, options = {}) {
  const {
    referer = null,
    timeoutMs = 12000,
    method = "GET",
    data = null,
  } = options;

  const host = new URL(url).hostname;
  const session = sessionCookies.get(host);
  const cookieHeader = session && Date.now() - session.updatedAt < SESSION_COOKIE_TTL
    ? session.cookieHeader
    : null;

  const headers = {
    ...DEFAULT_HEADERS,
    Accept: "application/json, text/javascript, */*; q=0.01",
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(options.headers || {}),
    ...(referer ? { Referer: referer } : {}),
  };

  // 1. Primary: tls-client-node
  if (tlsClientFetch && method === "GET") {
    try {
      const response = await tlsClientFetch(url, {
        clientIdentifier: tlsClientIdentifier,
        headers,
        timeoutSeconds: Math.ceil(timeoutMs / 1000),
      });

      if (response.status >= 200 && response.status < 400) {
        const json = await response.json();
        return json;
      }
    } catch (_e) {}
  }

  // 2. Secondary: got-scraping
  try {
    const gotScraping = await getGotScraping();
    if (gotScraping) {
      const response = await gotScraping({
        url,
        method,
        headers,
        json: data || undefined,
        responseType: "json",
        timeout: { request: timeoutMs },
        throwHttpErrors: false,
      });

      if (response.statusCode >= 200 && response.statusCode < 400) {
        return response.body;
      }
    }
  } catch (_e) {}

  // 3. Tertiary: Native fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      return await response.json();
    }
  } catch (_e) {}

  return null;
}

module.exports = {
  fetchHtml,
  fetchJson,
};
