const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("node:url");
const { ApiError } = require("../utils/api-error");

const DEFAULT_DOMAIN = "monoschinos2.com";

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

async function fetchHtmlWithHeaders(url) {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios.get(url, {
      timeout,
      headers: HTTP_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return { html: response.data, headers: response.headers };
  } catch (error) {
    throw new ApiError(500, "No se pudo obtener contenido desde MonosChinos", error.message);
  }
}

async function fetchHtml(url) {
  const { html } = await fetchHtmlWithHeaders(url);
  return html;
}

function parseEpisodeNumberFromUrl(url) {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    // format: anime-name-episodio-1
    const match = lastSegment.match(/-episodio-(\d+)$/);
    return match ? Number(match[1]) : null;
  } catch (_) {
    return null;
  }
}

function slugFromUrl(url) {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    if (url.includes("/anime/")) {
      return lastSegment;
    }
    return lastSegment.replace(/-episodio-\d+$/, "");
  } catch (_) {
    return null;
  }
}

// Public API

async function searchAnime(query, domainCandidate) {
  const cleanQuery = (query || "").toString().trim();
  if (!cleanQuery) {
    throw new ApiError(400, "Se requiere el parametro q");
  }

  const domain = (domainCandidate || DEFAULT_DOMAIN).toString().trim();
  const searchUrl = `https://${domain}/buscar?q=${encodeURIComponent(cleanQuery)}`;
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const results = [];

  $("a[href*='/anime/']").each((_, element) => {
    const link = $(element).attr("href");
    const title = $(element).find("h3.title_cap, h3").first().text().trim() || $(element).text().trim();
    const image = $(element).find("img").attr("data-src") || $(element).find("img").attr("src");
    const yearStr = $(element).find("span.text-muted").first().text().trim();

    if (!link || !title) return;
    if ($(element).find("img").length === 0) return;

    const slug = slugFromUrl(link);
    const year = yearStr && !isNaN(Number(yearStr)) ? Number(yearStr) : null;

    results.push({
      id: null,
      title,
      slug,
      url: link.startsWith("http") ? link : `https://${domain}${link}`,
      image: image ? (image.startsWith("http") ? image : `https://${domain}${image}`) : null,
      backdrop: null,
      type: "Anime",
      score: null,
      status: null,
      year,
    });
  });

  return {
    success: true,
    data: { query: cleanQuery, results, count: results.length },
    source: "monoschinos",
  };
}

