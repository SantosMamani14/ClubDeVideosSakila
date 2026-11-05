(function () {
  "use strict";

  const startup = document.getElementById("app-loading");
  if (!window.Vue || !window.SakilaDomain || !window.SakilaStore || !window.SakilaAPI) {
    if (startup) startup.textContent = "No se pudo iniciar Sakila. Recarga la página para volver a intentarlo.";
    return;
  }

  const D = window.SakilaDomain;
  const API = window.SakilaAPI;
  const page = [...document.body.classList].find(name => name.startsWith("page-"))?.slice(5) || "index";
  const query = new URLSearchParams(window.location.search);
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
  const genreValue = value => normalize(value).replace(/\s+/g, "-");
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  const store = window.SakilaStore.createStore(storage);
  let unsubscribe;
  let clock;
  let requestVersion = 0;
  let storageListener;
  let visibilityListener;

  const app = Vue.createApp({
    data() {
      return {
        page,
        state: store.getState(),
        policies: D.POLICY,
        movies: [],
        detailMovie: null,
        loading: ["catalogo", "pelicula"].includes(page),
        error: "",
        notice: "",
        apiWarning: "",
        storageWarning: store.getWarning(),
        filters: {
          search: query.get("buscar") || "",
          genre: query.get("genero") || "",
          certification: "",
          sort: "titulo-asc"
        },
        pageNumber: 1,
        pageSize: 12,
        selectedDays: "3",
        cartDays: Object.fromEntries(store.getState().cart.map(item => [item.movie.id, String(item.days)])),
        imageErrors: {},
        today: D.dateKey(),
        lastReservation: null
      };
    },
    computed: {
      availableGenres() {
        return [...new Set(this.movies.flatMap(movie => movie.genres))].sort((a, b) => a.localeCompare(b, "es"));
      },
      filteredMovies() {
        const search = normalize(this.filters.search);
        const filtered = this.movies.filter(movie => {
          const matchesSearch = !search || normalize([movie.title, movie.originalTitle, ...movie.cast].join(" ")).includes(search);
          const matchesGenre = !this.filters.genre || movie.genres.some(genre => genreValue(genre) === this.filters.genre);
          const classification = this.filters.certification;
          const known = ["G", "PG", "PG-13", "R", "NC-17"].includes(movie.certification);
          const matchesClassification = !classification || (classification === "sin-clasificar" ? !known : movie.certification === classification);
          return matchesSearch && matchesGenre && matchesClassification;
        });
        return filtered.sort((a, b) => {
          if (this.filters.sort === "estreno-desc") return (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, "es");
          if (this.filters.sort === "duracion-asc") return (a.runtime || Infinity) - (b.runtime || Infinity) || a.title.localeCompare(b.title, "es");
          return a.title.localeCompare(b.title, "es");
        });
      },
      pagedMovies() {
        return this.filteredMovies.slice((this.pageNumber - 1) * this.pageSize, this.pageNumber * this.pageSize);
      },
      totalPages() { return Math.max(1, Math.ceil(this.filteredMovies.length / this.pageSize)); },
      currentMovie() { return this.detailMovie; },
      trailerEmbed() {
        const trailer = this.currentMovie?.trailer;
        if (!trailer) return "";
        try {
          const url = new URL(trailer);
          if (url.protocol !== "https:") return "";
          const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : ["www.youtube.com", "youtube.com"].includes(url.hostname) ? url.searchParams.get("v") : "";
          return /^[\w-]{11}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : "";
        } catch { return ""; }
      },
      cartCount() { return this.state.cart.length; },
      cartTotal() {
        return this.state.cart.reduce((total, item) => total + this.amount(this.cartDays[item.movie.id] ?? item.days), 0);
      },
      checkoutInvalid() {
        return !this.cartCount || this.state.cart.some(item => !this.validDays(this.cartDays[item.movie.id] ?? item.days) || this.isRented(item.movie.id));
      },
      activeRentals() {
        return this.state.rentals.filter(rental => !rental.returnedDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      },
      completedRentals() {
        return this.state.rentals.filter(rental => rental.returnedDate).sort((a, b) => b.returnedDate.localeCompare(a.returnedDate));
      },
      lateCount() { return this.activeRentals.filter(rental => this.lateDays(rental) > 0).length; },
      fines() { return this.state.rentals.filter(rental => this.feeFor(rental) > 0); },
      finesTotal() { return this.fines.reduce((sum, rental) => sum + this.feeFor(rental), 0); }
    },
    watch: {
      filters: {
        deep: true,
        handler() { this.pageNumber = 1; }
      },
      totalPages(value) { this.pageNumber = Math.min(this.pageNumber, value); }
    },
    methods: {
      money: D.formatMoney,
      displayDate: D.formatDate,
      genreValue,
      movieUrl(movie) { return `pelicula.html?id=${encodeURIComponent(typeof movie === "string" ? movie : movie.id)}`; },
      moviePrice() { return D.POLICY.dailyRateCents; },
      validDays(value) {
        try { D.normalizeDays(value); return true; } catch { return false; }
      },
      amount(value) {
        try { return D.rentalTotal(value); } catch { return 0; }
      },
      dueFor(value) {
        try { return D.addDays(this.today, D.normalizeDays(value)); } catch { return ""; }
      },
      isFavorite(id) { return this.state.favorites.some(movie => movie.id === id); },
      isInCart(id) { return this.state.cart.some(item => item.movie.id === id); },
      isRented(id) { return this.state.rentals.some(rental => rental.movie.id === id && !rental.returnedDate); },
      lateDays(rental) { return D.overdueDays(rental.dueDate, rental.returnedDate || this.today); },
      feeFor(rental) { return rental.returnedDate ? rental.lateFeeCents : D.fineTotal(rental.dueDate, this.today); },
      rentalStatus(rental) {
        if (rental.returnedDate) return this.lateDays(rental) ? "Devuelta fuera de plazo" : "Devuelta a tiempo";
        return this.lateDays(rental) ? "Devolución vencida" : "En préstamo";
      },
      onImageError(id) { this.imageErrors[id] = true; },
      acceptState(next) {
        const drafts = {};
        for (const item of next.cart) {
          const draft = this.cartDays[item.movie.id];
          drafts[item.movie.id] = draft !== undefined && !this.validDays(draft) ? draft : String(item.days);
        }
        this.cartDays = drafts;
        this.state = next;
        this.storageWarning = store.getWarning();
      },
      runAction(action, message) {
        try {
          const result = action();
          this.notice = typeof message === "function" ? message(result) : message;
          this.storageWarning = store.getWarning();
          return result;
        } catch (error) {
          this.acceptState(store.getState());
          this.notice = error.message || "No se pudo completar la acción. Inténtalo de nuevo.";
          return null;
        }
      },
      toggleFavorite(movie) {
        const existed = this.isFavorite(movie.id);
        this.runAction(() => store.toggleFavorite(movie), existed ? `${movie.title} se quitó de favoritos.` : `${movie.title} se guardó en favoritos.`);
      },
      addToCart(movie, days = 3) {
        this.runAction(() => store.addToCart(movie, days), `${movie.title} se añadió al carrito. Puedes revisar los días antes de reservar.`);
      },
      updateCartDays(id, value) {
        this.cartDays[id] = value;
        this.lastReservation = null;
        if (!this.validDays(value)) return;
        try { store.updateDays(id, value); }
        catch (error) { this.notice = error.message; this.acceptState(store.getState()); }
      },
      removeFromCart(id) {
        this.runAction(() => store.removeFromCart(id), "Película eliminada del carrito.");
        this.lastReservation = null;
      },
      clearCart() {
        this.runAction(() => store.clearCart(), "El carrito está vacío.");
        this.lastReservation = null;
      },
      checkout() {
        if (this.checkoutInvalid) {
          this.notice = "Revisa el carrito: cada película necesita entre 1 y 30 días de préstamo.";
          return;
        }
        const created = this.runAction(() => store.checkout(), "Reserva registrada. Consulta tus fechas de devolución en Mi club.");
        if (!created) return;
        this.lastReservation = { ids: created.map(rental => rental.id), count: created.length, totalCents: created.reduce((sum, rental) => sum + rental.totalCents, 0) };
        this.$nextTick(() => document.getElementById("confirmacion-titulo")?.focus());
      },
      returnRental(id) {
        this.runAction(() => store.returnRental(id), rental => `${rental.movie.title}: devolución registrada${rental.lateFeeCents ? `. Multa simulada: ${this.money(rental.lateFeeCents)}` : " sin recargo"}.`);
      },
      resetFilters() {
        this.filters = { search: "", genre: "", certification: "", sort: "titulo-asc" };
        this.pageNumber = 1;
      },
      changePage(delta) {
        this.pageNumber = Math.min(this.totalPages, Math.max(1, this.pageNumber + delta));
        this.$nextTick(() => {
          const heading = document.getElementById("resultados-titulo");
          if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
        });
      },
      async loadMovies(force = true) {
        const version = ++requestVersion;
        this.loading = true;
        this.error = "";
        this.apiWarning = "";
        try {
          if (this.page === "pelicula") {
            const id = query.get("id");
            if (!id) { this.detailMovie = null; return; }
            if (!/^tt\d{7,10}$/.test(id)) throw new Error("El enlace de la película no es válido. Elige un título desde el catálogo.");
            const cached = [...this.state.favorites, ...this.state.cart.map(item => item.movie), ...this.state.rentals.map(rental => rental.movie)].find(movie => movie.id === id);
            try {
              const movie = await API.getMovie(id, { force });
              if (version === requestVersion) this.detailMovie = D.validateMovie(movie);
            } catch (error) {
              if (!cached) throw error;
              if (version === requestVersion) {
                this.detailMovie = cached;
                this.apiWarning = "Mostramos la ficha que ya guardaste; no se pudo actualizar su información.";
              }
            }
            if (this.detailMovie && version === requestVersion) document.title = `${this.detailMovie.title} | Sakila`;
          } else {
            const movies = await API.loadCatalog({ force });
            if (version === requestVersion) {
              this.movies = movies.map(movie => D.validateMovie(movie));
              if (this.filters.genre && !this.availableGenres.some(genre => genreValue(genre) === this.filters.genre)) this.filters.genre = "";
            }
          }
          if (version === requestVersion && !this.apiWarning) this.apiWarning = API.getStatus?.().warning || "";
        } catch (error) {
          if (version === requestVersion) this.error = error.message || "No pudimos cargar las películas. Comprueba tu conexión y vuelve a intentarlo.";
        } finally {
          if (version === requestVersion) this.loading = false;
        }
      }
    },
    mounted() {
      unsubscribe = store.subscribe(next => this.acceptState(next));
      storageListener = event => {
        if (event.key === window.SakilaStore.STORAGE_KEY || event.key === null) store.refreshFromStorage();
      };
      visibilityListener = () => {
        if (document.visibilityState !== "hidden") {
          this.today = D.dateKey();
          store.refreshFromStorage();
        }
      };
      window.addEventListener("storage", storageListener);
      document.addEventListener("visibilitychange", visibilityListener);
      clock = window.setInterval(() => { this.today = D.dateKey(); }, 60000);
      if (["catalogo", "pelicula"].includes(this.page)) this.loadMovies(false);
      if (startup) startup.hidden = true;
    },
    beforeUnmount() {
      unsubscribe?.();
      window.clearInterval(clock);
      window.removeEventListener("storage", storageListener);
      document.removeEventListener("visibilitychange", visibilityListener);
      requestVersion += 1;
    }
  });

  app.config.errorHandler = error => {
    console.error("Sakila:", error);
    if (startup) {
      startup.hidden = false;
      startup.textContent = "Ocurrió un problema al mostrar la página. Recarga para volver a intentarlo.";
    }
  };
  try { window.SakilaApp = app.mount("#app"); }
  catch (error) { app.config.errorHandler(error); }
})();
