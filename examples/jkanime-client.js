/**
 * Anime1V Client SDK - Scraping del lado del cliente (Frontend / Mobile App)
 * 
 * Este módulo se ejecuta en el navegador o en la app móvil del usuario (IP residencial).
 * Evita el bloqueo de Cloudflare en Render ya que la petición inicial la realiza el dispositivo del usuario.
 */

class JKAnimeClient {
  /**
   * @param {Object} config
   * @param {string} config.apiUrl - URL base de la API en Render (ej: "https://animeapi-p7f5.onrender.com")
   * @param {string} config.apiKey - Tu API Key de Anime1V
   */
  constructor({ apiUrl, apiKey }) {
    this.apiUrl = (apiUrl || "").replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  /**
   * Obtiene los últimos episodios desde el dispositivo del cliente
   * y los envía a Render para parsear y estandarizar el JSON.
   */
  async getLatestEpisodes() {
    try {
      // 1. El cliente (IP residencial) descarga el feed directo sin ser bloqueado
      let rawContent = "";
      try {
        const sitemapRes = await fetch("https://jkanime.net/sitemap-episodios.xml");
        rawContent = await sitemapRes.text();
      } catch (_e) {
        // Fallback a la web principal si el sitemap falla
        const homeRes = await fetch("https://jkanime.net/");
        rawContent = await homeRes.text();
      }

      // 2. Envía el contenido a Render para parsear y obtener el JSON limpio
      const response = await fetch(`${this.apiUrl}/api/v1/anime/parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify({
          domain: "jkanime.net",
          type: "latest-episodes",
          html: rawContent,
        }),
      });

      return await response.json();
    } catch (error) {
      console.error("[JKAnimeClient Error]:", error);
      throw error;
    }
  }

  /**
   * Busca animes en JKAnime desde el cliente
   */
  async search(query) {
    const searchUrl = `https://jkanime.net/buscar/${encodeURIComponent(query)}`;
    const htmlRes = await fetch(searchUrl);
    const html = await htmlRes.text();

    const response = await fetch(`${this.apiUrl}/api/v1/anime/parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        domain: "jkanime.net",
        type: "search",
        html: html,
      }),
    });

    return await response.json();
  }

  /**
   * Obtiene la información y episodios de un anime
   */
  async getAnimeInfo(animeUrl) {
    const htmlRes = await fetch(animeUrl);
    const html = await htmlRes.text();

    const response = await fetch(`${this.apiUrl}/api/v1/anime/parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        domain: "jkanime.net",
        type: "info",
        html: html,
      }),
    });

    return await response.json();
  }
}

// Ejemplo de uso en navegador o Node:
if (typeof module !== "undefined" && module.exports) {
  module.exports = { JKAnimeClient };
}
