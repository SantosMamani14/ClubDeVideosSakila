const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const key = 'sakila:club:v1';
const movie = (id, title, extra = {}) => ({
  id, title, originalTitle: title, year: 2020, runtime: 120, genres: ['Drama'],
  certification: 'PG-13', overview: 'Sinopsis de prueba.', cast: ['Ana Pérez'],
  poster: 'https://images.metahub.space/poster/small/' + id + '/img',
  language: 'No disponible', trailer: 'https://www.youtube.com/watch?v=PLl99DlL6b4', ...extra
});
const movies = [
  movie('tt0111161', 'La película uno'),
  movie('tt0133093', 'Otro mundo', { genres: ['Acción', 'Ciencia ficción'], cast: ['Luis Gómez'], year: 1999, certification: 'R' })
];

async function openPage(t, name, { data, search = '', api, deniedStorage = false } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, name), 'utf8'), {
    url: 'http://localhost:8765/' + name + search,
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const w = dom.window;
  if (data) w.localStorage.setItem(key, typeof data === 'string' ? data : JSON.stringify(data));
  if (deniedStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('Blocked'); } });
  for (const file of ['js/vendor/vue.global.prod.js', 'js/domain.js', 'js/store.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  w.SakilaAPI = api || {
    async loadCatalog() { return structuredClone(movies); },
    async getMovie(id) { const found = movies.find(item => item.id === id); if (!found) throw new Error('Película no encontrada.'); return structuredClone(found); },
    getStatus() { return { warning: '' }; }
  };
  w.eval(fs.readFileSync(path.join(root, 'js/main.js'), 'utf8'));
  const settle = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await w.Vue.nextTick();
    await new Promise(resolve => setImmediate(resolve));
  };
  t.after(() => {
    w.SakilaApp?.$?.appContext.app.unmount();
    dom.window.close();
  });
  await settle();
  assert.deepEqual(errors, [], 'Errores de Vue o del DOM en ' + name);
  assert.equal(w.document.querySelector('#app-loading').hidden, true);
  return { w, doc: w.document, app: w.SakilaApp, settle, errors, snapshot: () => w.localStorage.getItem(key) };
}

