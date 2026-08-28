const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("node:url");
const { ApiError } = require("../utils/api-error");

const DEFAULT_DOMAIN = "animed23.com";
const MULTIPLAYER_DOMAIN = "animed23.online";

let puppeteerBrowser = null;

async function getPuppeteerBrowser() {
  if (!puppeteerBrowser) {
    const puppeteer = require("puppeteer");
    puppeteerBrowser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  return puppeteerBrowser;
}

async function fetchHtmlWithPuppeteer(url, referer = null) {
  try {
    const browser = await getPuppeteerBrowser();
    const page = await browser.newPage();

    try {
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      );

      if (referer) {
        await page.setExtraHTTPHeaders({ Referer: referer });
      }

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });

      let retries = 0;
      while (retries < 8) {
        const content = await page.content();
        const $ = cheerio.load(content);
        const title = $("title").text();
        const bodyText = $("body").text().trim();

        if (title && !title.includes("Just a moment") && !title.includes("Checking") && !title.includes("Attention Required")) {
          if (bodyText.length > 300 || content.includes("videoTabs") || content.includes("options.php") || content.includes("entry-title") || content.includes("listupd") || content.includes("eplist")) {
            break;
          }
        }

        await new Promise((r) => setTimeout(r, 1200));
        retries++;
      }

      const content = await page.content();
      return content;
    } finally {
      await page.close().catch(() => {});
    }
  } catch (err) {
    throw err;
  }
}

const CF_PROXY_URL =
  process.env.ANIMED23_PROXY_URL ||
  "https://proxy-anime.elsodaestacio.workers.dev/?url=";

const SCRAPER_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "Twitterbot/1.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
];

