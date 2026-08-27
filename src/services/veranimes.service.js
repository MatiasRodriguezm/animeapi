const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("node:url");
const { ApiError } = require("../utils/api-error");

const CANONICAL_DOMAIN = "wwv.veranimes.net";
const DEFAULT_DOMAIN = CANONICAL_DOMAIN;

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

async function fetchHtml(url) {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios.get(url, {
      timeout,
      headers: HTTP_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return response.data;
  } catch (error) {
    throw new ApiError(500, "No se pudo obtener contenido desde VerAnimes", error.message);
  }
}

async function fetchProcessOptions(encryptId, refererUrl) {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const processUrl = `https://${CANONICAL_DOMAIN}/process`;
    const response = await axios.post(
      processUrl,
      `acc=opt&i=${encodeURIComponent(encryptId)}`,
      {
        timeout,
        headers: {
          ...HTTP_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Referer: refererUrl || `https://${CANONICAL_DOMAIN}/`,
        },
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      }
    );
    return response.data || "";
  } catch (_error) {
    return "";
  }
}

function hexToAscii(hex) {
  if (!hex || typeof hex !== "string") return "";
  try {
    return Buffer.from(hex, "hex").toString("utf8");
  } catch (_) {
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

function normalizeVariantKey(value) {
  const normalized = normalizeToken(value);
  if (!normalized) return "SUB";
  if (normalized.includes("sub") || normalized.includes("jap") || normalized.includes("jp")) return "SUB";
  return "DUB";
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
    const clean = urlCandidate.replace(/\?.*$/, "").replace(/#.*$/, "");
    const segments = clean.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const match = lastSegment.match(/-(\d+)$/);
    return match ? Number(match[1]) : null;
  } catch (_) {
    return null;
  }
}

function slugFromUrl(urlCandidate) {
  if (!urlCandidate || typeof urlCandidate !== "string") return null;
  try {
    const clean = urlCandidate.replace(/\?.*$/, "").replace(/#.*$/, "");
    const segments = clean.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    if (clean.includes("/anime/")) {
      return lastSegment;
    }
    return lastSegment.replace(/-\d+$/, "");
  } catch (_) {
    return null;
  }
}

function resolveAbsoluteUrl(urlCandidate, domain = CANONICAL_DOMAIN) {
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

function formatServerName(span1, title) {
  if (title && typeof title === "string" && title.trim()) {
    const t = title.trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  if (span1 && typeof span1 === "string" && span1.trim()) {
    const clean = span1.replace(/\s*\d+$/, "").trim();
    return clean
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return "Unknown";
}

function parseAnimeInfoFromHtml(html, domain = CANONICAL_DOMAIN) {
  const $ = cheerio.load(html);

  const title =
    $(".info .r .ti h1 strong").first().text().trim() ||
    $(".info .r .ti h1").first().text().trim() ||
    $("h1").first().text().trim() ||
    null;

  const titleJapanese = $(".info .r .ti h2").first().text().trim() || null;

  const statusEl = $(".info .r .ti div .fi, .info .r .ti div .em, .info .r .ti div .pr").first();
  const status = statusEl.text().trim() || null;

  const typeEl = $(".info .r .ti div .t").first();
  const type = typeEl.text().trim() || null;

  const yearEl = $(".info .r .ti div .a").first();
  const yearStr = yearEl.text().trim();
  const year = yearStr && !isNaN(Number(yearStr)) ? Number(yearStr) : null;

  const ratingStr = $(".info .r .rt span b").first().text().trim();
  const score = ratingStr && !isNaN(Number(ratingStr)) ? Number(ratingStr) : null;

  let totalEpisodes = null;
  const epDataAttr = $(".info .r .u.sp li span[data-ep]").first().attr("data-ep");
  if (epDataAttr && !isNaN(Number(epDataAttr))) {
    totalEpisodes = Number(epDataAttr);
  }

  let startDate = null;
  let endDate = null;
  $(".info .r .u.sp li").each((_, el) => {
    const text = $(el).text();
    if (text.includes("Fecha de emisión:")) {
      const dates = $(el).find("span:last-child").text().trim();
      if (dates.includes("-")) {
        const parts = dates.split("-").map((p) => p.trim());
        startDate = parts[0] || null;
        endDate = parts[1] || null;
      } else if (dates) {
        startDate = dates;
      }
    }
  });

  const genres = [];
  $(".info .r .gn li a").each((_, el) => {
    const name = $(el).text().trim();
    if (name) {
      genres.push({
        id: null,
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        malId: null,
      });
    }
  });

  const description =
    $(".info .r .tx p").first().text().trim() ||
    $(".description").first().text().trim() ||
    $("meta[name='description']").attr("content") ||
    null;

  const imageRaw =
    $(".info .l figure img").attr("data-src") ||
    $(".info .l figure img").attr("src") ||
    $("meta[property='og:image']").attr("content") ||
    null;
  const image = resolveAbsoluteUrl(imageRaw, domain);

  // Extract episodes array from JS var eps = ["13", "12", ...];
  let episodesList = [];
  const epsMatch = html.match(/var\s+eps\s*=\s*(\[[^\]]*\]);/i);
  if (epsMatch) {
    try {
      const rawEps = JSON.parse(epsMatch[1]);
      if (Array.isArray(rawEps)) {
        episodesList = rawEps
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
      }
    } catch (_) {}
  }

  return {
    title,
    titleJapanese,
    status,
    type,
    year,
    score,
    totalEpisodes: totalEpisodes || episodesList.length || null,
    startDate,
    endDate,
    genres,
    description,
    image,
    episodesList,
  };
}

// Public API

async function searchAnime(query, domainCandidate) {
  const cleanQuery = (query || "").toString().trim();
  if (!cleanQuery) {
    throw new ApiError(400, "Se requiere el parametro q");
  }

  const domain = CANONICAL_DOMAIN;
  const searchUrl = `https://${domain}/animes?buscar=${encodeURIComponent(cleanQuery)}`;
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const results = [];

  $(".ul article.li, article.li").each((_, element) => {
    const card = $(element);
    const linkEl = card.find("a[href*='/anime/']").first();
    const link = linkEl.attr("href");
    const title = card.find("h3.h a, h3 a, h3").first().text().trim() || linkEl.attr("title") || "";
    const imgEl = card.find("figure.i img, img").first();
    const imageRaw = imgEl.attr("data-src") || imgEl.attr("src") || null;
    const type = card.find("figure.i span, span").first().text().trim() || "Anime";

    if (!link || !title) return;

    const slug = slugFromUrl(link);
    const image = resolveAbsoluteUrl(imageRaw, domain);
    const fullUrl = resolveAbsoluteUrl(link, domain);

    results.push({
      id: null,
      title,
      slug,
      url: fullUrl,
      image,
      backdrop: null,
      type: type || "Anime",
      score: null,
      status: null,
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
    source: "veranimes",
  };
}

async function getAnimeInfo(urlCandidate) {
  const slug = slugFromUrl(urlCandidate);
  if (!slug) throw new ApiError(400, "URL invalida");

  const domain = CANONICAL_DOMAIN;
  const animeUrl = `https://${domain}/anime/${slug}`;
  const html = await fetchHtml(animeUrl);

  const info = parseAnimeInfoFromHtml(html, domain);

  let episodesNumbers = info.episodesList;
  if (!episodesNumbers || episodesNumbers.length === 0) {
    const $ = cheerio.load(html);
    const foundNumbers = [];
    $("a[href*='/ver/']").each((_, el) => {
      const href = $(el).attr("href");
      const num = parseEpisodeNumberFromUrl(href);
      if (num !== null) foundNumbers.push(num);
    });
    episodesNumbers = [...new Set(foundNumbers)].sort((a, b) => a - b);
  }

  const episodes = episodesNumbers.map((num) => ({
    id: null,
    number: num,
    title: `Episodio ${num}`,
    url: `https://${domain}/ver/${slug}-${num}`,
  }));

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
      totalEpisodes: info.totalEpisodes || episodes.length,
      malId: null,
      trailer: null,
      genres: info.genres || [],
      episodes,
    },
    source: "veranimes",
  };
}

async function getEpisodeLinks(urlCandidate, includeMega = true, excludeServers = "") {
  const slug = slugFromUrl(urlCandidate);
  const episodeNumber = parseEpisodeNumberFromUrl(urlCandidate);

  if (!slug || episodeNumber === null) {
    throw new ApiError(400, "URL invalida - no se pudo extraer slug y numero de episodio");
  }

  const domain = CANONICAL_DOMAIN;
  const episodeUrl = `https://${domain}/ver/${slug}-${episodeNumber}`;
  const html = await fetchHtml(episodeUrl);
  const $ = cheerio.load(html);

  const episodeTitle =
    $("section#l .ti h1").first().text().trim() ||
    $("h1").first().text().trim() ||
    `Ver ${slug} ${episodeNumber}`;

  const streamLinks = { SUB: [], DUB: [] };
  const downloadLinks = { SUB: [], DUB: [] };

  // 1. Fetch streaming server options from AJAX /process if data-encrypt exists
  const encryptId = $("ul.opt[data-encrypt]").attr("data-encrypt") || $('*[data-encrypt]').data('encrypt');
  if (encryptId) {
    const processHtml = await fetchProcessOptions(encryptId, episodeUrl);
    if (processHtml) {
      const $opt = cheerio.load(`<ul>${processHtml}</ul>`);
      $opt("li").each((_, el) => {
        const hex = $opt(el).attr("encrypt");
        const title = $opt(el).attr("title") || "";
        const span1 = $opt(el).find("span").eq(0).text().trim();
        const serverName = formatServerName(span1, title);

        if (hex) {
          const streamUrl = hexToAscii(hex);
          if (streamUrl && (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"))) {
            streamLinks.SUB.push({
              server: serverName,
              url: streamUrl,
            });
          }
        }
      });
    }
  }

  // 2. Fetch download links from data-dwn attribute
  const dwnAttr = $("a.d[data-dwn]").attr("data-dwn");
  if (dwnAttr) {
    try {
      const rawJson = dwnAttr.replace(/&quot;/g, '"').replace(/\\\//g, "/");
      const dwnList = JSON.parse(rawJson);
      if (Array.isArray(dwnList)) {
        for (const item of dwnList) {
          if (Array.isArray(item) && item.length >= 3) {
            const serverName = (item[0] || "Unknown").toString();
            const dwnUrl = item[2];
            if (dwnUrl && (dwnUrl.startsWith("http://") || dwnUrl.startsWith("https://"))) {
              downloadLinks.SUB.push({
                server: serverName.charAt(0).toUpperCase() + serverName.slice(1),
                url: dwnUrl,
              });
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

  // Deduplicate by URL (single distinct entry per unique stream/download URL)
  const dedupLinks = (arr) => {
    const seen = new Set();
    const res = [];
    for (const item of arr) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
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
      publishedAt: null,
      servers: {
        sub: finalStreamSub.map((l) => ({ server: l.server, url: l.url })),
        dub: finalStreamDub.map((l) => ({ server: l.server, url: l.url })),
      },
      streamLinks: {
        SUB: finalStreamSub.map((l) => ({ server: l.server, url: l.url })),
        DUB: finalStreamDub.map((l) => ({ server: l.server, url: l.url })),
      },
      downloadLinks: {
        SUB: finalDwnSub.map((l) => ({ server: l.server, url: l.url })),
        DUB: finalDwnDub.map((l) => ({ server: l.server, url: l.url })),
      },
    },
    source: "veranimes",
  };
}

async function getLatestEpisodes(domainCandidate) {
  const domain = CANONICAL_DOMAIN;
  const searchUrl = `https://${domain}/`;
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const results = [];

  $(".ul.episodes article.li").each((_, element) => {
    const el = $(element);
    const a = el.find("figure.i a, a").first();
    const urlRaw = a.attr("href");
    const rawTitle = el.find("h3.h a, h3.h, h3").first().text().trim() || a.attr("title") || "";
    const imgEl = el.find("figure.i img, img").first();
    const imageRaw = imgEl.attr("data-src") || imgEl.attr("src");

    if (!urlRaw || !rawTitle) return;

    const fullUrl = resolveAbsoluteUrl(urlRaw, domain);
    const slug = slugFromUrl(fullUrl) || "";
    const number = parseEpisodeNumberFromUrl(fullUrl);
    const image = resolveAbsoluteUrl(imageRaw, domain);

    let title = rawTitle;
    if (number) {
      title = title.replace(new RegExp(`\\s+episodio\\s+${number}$`, "i"), "").trim();
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
    source: "veranimes",
  };
}

module.exports = {
  searchAnime,
  getAnimeInfo,
  getEpisodeLinks,
  getLatestEpisodes,
};
