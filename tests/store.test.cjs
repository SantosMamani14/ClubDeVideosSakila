const test = require("node:test");
const assert = require("node:assert/strict");
const { createStore, STORAGE_KEY } = require("../js/store.js");

function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value) };
}
const movie = (id = "tt001") => ({ id, title: `Película ${id}`, genres: ["Drama"], cast: ["Actor"] });

test("cart changes persist without duplicate entries or mutable snapshots", () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.addToCart(movie(), 3);
  store.addToCart(movie(), 7);
  assert.equal(store.getState().cart.length, 1);
  assert.equal(store.getState().cart[0].days, 7);
  const snapshot = store.getState();
  snapshot.cart[0].days = 100;
  assert.equal(store.getState().cart[0].days, 7);
  assert.equal(createStore(storage).getState().cart[0].days, 7);
  assert.throws(() => store.updateDays("tt001", "1e1"));
  assert.equal(store.getState().cart[0].days, 7);
  store.removeFromCart("tt001");
  assert.equal(store.getState().cart.length, 0);
});

test("favorites toggle and survive a reload", () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.toggleFavorite(movie());
  const second = createStore(storage);
  assert.equal(second.getState().favorites.length, 1);
  second.toggleFavorite(movie());
  store.refreshFromStorage();
  assert.equal(store.getState().favorites.length, 0);
});

test("checkout is one persisted transaction and rejects duplicate active rentals", () => {
  const storage = memoryStorage();
  let writes = 0;
  const original = storage.setItem;
  storage.setItem = (key, value) => { writes++; original(key, value); };
  const store = createStore(storage, () => new Date("2026-11-05T03:30:00Z"));
  assert.throws(() => store.checkout(), /al menos/);
  store.addToCart(movie(), 2);
  store.addToCart(movie("tt002"), 3);
  const before = writes;
  const rentals = store.checkout();
  assert.equal(writes, before + 1);
  assert.equal(rentals.length, 2);
  assert.equal(rentals[0].startDate, "2026-11-04");
  assert.equal(rentals[0].dueDate, "2026-11-06");
  assert.equal(rentals[0].totalCents, 2000);
  assert.notEqual(rentals[0].id, rentals[1].id);
  const reloaded = createStore(storage);
  assert.equal(reloaded.getState().cart.length, 0);
  assert.equal(reloaded.getState().rentals.length, 2);
  assert.throws(() => reloaded.addToCart(movie(), 1), /pendiente/);
});

test("returns freeze late fees and are idempotent", () => {
  const storage = memoryStorage();
  let clock = "2026-11-01T16:00:00Z";
  const store = createStore(storage, () => new Date(clock));
  store.addToCart(movie(), 2);
  const rental = store.checkout()[0];
  clock = "2026-11-06T03:59:59Z";
  const returned = store.returnRental(rental.id);
  assert.equal(returned.returnedDate, "2026-11-05");
  assert.equal(returned.lateFeeCents, 1000);
  clock = "2026-12-01T16:00:00Z";
  assert.deepEqual(store.returnRental(rental.id), returned);
  assert.equal(createStore(storage).getState().rentals[0].lateFeeCents, 1000);
  store.addToCart(movie(), 1);
  assert.equal(store.getState().cart.length, 1);
  assert.throws(() => store.returnRental("missing"), /encontramos/);
});

test("corrupt saved data remains untouched while the current page can work", () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, "{broken");
  const store = createStore(storage);
  assert.match(store.getWarning(), /no se pueden leer/);
  store.addToCart(movie(), 1);
  assert.equal(store.getState().cart.length, 1);
  assert.equal(storage.getItem(STORAGE_KEY), "{broken");
});

test("partial invalid data keeps valid records without overwriting the original", () => {
  const storage = memoryStorage();
  const saved = JSON.stringify({ version: 1, cart: [{ movie: movie(), days: 2 }, { movie: movie("bad"), days: -1 }], favorites: [], rentals: [] });
  storage.setItem(STORAGE_KEY, saved);
  const store = createStore(storage);
  assert.equal(store.getState().cart.length, 1);
  assert.match(store.getWarning(), /Algunos datos/);
  store.updateDays("tt001", 3);
  assert.equal(store.getState().cart[0].days, 3);
  assert.equal(storage.getItem(STORAGE_KEY), saved);
});

test("denied storage and quota errors retain a functional in-memory state", () => {
  const denied = createStore({ getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } });
  denied.addToCart(movie(), 1);
  assert.equal(denied.checkout().length, 1);
  assert.match(denied.warning, /almacenamiento local/);
  const quota = createStore({ getItem() { return null; }, setItem() { throw new Error("quota"); } });
  quota.addToCart(movie(), 2);
  quota.updateDays("tt001", 3);
  assert.equal(quota.getState().cart[0].days, 3);
  assert.match(quota.warning, /guardar/);
});

test("successive mutations refresh persisted state across tabs", () => {
  const storage = memoryStorage();
  const first = createStore(storage);
  const second = createStore(storage);
  first.addToCart(movie(), 1);
  second.addToCart(movie("tt002"), 2);
  first.toggleFavorite(movie());
  assert.equal(first.getState().cart.length, 2);
  second.refreshFromStorage();
  assert.equal(second.getState().favorites.length, 1);
  let notices = 0;
  const unsubscribe = second.subscribe(() => { notices++; });
  second.clearCart();
  unsubscribe();
  second.toggleFavorite(movie());
  assert.equal(notices, 1);
});