function input(ui, selector, value) {
  const element = ui.doc.querySelector(selector);
  assert.ok(element, selector);
  element.value = value;
  element.dispatchEvent(new ui.w.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

test('las siete páginas montan sus plantillas reales con Vue', async t => {
  for (const name of ['index.html', 'catalogo.html', 'pelicula.html', 'carrito.html', 'mi-club.html', 'favoritos.html', 'ayuda.html']) {
    const ui = await openPage(t, name);
    assert.equal(ui.doc.querySelectorAll('h1').length, 1, name);
    assert.equal(ui.doc.querySelector('#app').hasAttribute('v-cloak'), false, name);
    assert.ok(!ui.doc.querySelector('#app').textContent.includes('{{'), name);
    assert.equal(ui.doc.querySelectorAll('.primary-nav a').length, 5, name);
  }
});

test('búsqueda por reparto y género, clasificación y limpiar filtros funcionan', async t => {
  const ui = await openPage(t, 'catalogo.html');
  assert.equal(ui.doc.querySelectorAll('.movie-card').length, 2);
  input(ui, '#busqueda', 'ana perez');
  await ui.settle();
  assert.equal(ui.doc.querySelectorAll('.movie-card').length, 1);
  assert.match(ui.doc.querySelector('.movie-card__title').textContent, /película uno/);
  ui.doc.querySelector('#formulario-filtros').dispatchEvent(new ui.w.Event('reset', { bubbles: true, cancelable: true }));
  await ui.settle();
  input(ui, '#categoria', 'ciencia-ficcion');
  await ui.settle();
  assert.match(ui.doc.querySelector('.movie-card__title').textContent, /Otro mundo/);
  input(ui, '#clasificacion', 'G');
  await ui.settle();
  assert.ok(ui.doc.querySelector('#catalogo-sin-resultados'));
  assert.equal(ui.app.pageNumber, 1);
});

test('favoritos, ficha, carrito, reserva, recarga y devolución conservan los datos', async t => {
  const catalog = await openPage(t, 'catalogo.html');
  catalog.doc.querySelector('.movie-card button').click();
  await catalog.settle();
  const favorite = await openPage(t, 'favoritos.html', { data: catalog.snapshot() });
  assert.equal(favorite.doc.querySelectorAll('.favorite-card').length, 1);
  const detail = await openPage(t, 'pelicula.html', { data: favorite.snapshot(), search: '?id=tt0111161' });
  assert.match(detail.doc.querySelector('#detalle-titulo').textContent, /película uno/);
  assert.match(detail.doc.querySelector('iframe').src, /^https:\/\/www.youtube-nocookie.com\/embed\//);
  input(detail, '#dias-alquiler', '5');
  await detail.settle();
  assert.match(detail.doc.querySelector('#importe-alquiler').textContent, /50/);
  assert.match(detail.doc.querySelector('time').dateTime, /^\d{4}-\d{2}-\d{2}$/);
  detail.doc.querySelector('#formulario-alquiler').dispatchEvent(new detail.w.Event('submit', { bubbles: true, cancelable: true }));
  await detail.settle();
  assert.equal(detail.app.cartCount, 1);
  const cart = await openPage(t, 'carrito.html', { data: detail.snapshot() });
  assert.equal(cart.app.cartTotal, 5000);
  input(cart, '#dias-tt0111161', '');
  await cart.settle();
  assert.equal(cart.doc.querySelector('[type="submit"]').disabled, true);
  assert.equal(JSON.parse(cart.snapshot()).cart[0].days, 5);
  input(cart, '#dias-tt0111161', '2');
  await cart.settle();
  assert.equal(cart.app.cartTotal, 2000);
  cart.doc.querySelector('#formulario-carrito').dispatchEvent(new cart.w.Event('submit', { bubbles: true, cancelable: true }));
  await cart.settle();
  assert.equal(cart.app.cartCount, 0);
  assert.ok(cart.doc.querySelector('#reserva-confirmada'));
  assert.equal(cart.doc.activeElement.id, 'confirmacion-titulo');
  const club = await openPage(t, 'mi-club.html', { data: cart.snapshot() });
  assert.equal(club.doc.querySelectorAll('.rental-card').length, 1);
  club.doc.querySelector('.rental-card button').click();
  await club.settle();
  assert.equal(club.doc.querySelectorAll('.rental-card').length, 0);
  assert.equal(club.doc.querySelectorAll('.history-card').length, 1);
  assert.equal(club.app.finesTotal, 0);
  const reload = await openPage(t, 'mi-club.html', { data: club.snapshot() });
  assert.equal(reload.app.completedRentals.length, 1);
  assert.equal(reload.app.state.favorites.length, 1);
  for (const ui of [catalog, favorite, detail, cart, club, reload]) assert.deepEqual(ui.errors, []);
});

test('el catálogo maneja fallo y reintento sin perder favoritos', async t => {
  let attempts = 0;
  const ui = await openPage(t, 'catalogo.html', { api: {
    async loadCatalog() { if (++attempts === 1) throw new Error('Sin conexión.'); return movies; },
    getStatus() { return { warning: '' }; }
  }});
  assert.match(ui.doc.querySelector('#catalogo-error').textContent, /Sin conexión/);
  ui.doc.querySelector('#catalogo-error button').click();
  await ui.settle();
  assert.equal(ui.doc.querySelector('#catalogo-error'), null);
  assert.equal(ui.doc.querySelectorAll('.movie-card').length, 2);
});

test('almacenamiento bloqueado o corrupto mantiene la app utilizable y avisa', async t => {
  const blocked = await openPage(t, 'catalogo.html', { deniedStorage: true });
  blocked.doc.querySelector('.movie-card button').click();
  await blocked.settle();
  assert.equal(blocked.app.state.favorites.length, 1);
  assert.ok(blocked.app.storageWarning);
  const corrupt = await openPage(t, 'carrito.html', { data: '{malformed' });
  assert.equal(corrupt.snapshot(), '{malformed');
  assert.ok(corrupt.app.storageWarning);
});

test('un enlace inválido no consulta la API y el HTML de un título externo se muestra como texto', async t => {
  let calls = 0;
  const invalid = await openPage(t, 'pelicula.html', { search: '?id=javascript:alert(1)', api: {
    async getMovie() { calls++; }, getStatus() { return { warning: '' }; }
  }});
  assert.equal(calls, 0);
  assert.match(invalid.doc.querySelector('[role="alert"]').textContent, /no es válido/);
  const hostile = movie('tt0111161', '<img src=x onerror=alert(1)>');
  const ui = await openPage(t, 'catalogo.html', { api: {
    async loadCatalog() { return [hostile]; }, getStatus() { return { warning: '' }; }
  }});
  assert.equal(ui.doc.querySelector('.movie-card__title img'), null);
  assert.match(ui.doc.querySelector('.movie-card__title').textContent, /onerror/);
});

test('otra pestaña actualiza el contador y las reservas activas', async t => {
  const ui = await openPage(t, 'index.html');
  const other = ui.w.SakilaStore.createStore(ui.w.localStorage);
  other.addToCart(movies[0], 3);
  ui.w.dispatchEvent(new ui.w.StorageEvent('storage', { key }));
  await ui.settle();
  assert.equal(ui.doc.querySelector('.cart-count').textContent, '1');
  other.checkout();
  ui.w.dispatchEvent(new ui.w.StorageEvent('storage', { key }));
  await ui.settle();
  assert.equal(ui.app.cartCount, 0);
  assert.equal(ui.app.activeRentals.length, 1);
});

test('la paginación y el orden funcionan y una búsqueda reinicia la página', async t => {
  const collection = Array.from({ length: 25 }, (_, index) => movie('tt' + (1000000 + index), 'Película ' + String(index).padStart(2, '0'), { year: 1990 + index }));
  const ui = await openPage(t, 'catalogo.html', { api: {
    async loadCatalog() { return collection; }, getStatus() { return { warning: '' }; }
  }});
  assert.equal(ui.doc.querySelectorAll('.movie-card').length, 12);
  ui.doc.querySelector('.pagination button:last-child').click();
  await ui.settle();
  assert.equal(ui.app.pageNumber, 2);
  assert.match(ui.doc.querySelector('.movie-card__title').textContent, /12/);
  ui.doc.querySelector('.pagination button:last-child').click();
  await ui.settle();
  assert.equal(ui.doc.querySelectorAll('.movie-card').length, 1);
  input(ui, '#busqueda', 'Película 01');
  await ui.settle();
  assert.equal(ui.app.pageNumber, 1);
  assert.equal(ui.doc.querySelectorAll('.movie-card').length, 1);
  ui.app.resetFilters();
  input(ui, '#orden', 'estreno-desc');
  await ui.settle();
  assert.match(ui.doc.querySelector('.movie-card__title').textContent, /24/);
});

test('las multas visibles se calculan por día y se congelan al devolver', async t => {
  const D = require('../js/domain.js');
  const today = D.dateKey();
  const data = { version: 1, cart: [], favorites: [], rentals: [{
    id: 'alquiler-prueba', movie: movies[0], days: 2, totalCents: 2000,
    startDate: D.addDays(today, -5), dueDate: D.addDays(today, -3), returnedDate: null, lateFeeCents: null
  }] };
  const ui = await openPage(t, 'mi-club.html', { data });
  assert.equal(ui.app.lateCount, 1);
  assert.equal(ui.app.finesTotal, 1500);
  ui.doc.querySelector('.rental-card button').click();
  await ui.settle();
  assert.equal(ui.app.activeRentals.length, 0);
  assert.equal(ui.app.completedRentals[0].lateFeeCents, 1500);
  assert.equal(ui.doc.querySelectorAll('.fine-card').length, 1);
  ui.app.today = D.addDays(today, 4);
  await ui.settle();
  assert.equal(ui.app.finesTotal, 1500);
});
