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
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Sec-Ch-Ua":
    '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * Robust HTML fetcher with TLS emulation and fallback mechanisms
 */
async function fetchHtml(url, options = {}) {
  const {
    referer = null,
    timeoutMs = 12000,
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

  const headers = {
    ...DEFAULT_HEADERS,
    ...(options.headers || {}),
    ...(referer ? { Referer: referer } : {}),
  };

  let lastError = null;

  // 1. Primary: tls-client-node (Emulates Chrome TLS fingerprint)
  if (tlsClientFetch) {
    try {
      const response = await tlsClientFetch(url, {
        clientIdentifier: tlsClientIdentifier,
        headers,
        timeoutSeconds: Math.ceil(timeoutMs / 1000),
      });

      const status = response.status;
      const text = await response.text();

      if (status >= 200 && status < 400 && !isCloudflareBlock(text, status)) {
        if (text && text.length > 200) {
          if (useCache) {
            cache.set(cacheKey, { timestamp: Date.now(), data: text });
          }
          return text;
        }
      }
      lastError = new Error(`tls-client returned status ${status} or challenge block`);
    } catch (err) {
      lastError = err;
    }
  }

  // 2. Secondary: got-scraping (Pure JS HTTP/2 + Apify header generator)
  try {
    const gotScraping = await getGotScraping();
    if (gotScraping) {
      const response = await gotScraping.get(url, {
        headers,
        timeout: { request: timeoutMs },
        throwHttpErrors: false,
      });

      const status = response.statusCode;
      const text = response.body;

      if (status >= 200 && status < 400 && !isCloudflareBlock(text, status)) {
        if (text && text.length > 200) {
          if (useCache) {
            cache.set(cacheKey, { timestamp: Date.now(), data: text });
          }
          return text;
        }
      }
      lastError = new Error(`got-scraping returned status ${status} or challenge block`);
    }
  } catch (err) {
    lastError = err;
  }

  // 3. Tertiary: Native Node fetch with browser headers
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const status = response.status;
    const text = await response.text();

    if (status >= 200 && status < 400 && !isCloudflareBlock(text, status)) {
      if (text && text.length > 200) {
        if (useCache) {
          cache.set(cacheKey, { timestamp: Date.now(), data: text });
        }
        return text;
      }
    }
    lastError = new Error(`Native fetch returned status ${status}`);
  } catch (err) {
    lastError = err;
  }

  // Return stale cache if available when all live requests fail
  if (cache.has(cacheKey)) {
    console.warn(`[ScraperClient]: Returning stale cache for ${url} due to live fetch failure.`);
    return cache.get(cacheKey).data;
  }

  throw new ApiError(
    500,
    `No se pudo obtener contenido desde ${new URL(url).hostname}`,
    lastError ? lastError.message : "Error al conectar con la fuente"
  );
}

/**
 * Robust JSON fetcher with TLS emulation
 */
async function fetchJson(url, options = {}) {
  const {
    referer = null,
    timeoutMs = 12000,
    method = "GET",
    data = null,
  } = options;

  const headers = {
    ...DEFAULT_HEADERS,
    Accept: "application/json, text/javascript, */*; q=0.01",
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