async function fetchHtml(url, referer = null) {
  const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
  let lastError = null;

  // Tier 1: Cloudflare Worker Proxy (100% reliable bypass for cloud environments like Render)
  if (CF_PROXY_URL) {
    try {
      const proxyTarget = `${CF_PROXY_URL}${encodeURIComponent(url)}`;
      const response = await axios.get(proxyTarget, {
        timeout,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      if (
        typeof response.data === "string" &&
        response.data.length > 200 &&
        !response.data.includes("Just a moment...") &&
        !response.data.includes("cf-browser-verification")
      ) {
        return response.data;
      }
    } catch (proxyError) {
      lastError = proxyError;
    }
  }

  // Tier 2: Direct request with rotating User-Agents (for local / unblocked environments)
  for (const ua of SCRAPER_USER_AGENTS) {
    try {
      const headers = {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
      };
      if (referer) {
        headers.Referer = referer;
      }

      const response = await axios.get(url, {
        timeout,
        headers,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      if (
        typeof response.data === "string" &&
        (response.data.includes("Just a moment...") ||
          response.data.includes("cf-browser-verification") ||
          response.data.includes("Checking your browser"))
      ) {
        continue;
      }

      if (typeof response.data === "string" && response.data.length > 200) {
        return response.data;
      }
    } catch (error) {
      lastError = error;
    }
  }

  // Tier 3: Native globalThis.fetch (HTTP/2 with modern TLS ALPN)
  try {
    const fetchHeaders = {
      "User-Agent": SCRAPER_USER_AGENTS[1],
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    if (referer) {
      fetchHeaders.Referer = referer;
    }

    const fetchRes = await fetch(url, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(timeout),
    });

    if (fetchRes.ok) {
      const text = await fetchRes.text();
      if (text && !text.includes("Just a moment...")) {
        return text;
      }
    }
  } catch (fetchErr) {
    lastError = fetchErr;
  }

  // Tier 4: Puppeteer fallback if available in environment
  try {
    return await fetchHtmlWithPuppeteer(url, referer);
  } catch (_puppeteerError) {
    throw new ApiError(
      500,
      "No se pudo obtener contenido desde AnimeD23",
      lastError ? lastError.message : "Cloudflare challenge block"
    );
  }
}

async function fetchContenedorHtml(containerId, refererUrl) {
  const url = `https://${MULTIPLAYER_DOMAIN}/multiplayer/contenedor.php?id=${encodeURIComponent(containerId)}`;
  try {
    return await fetchHtml(url, refererUrl || `https://${MULTIPLAYER_DOMAIN}/`);
  } catch (_error) {
    return "";
  }
}

function normalizeToken(value) {
  return (value || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function buildExcludedTokens(includeMega, excludeServersRaw) {
  const excluded = new Set();
  const raw = typeof excludeServersRaw === "string" ? excludeServersRaw : "";
  for (const part of raw.split(",")) {
    const token = normalizeToken(part);
    if (token) {
      excluded.add(token);
    }
  }

  if (!includeMega) {
    excluded.add("mega");
  }

  return excluded;
}

function filterLinksByServers(links, excludedTokens) {
  return links.filter((link) => {
    const token = normalizeToken(link.token || link.server);
    if (!token) return true;
    if (excludedTokens.has(token)) return false;
    if (token.includes("mega") && excludedTokens.has("mega")) return false;
    return true;
  });
}

function parseEpisodeNumberFromUrl(urlCandidate) {
  if (!urlCandidate || typeof urlCandidate !== "string") return null;
  try {
    const clean = urlCandidate.replace(/\?.*$/, "").replace(/#.*$/, "").replace(/\/+$/, "");
    const segments = clean.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const match =
      lastSegment.match(/-ep-(\d+)(?:-[a-z0-9-]+)?$/i) ||
      lastSegment.match(/-capitulo-(\d+)(?:-[a-z0-9-]+)?$/i) ||
      lastSegment.match(/-(\d+)(?:-[a-z0-9-]+)?$/);
    return match ? Number(match[1]) : null;
  } catch (_) {
    return null;
  }
}

function slugFromUrl(urlCandidate) {
  if (!urlCandidate || typeof urlCandidate !== "string") return null;
  try {
    const clean = urlCandidate.replace(/\?.*$/, "").replace(/#.*$/, "").replace(/\/+$/, "");
    const segments = clean.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    if (clean.includes("/anime/")) {
      return lastSegment;
    }
    return lastSegment
      .replace(/-ep-\d+.*$/i, "")
      .replace(/-capitulo-\d+.*$/i, "")
      .replace(/-\d+.*$/, "");
  } catch (_) {
    return null;
  }
}

function resolveAbsoluteUrl(urlCandidate, domain = DEFAULT_DOMAIN) {
  if (!urlCandidate || typeof urlCandidate !== "string") {
    return null;
  }

  try {
    if (urlCandidate.startsWith("http://") || urlCandidate.startsWith("https://")) {
      return urlCandidate;
    }
    const clean = urlCandidate.startsWith("./") ? urlCandidate.slice(1) : urlCandidate;
    const base = `https://${domain}`;
    return new URL(clean, base).toString();
  } catch (_) {
    return null;
  }
}

function parseAnimeInfoFromHtml(html, domain = DEFAULT_DOMAIN) {
  const $ = cheerio.load(html);

  const title =
    $("h1.entry-title").first().text().trim() ||
    $("h1").first().text().trim() ||
    null;

  const titleJapanese =
    $(".alter").first().text().trim() ||
    $(".alternative").first().text().trim() ||
    null;

  const description =
    $(".entry-content p").first().text().trim() ||
    $(".entry-content").first().text().trim() ||
    $(".synopsis").first().text().trim() ||
    $("meta[name='description']").attr("content") ||
    null;

  const imageRaw =
    $(".thumb img, .poster img, .infox img").attr("src") ||
    $(".thumb img, .poster img, .infox img").attr("data-src") ||
    $("meta[property='og:image']").attr("content") ||
    null;
  const image = resolveAbsoluteUrl(imageRaw, domain);

  const ratingStr = $(".rating").first().text().trim();
  let score = null;
  if (ratingStr) {
    const scoreMatch = ratingStr.match(/\b(\d+(?:\.\d+)?)\b/);
    if (scoreMatch) {
      score = Number(scoreMatch[1]);
    }
  }

  // Metadata block (Estado, Estudio, Estreno, Duración, Temporada, Tipo, etc.)
  const metaMap = {};
  $(".spe span, .info-content span, .meta-info span").each((_, el) => {
    const txt = $(el).text().trim();
    const parts = txt.split(":");
    if (parts.length >= 2) {
      metaMap[parts[0].trim()] = parts.slice(1).join(":").trim();
    }
  });

  let status = metaMap["Estado"] || null;
  if (status && status.includes("emisi")) {
    status = "En emisión";
  }
  const type = metaMap["Tipo"] || "TV";
  const duration = metaMap["Duración"] || null;
  const season = metaMap["Temporada"] || null;
  const startDate = metaMap["Estreno"] || null;

  let year = null;
  if (startDate) {
    const yMatch = startDate.match(/\b(20\d\d|19\d\d)\b/);
    if (yMatch) year = Number(yMatch[1]);
  }
  if (!year && season) {
    const yMatch = season.match(/\b(20\d\d|19\d\d)\b/);
    if (yMatch) year = Number(yMatch[1]);
  }

  // Genres (scoped to main anime card to avoid picking up sidebar/recommendation tags)
  const genres = [];
  $(".bigcontent .genxed a, .animefull .genxed a, .infox .genxed a, .genxed a").each((_, el) => {
    const name = $(el).text().trim();
    if (name && !["4K", "60fps"].includes(name) && !genres.some((g) => g.name === name)) {
      genres.push({
        id: null,
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        malId: null,
      });
    }
  });

  // Episodes List from table / list elements
  const episodesList = [];
  $(".eplist ul li, ul.episodios li").each((_, el) => {
    const a = $(el).find("a").first();
    const href = a.attr("href");
    if (!href || !href.includes("/capitulo/")) return;

    const numText = $(el).find(".epl-num").first().text().trim();
    const epNum = numText && !isNaN(Number(numText)) ? Number(numText) : parseEpisodeNumberFromUrl(href);
    const epTitle = $(el).find(".epl-title").first().text().trim() || `Episodio ${epNum}`;

    if (epNum !== null && !episodesList.some((e) => e.number === epNum)) {
      episodesList.push({
        id: null,
        number: epNum,
        title: epTitle,
        url: resolveAbsoluteUrl(href, domain),
      });
    }
  });

  // Fallback for episodes if list not found
  if (episodesList.length === 0) {
    $("a[href*='/capitulo/']").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const epNum = parseEpisodeNumberFromUrl(href);
      if (epNum !== null && !episodesList.some((e) => e.number === epNum)) {
        episodesList.push({
          id: null,
          number: epNum,
          title: `Episodio ${epNum}`,
          url: resolveAbsoluteUrl(href, domain),
        });
      }
    });
  }

  episodesList.sort((a, b) => a.number - b.number);

  return {
    title,
    titleJapanese,
    status,
    type,
    year,
    score,
    totalEpisodes: episodesList.length || null,
    startDate,
    endDate: null,
    duration,
    genres,
    description,
    image,
    episodes: episodesList,
  };
}

// Public API

async function searchAnime(query, domainCandidate) {
  const cleanQuery = (query || "").toString().trim();
  if (!cleanQuery) {
    throw new ApiError(400, "Se requiere el parametro q");
  }

  const domain = (domainCandidate || DEFAULT_DOMAIN).toString().trim();
  const searchUrl = `https://${domain}/?s=${encodeURIComponent(cleanQuery)}`;
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const results = [];

  $(".listupd article.bs, .film-list article, article.bs, article").each((_, element) => {
    const card = $(element);
    const linkEl = card.find("a[href*='/anime/']").first();
    const link = linkEl.attr("href");
    if (!link || !link.includes("/anime/")) return;

    const h2Text = card.find("h2").first().text().trim();
    const title =
      h2Text ||
      card.find(".title, h3, .tt").first().text().trim().replace(/\t+/g, " ") ||
      linkEl.attr("title") ||
      "";
    const imgEl = card.find("img").first();
    const imageRaw = imgEl.attr("src") || imgEl.attr("data-src") || null;
    const type = card.find(".type, .typez, .badge, .bt .type").first().text().trim() || "Anime";
    let status = card.find(".status, .epx, .bt .status").first().text().trim() || null;
    if (status && status.includes("emisi")) {
      status = "En emisión";
    }

    const slug = slugFromUrl(link);
    const image = resolveAbsoluteUrl(imageRaw, domain);
    const fullUrl = resolveAbsoluteUrl(link, domain);

    // Clean title if duplicated
    let cleanTitle = title;
    if (title.includes("    ")) {
      cleanTitle = title.split("    ")[0].trim();
    }

    results.push({
      id: null,
      title: cleanTitle,
      slug,
      url: fullUrl,
      image,
      backdrop: null,
      type: type || "Anime",
      score: null,
      status: status || null,
      year: null,
    });
  });

  // Deduplicate by slug
  const seen = new Set();
  const deduped = [];
  for (const item of results) {
    if (!item.slug || seen.has(item.slug)) continue;
    seen.add(item.slug);
    deduped.push(item);
  }

  return {
    success: true,
    data: { query: cleanQuery, results: deduped, count: deduped.length },
    source: "animed23",
  };
}

async function getAnimeInfo(urlCandidate) {
  const slug = slugFromUrl(urlCandidate);
  if (!slug) throw new ApiError(400, "URL invalida");

  let domain = DEFAULT_DOMAIN;
  try {
    domain = new URL(urlCandidate).host || DEFAULT_DOMAIN;
  } catch (_) {}

  const animeUrl = `https://${domain}/anime/${slug}/`;
  const html = await fetchHtml(animeUrl);

  const info = parseAnimeInfoFromHtml(html, domain);

  return {
    success: true,
    data: {
      id: null,
      title: info.title,
      titleJapanese: info.titleJapanese,
      description: info.description,
      image: info.image,
      backdrop: null,
      status: info.status,
      type: info.type,
      year: info.year,
      startDate: info.startDate,
      endDate: info.endDate,
      score: info.score,
      votes: null,
      totalEpisodes: info.totalEpisodes,
      malId: null,
      trailer: null,
      genres: info.genres || [],
      episodes: info.episodes,
    },
    source: "animed23",
  };
}

async function getEpisodeLinks(urlCandidate, includeMega = true, excludeServers = "") {
  const slug = slugFromUrl(urlCandidate);
  const episodeNumber = parseEpisodeNumberFromUrl(urlCandidate);

  if (!slug || episodeNumber === null) {
    throw new ApiError(400, "URL invalida - no se pudo extraer slug y numero de episodio");
  }

  let domain = DEFAULT_DOMAIN;
  try {
    domain = new URL(urlCandidate).host || DEFAULT_DOMAIN;
  } catch (_) {}

  let episodeUrl;
  if (urlCandidate && urlCandidate.includes("/capitulo/")) {
    const rawClean = urlCandidate.replace(/\?.*$/, "").replace(/#.*$/, "");
    episodeUrl = rawClean.endsWith("/") ? rawClean : `${rawClean}/`;
  } else {
    episodeUrl = `https://${domain}/capitulo/${slug}-ep-${episodeNumber}/`;
  }

  const html = await fetchHtml(episodeUrl);
  const $ = cheerio.load(html);

  const episodeTitle =
    $("h1").first().text().trim() ||
    `Ver ${slug} ep. ${episodeNumber}`;

  let publishedAt = null;
  const metaDateText = $(".item.meta, .meta, .updated").first().text();
  const dateMatch = metaDateText.match(/(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{1,2},\s+\d{4}/i);
  if (dateMatch) {
    publishedAt = dateMatch[0];
  }

  const streamLinks = { SUB: [], DUB: [] };
  const downloadLinks = { SUB: [], DUB: [] };

  // 1. Find the options.php iframe
  const iframeSrc = $("iframe[src*='options.php'], iframe").first().attr("src") || $("iframe").first().attr("data-src");

  if (iframeSrc) {
    try {
      const parsedUrl = new URL(iframeSrc, `https://${MULTIPLAYER_DOMAIN}`);
      const rawValue = parsedUrl.searchParams.get("value");

      if (rawValue) {
        const b64Part = rawValue.split(".")[0];
        const jsonStr = Buffer.from(b64Part, "base64").toString("utf8");
        const decodedValue = JSON.parse(jsonStr);

        // Process Subtitle servers
        if (decodedValue && decodedValue.sub) {
          const contenedorHtml = await fetchContenedorHtml(decodedValue.sub, iframeSrc);
          if (contenedorHtml) {
            const vMatch = contenedorHtml.match(/const\s+videoTabs\s*=\s*(\[[\s\S]*?\]);/);
            if (vMatch) {
              const vTabs = JSON.parse(vMatch[1]);
              for (const tab of vTabs) {
                if (tab.url && tab.status === "active") {
                  streamLinks.SUB.push({
                    server: tab.tab_name || "Unknown",
                    url: tab.url,
                  });
                }
              }
            }

            const dMatch = contenedorHtml.match(/const\s+downloadsByQuality\s*=\s*(\{[\s\S]*?\});/);
            if (dMatch) {
              const dQuality = JSON.parse(dMatch[1]);
              for (const [qKey, items] of Object.entries(dQuality)) {
                if (Array.isArray(items)) {
                  for (const item of items) {
                    if (item.download_url) {
                      downloadLinks.SUB.push({
                        server: item.server_name ? `${item.server_name} (${qKey})` : qKey,
                        url: item.download_url,
                        quality: qKey,
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // Process Dubbed (Latino / Castellano) servers
        const dubId = decodedValue.lat || decodedValue.cast;
        if (dubId) {
          const contenedorHtml = await fetchContenedorHtml(dubId, iframeSrc);
          if (contenedorHtml) {
            const vMatch = contenedorHtml.match(/const\s+videoTabs\s*=\s*(\[[\s\S]*?\]);/);
            if (vMatch) {
              const vTabs = JSON.parse(vMatch[1]);
              for (const tab of vTabs) {
                if (tab.url && tab.status === "active") {
                  streamLinks.DUB.push({
                    server: tab.tab_name || "Unknown",
                    url: tab.url,
                  });
                }
              }
            }

            const dMatch = contenedorHtml.match(/const\s+downloadsByQuality\s*=\s*(\{[\s\S]*?\});/);
            if (dMatch) {
              const dQuality = JSON.parse(dMatch[1]);
              for (const [qKey, items] of Object.entries(dQuality)) {
                if (Array.isArray(items)) {
                  for (const item of items) {
                    if (item.download_url) {
                      downloadLinks.DUB.push({
                        server: item.server_name ? `${item.server_name} (${qKey})` : qKey,
                        url: item.download_url,
                        quality: qKey,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  // Server filtering
  const excludedTokens = buildExcludedTokens(includeMega, excludeServers);
  const filteredStreamSub = filterLinksByServers(streamLinks.SUB, excludedTokens);
  const filteredStreamDub = filterLinksByServers(streamLinks.DUB, excludedTokens);
  const filteredDwnSub = filterLinksByServers(downloadLinks.SUB, excludedTokens);
  const filteredDwnDub = filterLinksByServers(downloadLinks.DUB, excludedTokens);

  // Deduplicate
  const dedupLinks = (arr) => {
    const seen = new Set();
    const res = [];
    for (const item of arr) {
      if (!item.url) continue;
      const key = `${item.server || ""}|${item.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      res.push(item);
    }
    return res;
  };

  const finalStreamSub = dedupLinks(filteredStreamSub);
  const finalStreamDub = dedupLinks(filteredStreamDub);
  const finalDwnSub = dedupLinks(filteredDwnSub);
  const finalDwnDub = dedupLinks(filteredDwnDub);

  return {
    success: true,
    data: {
      id: null,
      episode: episodeNumber,
      title: episodeTitle,
      season: null,
      variants: {
        SUB: finalStreamSub.length > 0 || finalDwnSub.length > 0 ? 1 : 0,
        DUB: finalStreamDub.length > 0 || finalDwnDub.length > 0 ? 1 : 0,
      },
      publishedAt,
      servers: {
        sub: finalStreamSub.map((l) => ({ server: l.server, url: l.url })),
        dub: finalStreamDub.map((l) => ({ server: l.server, url: l.url })),
      },
      streamLinks: {
        SUB: finalStreamSub.map((l) => ({ server: l.server, url: l.url })),
        DUB: finalStreamDub.map((l) => ({ server: l.server, url: l.url })),
      },
      downloadLinks: {
        SUB: finalDwnSub.map((l) => ({ server: l.server, url: l.url, quality: l.quality })),
        DUB: finalDwnDub.map((l) => ({ server: l.server, url: l.url, quality: l.quality })),
      },
    },
    source: "animed23",
  };
}

async function getLatestEpisodes(domainCandidate) {
  const domain = (domainCandidate || DEFAULT_DOMAIN).toString().trim();
  const searchUrl = `https://${domain}/`;
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const results = [];

  $(".listupd article.bs, .listupd article, article.bs, article").each((_, element) => {
    const el = $(element);
    const a = el.find("a[href*='/capitulo/']").first();
    const urlRaw = a.attr("href");
    if (!urlRaw || !urlRaw.includes("/capitulo/")) return;

    const rawTitle = el.find("h2, h3, .title, .tt").first().text().trim();
    const imgEl = el.find("img").first();
    const imageRaw = imgEl.attr("src") || imgEl.attr("data-src");

    const fullUrl = resolveAbsoluteUrl(urlRaw, domain);
    const slug = slugFromUrl(fullUrl) || "";
    const number = parseEpisodeNumberFromUrl(fullUrl);
    const image = resolveAbsoluteUrl(imageRaw, domain);

    let title = rawTitle;
    if (title.includes("    ")) {
      title = title.split("    ")[0].trim();
    }
    if (number) {
      title = title.replace(new RegExp(`\\s+ep\\.?\\s*${number}.*$`, "i"), "").trim();
      title = title.replace(new RegExp(`\\s+${number}$`), "").trim();
    }

    results.push({
      id: null,
      title: title || rawTitle,
      episode: number,
      slug,
      url: fullUrl,
      image,
    });
  });

  const seen = new Set();
  const deduped = [];
  for (const item of results) {
    const key = `${item.slug}-${item.episode}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  return {
    success: true,
    data: { results: deduped, count: deduped.length },
    source: "animed23",
  };
}

module.exports = {
  searchAnime,
  getAnimeInfo,
  getEpisodeLinks,
  getLatestEpisodes,
};
