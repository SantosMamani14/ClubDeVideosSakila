(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SakilaDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const POLICY = Object.freeze({
    currency: "BOB",
    dailyRateCents: 1000,
    lateFeeCents: 500,
    minDays: 1,
    maxDays: 30,
    timeZone: "America/La_Paz"
  });
  const calendar = new Intl.DateTimeFormat("en-CA", {
    timeZone: POLICY.timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  });
  const money = new Intl.NumberFormat("es-BO", {
    style: "currency", currency: POLICY.currency,
    currencyDisplay: "narrowSymbol", minimumFractionDigits: 2
  });

  function normalizeDays(value) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!/^[1-9]\d*$/.test(trimmed)) throw new Error("Elige un número entero de días entre 1 y 30.");
      value = Number(trimmed);
    }
    if (!Number.isInteger(value) || value < POLICY.minDays || value > POLICY.maxDays) {
      throw new Error("Elige un número entero de días entre 1 y 30.");
    }
    return value;
  }

  function rentalTotal(days) {
    return normalizeDays(days) * POLICY.dailyRateCents;
  }

  function formatMoney(cents) {
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("El importe no es válido.");
    return money.format(cents / 100);
  }

  function parseDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error("La fecha no es válida.");
    }
    const date = new Date(value + "T12:00:00.000Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value.startsWith("0000")) {
      throw new Error("La fecha no es válida.");
    }
    return date;
  }

  function dateKey(value = new Date()) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      parseDate(value);
      return value;
    }
    if (typeof value === "string") {
      const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
      if (!match) throw new Error("La fecha debe incluir una zona horaria.");
      parseDate(match[1]);
      value = new Date(value);
    }
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("La fecha no es válida.");
    const parts = Object.fromEntries(calendar.formatToParts(value).map(part => [part.type, part.value]));
    const key = `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
    parseDate(key);
    return key;
  }

  function addDays(key, days) {
    if (!Number.isSafeInteger(days) || Math.abs(days) > 365000) throw new Error("El plazo no es válido.");
    const date = parseDate(key);
    date.setUTCDate(date.getUTCDate() + days);
    if (!Number.isFinite(date.getTime())) throw new Error("La fecha no es válida.");
    const result = date.toISOString().slice(0, 10);
    parseDate(result);
    return result;
  }

  function overdueDays(dueDate, asOfDate = dateKey()) {
    return Math.max(0, Math.round((parseDate(asOfDate) - parseDate(dueDate)) / 86400000));
  }

  function fineTotal(dueDate, returnDateOrToday = dateKey()) {
    return overdueDays(dueDate, returnDateOrToday) * POLICY.lateFeeCents;
  }

  function formatDate(key) {
    return new Intl.DateTimeFormat("es-BO", {
      timeZone: "UTC", day: "numeric", month: "long", year: "numeric"
    }).format(parseDate(key));
  }

  function cleanText(value, limit = 300) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  }

  function safeURL(value) {
    if (typeof value !== "string" || value.length > 2048) return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  }

  function textList(value, maximum, length) {
    return Array.isArray(value)
      ? [...new Set(value.map(item => cleanText(item, length)).filter(Boolean))].slice(0, maximum)
      : [];
  }

  function validateMovie(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("La película no es válida.");
    const id = cleanText(value.id, 128);
    const title = cleanText(value.title);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(id) || !title) throw new Error("La película no es válida.");
    const year = typeof value.year === "string" && /^\d{4}$/.test(value.year) ? Number(value.year) : value.year;
    return {
      id, title,
      originalTitle: cleanText(value.originalTitle) || title,
      year: Number.isInteger(year) && year >= 1888 && year <= 9999 ? year : null,
      runtime: Number.isInteger(value.runtime) && value.runtime > 0 && value.runtime <= 1440 ? value.runtime : null,
      genres: textList(value.genres, 20, 80),
      certification: cleanText(value.certification, 40),
      overview: cleanText(value.overview, 10000),
      cast: textList(value.cast, 50, 120),
      poster: safeURL(value.poster),
      language: cleanText(value.language, 80),
      trailer: safeURL(value.trailer) || null
    };
  }

  return Object.freeze({ POLICY, normalizeDays, rentalTotal, formatMoney, dateKey, addDays, overdueDays, fineTotal, formatDate, validateMovie });
});
