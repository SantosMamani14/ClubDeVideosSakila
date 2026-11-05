(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./domain.js"));
  else root.SakilaStore = factory(root.SakilaDomain);
})(typeof globalThis !== "undefined" ? globalThis : this, function (D) {
  "use strict";

  const STORAGE_KEY = "sakila:club:v1";
  const clone = value => JSON.parse(JSON.stringify(value));
  const emptyState = () => ({ version: 1, cart: [], favorites: [], rentals: [] });

  function sanitize(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.cart) || !Array.isArray(raw.favorites) || !Array.isArray(raw.rentals)) {
      throw new Error("Datos locales incompatibles.");
    }
    const state = emptyState();
    let damaged = false;
    const seenCart = new Set();
    const seenFavorites = new Set();
    const seenRentals = new Set();
    const activeMovies = new Set();
    function read(items, action) {
      for (const item of items) {
        try { action(item); } catch { damaged = true; }
      }
    }
    read(raw.cart, item => {
      const movie = D.validateMovie(item.movie);
      const days = D.normalizeDays(item.days);
      if (seenCart.has(movie.id)) throw new Error("Duplicado.");
      seenCart.add(movie.id);
      state.cart.push({ movie, days });
    });
    read(raw.favorites, item => {
      const movie = D.validateMovie(item);
      if (seenFavorites.has(movie.id)) throw new Error("Duplicado.");
      seenFavorites.add(movie.id);
      state.favorites.push(movie);
    });
    read(raw.rentals, item => {
      const movie = D.validateMovie(item.movie);
      const days = D.normalizeDays(item.days);
      if (typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id) || seenRentals.has(item.id)) throw new Error("Referencia inválida.");
      const startDate = D.dateKey(item.startDate);
      const dueDate = D.dateKey(item.dueDate);
      if (startDate !== item.startDate || dueDate !== item.dueDate || D.addDays(startDate, days) !== dueDate || item.totalCents !== D.rentalTotal(days)) {
        throw new Error("Alquiler inválido.");
      }
      let returnedDate = null;
      let lateFeeCents = null;
      if (item.returnedDate !== null) {
        returnedDate = D.dateKey(item.returnedDate);
        lateFeeCents = D.fineTotal(dueDate, returnedDate);
        if (returnedDate !== item.returnedDate || returnedDate < startDate || lateFeeCents !== item.lateFeeCents) throw new Error("Devolución inválida.");
      } else {
        if (item.lateFeeCents !== null || activeMovies.has(movie.id)) throw new Error("Alquiler activo inválido.");
        activeMovies.add(movie.id);
      }
      seenRentals.add(item.id);
      state.rentals.push({ id: item.id, movie, days, totalCents: item.totalCents, startDate, dueDate, returnedDate, lateFeeCents });
    });
    return { state, damaged };
  }

  function createStore(storage, now = () => new Date()) {
    let state = emptyState();
    let warning = "";
    let persistent = Boolean(storage && typeof storage.getItem === "function" && typeof storage.setItem === "function");
    const listeners = new Set();
    if (!persistent) warning = "El almacenamiento local no está disponible. Los cambios se conservarán solo en esta página.";

    function getState() { return clone(state); }
    function getWarning() { return warning; }
    function emit() {
      for (const listener of listeners) {
        try { listener(getState()); } catch { }
      }
    }
    function load() {
      if (!persistent) return;
      let raw;
      try { raw = storage.getItem(STORAGE_KEY); }
      catch {
        persistent = false;
        warning = "No se puede acceder al almacenamiento local. Los cambios se conservarán solo en esta página.";
        return;
      }
      if (raw === null) {
        state = emptyState();
        return;
      }
      try {
        const result = sanitize(JSON.parse(raw));
        state = result.state;
        if (result.damaged) {
          persistent = false;
          warning = "Algunos datos guardados no son válidos. Conservamos el archivo original; los cambios de esta página no se guardarán al cerrarla.";
        }
      } catch {
        persistent = false;
        warning = "Los datos locales no se pueden leer. Se conservarán sin modificarlos; los cambios de esta página no se guardarán al cerrarla.";
      }
    }
    function save(next) {
      state = next;
      if (persistent) {
        try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
        catch {
          persistent = false;
          warning = "No se pudieron guardar los cambios. Seguirán disponibles en esta página, pero se perderán al cerrarla.";
        }
      }
      emit();
    }
    function mutate(action) {
      load();
      const next = getState();
      const result = action(next);
      save(next);
      return result === undefined ? getState() : clone(result);
    }
    function activeRental(next, movieId) {
      return next.rentals.some(rental => rental.movie.id === movieId && rental.returnedDate === null);
    }
    function newId(existing) {
      let id;
      do {
        id = "sakila-" + (typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
      } while (existing.some(item => item.id === id));
      return id;
    }

    load();
    return {
      get state() { return getState(); },
      get warning() { return warning; },
      getState,
      getWarning,
      subscribe(listener) {
        if (typeof listener !== "function") throw new TypeError("El suscriptor debe ser una función.");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      addToCart(value, valueDays) {
        const movie = D.validateMovie(value);
        const days = D.normalizeDays(valueDays);
        return mutate(next => {
          if (activeRental(next, movie.id)) throw new Error("Ya tienes esta película pendiente de devolución.");
          const item = next.cart.find(entry => entry.movie.id === movie.id);
          if (item) { item.movie = movie; item.days = days; }
          else next.cart.push({ movie, days });
        });
      },
      updateDays(movieId, value) {
        const days = D.normalizeDays(value);
        return mutate(next => {
          const item = next.cart.find(entry => entry.movie.id === movieId);
          if (!item) throw new Error("Esta película ya no está en el carrito.");
          item.days = days;
        });
      },
      removeFromCart(movieId) {
        return mutate(next => { next.cart = next.cart.filter(entry => entry.movie.id !== movieId); });
      },
      clearCart() {
        return mutate(next => { next.cart = []; });
      },
      toggleFavorite(value) {
        const movie = D.validateMovie(value);
        return mutate(next => {
          const index = next.favorites.findIndex(entry => entry.id === movie.id);
          if (index >= 0) next.favorites.splice(index, 1);
          else next.favorites.push(movie);
        });
      },
      checkout() {
        return mutate(next => {
          if (!next.cart.length) throw new Error("Añade al menos una película al carrito.");
          if (next.cart.some(item => activeRental(next, item.movie.id))) throw new Error("Una película del carrito ya está pendiente de devolución.");
          const startDate = D.dateKey(now());
          const created = [];
          for (const { movie, days } of next.cart) {
            created.push({
              id: newId([...next.rentals, ...created]), movie, days,
              totalCents: D.rentalTotal(days), startDate,
              dueDate: D.addDays(startDate, days), returnedDate: null, lateFeeCents: null
            });
          }
          next.rentals.push(...created);
          next.cart = [];
          return created;
        });
      },
      returnRental(rentalId) {
        return mutate(next => {
          const rental = next.rentals.find(item => item.id === rentalId);
          if (!rental) throw new Error("No encontramos ese alquiler.");
          if (rental.returnedDate !== null) return rental;
          const returnedDate = D.dateKey(now());
          if (returnedDate < rental.startDate) throw new Error("La devolución no puede ser anterior a la fecha de alquiler.");
          rental.returnedDate = returnedDate;
          rental.lateFeeCents = D.fineTotal(rental.dueDate, returnedDate);
          return rental;
        });
      },
      refreshFromStorage() {
        load();
        emit();
        return getState();
      }
    };
  }

  return Object.freeze({ STORAGE_KEY, createStore });
});
