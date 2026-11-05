const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient, normalizeMovie, CACHE_KEY, CACHE_TTL } = require("../js/api.js");

const ID = "tt0111161";
const ID2 = "tt1375666";
const meta = id => ({ id, type: "movie", name: "Test film", year: "2000", runtime: "123 min",
  genres: ["Action", "Sci-Fi"], description: "Test synopsis", cast: ["Actor A"],
  poster: "https://images.metahub.space/poster/small/" + id + "/img",
  trailerStreams: [{ ytId: "abcdefghijk" }] });
const response = id => ({ ok: true, json: async () => ({ meta: meta(id) }) });
function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}

test("normalizes actual source fields without inventing classification or language", () => {
  const movie = normalizeMovie(meta(ID), ID);
  assert.equal(movie.runtime, 123);
  assert.equal(movie.year, 2000);
  assert.deepEqual(movie.genres, ["Acción", "Ciencia ficción"]);
  assert.equal(movie.certification, "Sin clasificación");
  assert.equal(movie.language, "No disponible");
  assert.equal(movie.trailer, "https://www.youtube.com/watch?v=abcdefghijk");
});

test("rejects wrong IDs and non-movies, drops untrusted external URLs", () => {
  assert.throws(() => normalizeMovie(meta(ID), ID2));
  assert.throws(() => normalizeMovie({ ...meta(ID), type: "series" }, ID));
  const movie = normalizeMovie({ ...meta(ID), poster: "javascript:alert(1)", trailerStreams: [{ ytId: "bad" }] }, ID);
  assert.equal(movie.poster, "");
  assert.equal(movie.trailer, null);
});

test("detail requests fetch one movie without fetching the whole catalogue", async () => {
  const calls = [];
  const client = createClient({ storage: null, fetch: async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, "omit");
    return response(ID);
  } });
  assert.equal((await client.getMovie(ID)).id, ID);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://v3-cinemeta.strem.io/meta/movie/" + ID + ".json");
  await assert.rejects(client.getMovie("../../config"), /identificador/);
  assert.equal(calls.length, 1);
});

test("fresh cached records work across clients; force refresh bypasses cache", async () => {
  const storage = memory();
  let count = 0;
  const opts = { storage, now: () => 1000000, ids: [ID], fetch: async () => { count++; return response(ID); } };
  await createClient(opts).loadCatalog();
  const client = createClient(opts);
  const movies = await client.loadCatalog();
  assert.equal(count, 1);
  assert.equal(client.getStatus().source, "cache");
  movies[0].title = "Changed externally";
  assert.equal((await client.getMovie(ID)).title, "Test film");
  await client.loadCatalog({ force: true });
  assert.equal(count, 2);
});

test("network failure reuses validated stale cache and reports it", async () => {
  const storage = memory();
  await createClient({ storage, now: () => 1000, ids: [ID], fetch: async () => response(ID) }).loadCatalog();
  const client = createClient({ storage, now: () => CACHE_TTL + 2000, ids: [ID], fetch: async () => { throw new Error("offline"); } });
  assert.equal((await client.loadCatalog())[0].id, ID);
  assert.equal(client.getStatus().stale, true);
  assert.match(client.getStatus().warning, /guardados/);
  assert.ok(storage.getItem(CACHE_KEY));
});

test("partial catalog reports missing movies and does not fabricate records", async () => {
  const client = createClient({ storage: null, ids: [ID, ID2], fetch: async url => {
    if (url.includes(ID2)) return { ok: false, status: 503 };
    return response(ID);
  } });
  assert.equal((await client.loadCatalog()).length, 1);
  assert.equal(client.getStatus().partial, true);
  assert.equal(client.getStatus().received, 1);
  assert.equal(client.getStatus().requested, 2);
});

test("corrupt cache is ignored and complete API failure produces a recoverable error", async () => {
  const storage = memory({ [CACHE_KEY]: "{broken", "sakila:club:v1": "keep" });
  const client = createClient({ storage, ids: [ID], fetch: async () => { throw new Error("offline"); } });
  await assert.rejects(client.loadCatalog(), /conexión/);
  assert.equal(storage.getItem("sakila:club:v1"), "keep");
  assert.equal(storage.getItem(CACHE_KEY), "{broken");
});

test("a timed out request is aborted and its error is recoverable", async () => {
  const client = createClient({ storage: null, timeoutMs: 5, fetch: (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })));
  }) });
  await assert.rejects(client.getMovie(ID), /tardó demasiado/);
});

test("catalogue fetch concurrency never exceeds four", async () => {
  let active = 0;
  let maximum = 0;
  const ids = Array.from({ length: 9 }, (_, i) => "tt" + (1000000 + i));
  const client = createClient({ storage: null, ids, fetch: async url => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return response(url.match(/(tt\d+)\.json/)[1]);
  } });
  const movies = await client.loadCatalog();
  assert.equal(movies.length, ids.length);
  assert.equal(maximum, 4);
});