async function getAnimeInfo(urlCandidate) {
  const slug = slugFromUrl(urlCandidate);
  if (!slug) throw new ApiError(400, "URL invalida");

  const domain = new URL(urlCandidate).host || DEFAULT_DOMAIN;
  const animeUrl = `https://${domain}/anime/${slug}`;
  const { html, headers } = await fetchHtmlWithHeaders(animeUrl);

  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();
  const description = $("p.text-sm.text-gray-400, .synopsis").first().text().trim() || null;
  const image = $("img.lazy").attr("data-src") || $("img").first().attr("src");

  const episodes = [];
  let epsFoundFromAjax = false;

  const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/i);
  const axMatch = html.match(/(https?:\/\/[^\s"'<>]+\/ajax_pagination\/\d+)/i);

  if (csrfMatch && axMatch) {
    try {
      const csrfToken = csrfMatch[1];
      const axUrl = axMatch[1];
      const cookieStr = headers["set-cookie"] ? headers["set-cookie"].join(";") : "";
      const reqHeaders = { ...HTTP_HEADERS, "X-CSRF-TOKEN": csrfToken, Cookie: cookieStr };

      const axResponse = await axios.post(axUrl, null, { headers: reqHeaders });
      const pData = axResponse.data;

      if (pData && pData.paginate_url && Array.isArray(pData.eps)) {
        epsFoundFromAjax = true;
        const totalEps = pData.eps.length;
        const perPage = pData.perpage || 50;
        const totalPages = Math.ceil(totalEps / perPage);

        for (let page = 1; page <= totalPages; page++) {
          const epsUrl = `${pData.paginate_url}?p=${page}`;
          const epsPage = await axios.post(epsUrl, null, { headers: reqHeaders });
          if (epsPage.data && epsPage.data.caps && Array.isArray(epsPage.data.caps)) {
            for (const cap of epsPage.data.caps) {
              const number = Number(cap.episodio);
              if (cap.url && number) {
                episodes.push({
                  id: null,
                  number,
                  title: `Episodio ${number}`,
                  url: cap.url,
                });
              }
            }
          }
        }
      }
    } catch (e) {
      // Si falla, ignoramos y usamos fallback (html directo)
    }
  }

  // Fallback si no se encontró paginación
  if (!epsFoundFromAjax) {
    $("a[href*='/ver/']").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const fullUrl = href.startsWith("http") ? href : `https://${domain}${href}`;
      const number = parseEpisodeNumberFromUrl(fullUrl);
      if (number) {
        episodes.push({
          id: null,
          number,
          title: `Episodio ${number}`,
          url: fullUrl,
        });
      }
    });
  }

  const seen = new Set();
  const sortedEpisodes = episodes
    .filter((ep) => {
      const k = ep.number;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.number - b.number);

  return {
    success: true,
    data: {
      id: null,
      title,
      titleJapanese: null,
      description,
      image: image ? (image.startsWith("http") ? image : `https://${domain}${image}`) : null,
      backdrop: null,
      status: null,
      type: "Anime",
      year: null,
      startDate: null,
      endDate: null,
      score: null,
      votes: null,
      totalEpisodes: sortedEpisodes.length,
      malId: null,
      trailer: null,
      genres: [],
      episodes: sortedEpisodes,
    },
    source: "monoschinos",
  };
}

async function getEpisodeLinks(urlCandidate, includeMega = false, excludeServers = []) {
  const slug = slugFromUrl(urlCandidate);
  const episodeNumber = parseEpisodeNumberFromUrl(urlCandidate);

  if (!slug || !episodeNumber) {
    throw new ApiError(400, "URL invalida - no se pudo extraer slug y numero");
  }

  const html = await fetchHtml(urlCandidate);
  const $ = cheerio.load(html);

  const streamLinks = { SUB: [], DUB: [] };
  const excludeList = (excludeServers || []).map((s) => s.toLowerCase());
  
  $(".play-video").each((_, el) => {
    const serverName = $(el).text().trim().toLowerCase();
    const dataPlayer = $(el).attr("data-player");
    if (!dataPlayer) return;

    if (!includeMega && serverName.includes("mega")) {
      return;
    }

    if (excludeList.some((ex) => serverName.includes(ex))) {
      return;
    }

    try {
      const url = Buffer.from(dataPlayer, 'base64').toString('utf8');
      if (url.startsWith("http")) {
        streamLinks.SUB.push({ server: serverName, url });
      }
    } catch(err) {}
  });

  const episodeTitle = $("h1").first().text().trim() || `Episodio ${episodeNumber}`;

  return {
    success: true,
    data: {
      id: null,
      episode: episodeNumber,
      title: episodeTitle,
      season: null,
      variants: {
        SUB: streamLinks.SUB.length > 0 ? 1 : 0,
        DUB: 0,
      },
      publishedAt: null,
      servers: {
        sub: streamLinks.SUB,
        dub: [],
      },
      streamLinks: {
        SUB: streamLinks.SUB,
        DUB: [],
      },
      downloadLinks: {
        SUB: [],
        DUB: [],
      },
    },
    source: "monoschinos",
  };
}

async function getLatestEpisodes(domainCandidate) {
  const domain = (domainCandidate || DEFAULT_DOMAIN).toString().trim();
  const searchUrl = `https://${domain}/`;
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const results = [];

  // Target grid cards for latest episodes, excluding hero-content / banner
  $(".grid a[href*='-episodio-'], .row .col-6 a[href*='-episodio-'], .card-wrap a[href*='-episodio-']").each((_, element) => {
    const el = $(element);
    // Ignore hero / banner / carousel
    if (el.closest(".hero-content, .hero, #hero, [class*='hero']").length > 0) return;
    if (el.hasClass("slider-show") || el.text().trim() === "Ver ahora") return;

    const url = el.attr("href");
    if (!url) return;

    const fullUrl = url.startsWith("http") ? url : `https://${domain}${url}`;
    const segments = new URL(fullUrl).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const match = lastSegment.match(/-episodio-(\d+)$/);
    const number = match ? Number(match[1]) : null;
    const slug = lastSegment.replace(/-episodio-\d+$/, "");

    let title = el.find(".title, h2, h3, h5, p").text().trim() || el.text().trim();
    if (!title || title === "Ver ahora") {
      title = slug.replace(/-/g, " ");
    }

    const imgEl = el.find("img");
    const image = imgEl.attr("data-src") || imgEl.attr("src") || null;

    results.push({
      id: null,
      title,
      episode: number,
      slug,
      url: fullUrl,
      image: image ? (image.startsWith("http") ? image : `https://${domain}${image}`) : null,
    });
  });

  // Fallback if structured grid not matched
  if (results.length === 0) {
    $("a[href*='-episodio-']").each((_, element) => {
      const el = $(element);
      if (el.closest(".hero-content, .hero, [class*='hero']").length > 0) return;
      if (el.hasClass("slider-show") || el.text().trim() === "Ver ahora") return;

      const url = el.attr("href");
      if (!url) return;

      const fullUrl = url.startsWith("http") ? url : `https://${domain}${url}`;
      const segments = new URL(fullUrl).pathname.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1] || "";
      const match = lastSegment.match(/-episodio-(\d+)$/);
      const number = match ? Number(match[1]) : null;
      const slug = lastSegment.replace(/-episodio-\d+$/, "");

      let title = el.find(".title, h2, h3, h5, p").text().trim() || el.text().trim();
      if (!title || title === "Ver ahora") {
        title = slug.replace(/-/g, " ");
      }

      const imgEl = el.find("img");
      const image = imgEl.attr("data-src") || imgEl.attr("src") || null;

      results.push({
        id: null,
        title,
        episode: number,
        slug,
        url: fullUrl,
        image: image ? (image.startsWith("http") ? image : `https://${domain}${image}`) : null,
      });
    });
  }

  // Dedup by slug and episode number
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
    source: "monoschinos",
  };
}

module.exports = {
  searchAnime,
  getAnimeInfo,
  getEpisodeLinks,
  getLatestEpisodes,
};
