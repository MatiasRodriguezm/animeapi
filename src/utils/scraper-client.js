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
    return true;
  }
  return (
    text.includes("<title>Just a moment...</title>") ||
    text.includes("cf-browser-verification") ||
    text.includes("Checking your browser") ||
    text.includes("Attention Required! | Cloudflare")
  );
}

// Multi-profile rotation (Desktop, Social Crawler Whitelists, Mobile)
const HEADER_PROFILES = [
  // Profile 1: Desktop Chrome 124
  {
    name: "Chrome 124",
    headers: {
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
    },
  },
  // Profile 2: Facebook Crawler (Whitelisted by Cloudflare for link preview cards)
  {
    name: "Facebook Crawler",
    headers: {
      "User-Agent":
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      Accept: "*/*",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
  },
  // Profile 3: Twitterbot (Whitelisted by Cloudflare)
  {
    name: "Twitterbot",
    headers: {
      "User-Agent": "Twitterbot/1.0",
      Accept: "*/*",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
  },
  // Profile 4: Mobile Safari (often bypasses desktop Turnstile)
  {
    name: "Mobile Safari",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
  },
];

/**
 * Robust HTML fetcher with multi-profile TLS emulation and fallback mechanisms
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

  let lastError = null;

  // Try each header profile (Desktop Chrome -> Facebook Crawler -> Twitterbot -> Mobile)
  for (const profile of HEADER_PROFILES) {
    const headers = {
      ...profile.headers,
      ...(options.headers || {}),
      ...(referer ? { Referer: referer } : {}),
    };

    // 1. Primary: tls-client-node (Emulates TLS fingerprint)
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
        lastError = new Error(`[${profile.name}] returned status ${status} or challenge`);
      } catch (err) {
        lastError = err;
      }
    }

    // 2. Secondary: got-scraping (Pure JS HTTP/2)
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
        lastError = new Error(`[${profile.name}] got-scraping status ${status}`);
      }
    } catch (err) {
      lastError = err;
    }
  }

  // 3. Tertiary: Native fetch with crawler user-agent
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      headers: {
        "User-Agent": HEADER_PROFILES[1].headers["User-Agent"],
        Accept: "*/*",
        ...(referer ? { Referer: referer } : {}),
      },
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

  // Return stale cache if available
  if (cache.has(cacheKey)) {
    console.warn(`[ScraperClient]: Returning stale cache for ${url}`);
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
    ...HEADER_PROFILES[0].headers,
    Accept: "application/json, text/javascript, */*; q=0.01",
    ...(options.headers || {}),
    ...(referer ? { Referer: referer } : {}),
  };

  if (tlsClientFetch && method === "GET") {
    try {
      const response = await tlsClientFetch(url, {
        clientIdentifier: tlsClientIdentifier,
        headers,
        timeoutSeconds: Math.ceil(timeoutMs / 1000),
      });

      if (response.status >= 200 && response.status < 400) {
        return await response.json();
      }
    } catch (_e) {}
  }

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
