(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SakilaAPI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SOURCE = Object.freeze({
    name: "Cinemeta",
    url: "https://www.stremio.com/",
    documentation: "https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md"
  });
  const IDS = Object.freeze([
    "tt0111161", "tt0068646", "tt0468569", "tt1375666", "tt0816692", "tt0133093",
    "tt0109830", "tt0110912", "tt0120737", "tt0167260", "tt0245429", "tt2380307",
    "tt0910970", "tt0114709", "tt4633694", "tt4154796", "tt6751668", "tt7286456",
    "tt1853728", "tt0120815", "tt0110357", "tt0266543", "tt2096673", "tt0088763"
  ]);
  const CACHE_KEY = "sakila:cinemeta:v1";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const GENRES = Object.freeze({
    Action: "Acción", Adventure: "Aventura", Animation: "Animación", Biography: "Biografía",
    Comedy: "Comedia", Crime: "Crimen", Documentary: "Documental", Drama: "Drama",
    Family: "Familiar", Fantasy: "Fantasía", History: "Historia", Horror: "Terror",
    Music: "Música", Musical: "Musical", Mystery: "Misterio", Romance: "Romance",
    "Sci-Fi": "Ciencia ficción", Sport: "Deportes", Thriller: "Suspenso", War: "Bélico",
    Western: "Western", "Film-Noir": "Cine negro"
  });

  function text(value, maximum = 300) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
  }

  function validId(value) {
    return typeof value === "string" && /^tt\d{7,10}$/.test(value);
  }

  function imageUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password &&
        ["images.metahub.space", "m.media-amazon.com", "image.tmdb.org"].includes(url.hostname)
        ? url.href : "";
    } catch (_) { return ""; }
  }

  function trailerUrl(value) {
    try {
      const url = new URL(value);
      const id = url.searchParams.get("v");
      return url.protocol === "https:" && url.hostname === "www.youtube.com" &&
        url.pathname === "/watch" && /^[\w-]{11}$/.test(id || "")
        ? "https://www.youtube.com/watch?v=" + id : null;
    } catch (_) { return null; }
  }

  function normalizedMovie(value) {
    if (!value || typeof value !== "object" || !validId(value.id) || !text(value.title)) return null;
    const strings = (items, maximum) => Array.isArray(items)
      ? [...new Set(items.map(item => text(item)).filter(Boolean))].slice(0, maximum) : [];
    return {
      id: value.id,
      title: text(value.title),
      originalTitle: text(value.originalTitle),
      year: Number.isInteger(value.year) && value.year >= 1888 && value.year <= 2200 ? value.year : null,
      runtime: Number.isInteger(value.runtime) && value.runtime > 0 && value.runtime <= 1440 ? value.runtime : null,
      genres: strings(value.genres, 12),
      certification: ["G", "PG", "PG-13", "R", "NC-17"].includes(value.certification)
        ? value.certification : "Sin clasificación",
      overview: text(value.overview, 6000) || "Sinopsis no disponible.",
      cast: strings(value.cast, 20),
      poster: imageUrl(value.poster),
      language: text(value.language, 120) || "No disponible",
      trailer: trailerUrl(value.trailer)
    };
  }

  function normalizeMovie(meta, expectedId) {
    if (!meta || typeof meta !== "object" || meta.type !== "movie" ||
        meta.id !== expectedId || !validId(meta.id) || !text(meta.name)) {
      throw new Error("La API no devolvió una ficha de película válida.");
    }
    const yearMatch = String(meta.year || meta.releaseInfo || meta.released || "").match(/^\d{4}/);
    const durationMatch = typeof meta.runtime === "string" && meta.runtime.match(/^(\d+)\s*min(?:utes)?$/i);
    const trailers = Array.isArray(meta.trailerStreams) ? meta.trailerStreams : [];
    const videos = Array.isArray(meta.trailers) ? meta.trailers : [];
    const trailerId = [...trailers.map(item => item && item.ytId),
      ...videos.filter(item => item && /trailer/i.test(item.type || "")).map(item => item.source)]
      .find(value => typeof value === "string" && /^[\w-]{11}$/.test(value));
    const genreList = Array.isArray(meta.genres) ? meta.genres : Array.isArray(meta.genre) ? meta.genre : [];
    return normalizedMovie({
      id: meta.id,
      title: meta.name,
      originalTitle: meta.originalTitle || meta.original_name,
      year: yearMatch ? Number(yearMatch[0]) : null,
      runtime: durationMatch ? Number(durationMatch[1]) : Number.isInteger(meta.runtime) ? meta.runtime : null,
      genres: genreList.map(genre => GENRES[genre] || text(genre)),
      certification: meta.certification || meta.certificate || meta.rated,
      overview: meta.description,
      cast: meta.cast,
      poster: meta.poster,
      language: typeof meta.language === "string" ? meta.language : "",
      trailer: trailerId ? "https://www.youtube.com/watch?v=" + trailerId : null
    });
  }

  function defaultStorage() {
    if (typeof window === "undefined") return null;
    try { return typeof localStorage !== "undefined" ? localStorage : null; }
    catch (_) { return null; }
  }

  function createClient(options = {}) {
    const fetcher = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const storage = Object.prototype.hasOwnProperty.call(options, "storage") ? options.storage : defaultStorage();
    const now = options.now || Date.now;
    const timeoutMs = options.timeoutMs || 8000;
    const ids = options.ids || IDS;
    const records = new Map();
    let catalogRequest = null;
    const detailRequests = new Map();
    let status = { source: "network", stale: false, partial: false, received: 0, requested: 0, warning: "" };

    try {
      const cached = JSON.parse(storage ? storage.getItem(CACHE_KEY) : "null");
      if (cached && cached.version === 1 && Array.isArray(cached.entries)) {
        cached.entries.slice(0, 100).forEach(entry => {
          const movie = entry && normalizedMovie(entry.movie);
          if (movie && Number.isFinite(entry.fetchedAt) && entry.fetchedAt > 0 && entry.fetchedAt <= now()) {
            records.set(movie.id, { movie, fetchedAt: entry.fetchedAt });
          }
        });
      }
    } catch (_) {}

    function save() {
      try {
        if (storage) storage.setItem(CACHE_KEY, JSON.stringify({ version: 1, entries: [...records.values()].slice(-100) }));
      } catch (_) {}
    }

    async function requestMovie(id) {
      if (!fetcher) throw new Error("Tu navegador no permite consultar el catálogo.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher("https://v3-cinemeta.strem.io/meta/movie/" + id + ".json", {
          signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" }
        });
        if (!response.ok) throw new Error("No pudimos consultar la API de películas (" + response.status + ").");
        const data = await response.json();
        return normalizeMovie(data && data.meta, id);
      } catch (error) {
        if (error && error.name === "AbortError") throw new Error("La API de películas tardó demasiado en responder. Vuelve a intentarlo.");
        if (error instanceof TypeError) throw new Error("No pudimos conectar con la API de películas. Revisa tu conexión.");
        if (error instanceof SyntaxError) throw new Error("La API de películas devolvió una respuesta que no se pudo leer.");
        throw error;
      } finally { clearTimeout(timer); }
    }

    async function readMovie(id, force) {
      if (!validId(id)) throw new Error("El identificador de la película no es válido.");
      const cached = records.get(id);
      if (!force && cached && now() - cached.fetchedAt < CACHE_TTL) {
        return { movie: cached.movie, source: "cache", stale: false };
      }
      try {
        if (!detailRequests.has(id)) {
          const request = requestMovie(id).then(movie => {
            records.set(id, { movie, fetchedAt: now() });
            save();
            return movie;
          }).finally(() => detailRequests.delete(id));
          detailRequests.set(id, request);
        }
        return { movie: await detailRequests.get(id), source: "network", stale: false };
      } catch (error) {
        if (cached) return { movie: cached.movie, source: "cache", stale: true };
        throw error;
      }
    }

    function updateStatus(results, requested) {
      const success = results.filter(Boolean);
      const stale = success.some(result => result.stale);
      const partial = success.length < requested;
      const sources = new Set(success.map(result => result.source));
      const warning = [
        stale ? "Sin conexión actualizada: se muestran datos guardados anteriormente." : "",
        partial ? "No se pudieron cargar " + (requested - success.length) + " películas. Puedes volver a intentarlo." : ""
      ].filter(Boolean).join(" ");
      status = { source: sources.size === 1 ? [...sources][0] : "mixed", stale, partial,
        received: success.length, requested, warning };
    }

    async function getMovie(id, { force = false } = {}) {
      try {
        const result = await readMovie(id, force);
        updateStatus([result], 1);
        return structuredClone(result.movie);
      } catch (error) {
        updateStatus([], 1);
        throw error;
      }
    }

    async function loadCatalog({ force = false, onProgress } = {}) {
      if (catalogRequest) return catalogRequest;
      catalogRequest = (async () => {
        const results = new Array(ids.length);
        let next = 0;
        let completed = 0;
        async function worker() {
          while (next < ids.length) {
            const index = next++;
            try { results[index] = await readMovie(ids[index], force); }
            catch (_) { results[index] = null; }
            completed++;
            if (typeof onProgress === "function") onProgress({ completed, total: ids.length });
          }
        }
        await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
        updateStatus(results, ids.length);
        const movies = results.filter(Boolean).map(result => structuredClone(result.movie));
        if (!movies.length) throw new Error("No pudimos cargar el catálogo. Revisa tu conexión y vuelve a intentarlo.");
        return movies;
      })();
      try { return await catalogRequest; }
      finally { catalogRequest = null; }
    }

    return { loadCatalog, getMovie, getStatus: () => ({ ...status }), source: SOURCE, SOURCE };
  }

  const client = createClient();
  return { ...client, createClient, normalizeMovie, CACHE_KEY, CACHE_TTL, IDS };
});
