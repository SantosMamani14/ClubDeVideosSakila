const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/domain.js");

test("days accept integers and reject ambiguous or invalid input", () => {
  for (const value of [1, 30, "3", " 7 "]) assert.equal(D.normalizeDays(value), Number(value));
  for (const value of ["", " ", "1e1", "1.5", "1.0", "01", "-1", 0, 31, NaN, Infinity, 1.5, null, true, undefined]) {
    assert.throws(() => D.normalizeDays(value), /entero/);
  }
  assert.equal(D.rentalTotal(3), 3000);
  assert.equal(D.rentalTotal(30), 30000);
  assert.match(D.formatMoney(3000), /30/);
  for (const value of [-1, NaN, 1.5, "1000"]) assert.throws(() => D.formatMoney(value));
});

test("dates follow the La Paz calendar rather than host timezone", () => {
  assert.equal(D.dateKey("2026-11-05T03:59:59Z"), "2026-11-04");
  assert.equal(D.dateKey("2026-11-05T04:00:00Z"), "2026-11-05");
  assert.equal(D.dateKey(new Date("2026-11-05T00:15:00-04:00")), "2026-11-05");
  assert.equal(D.dateKey("2026-11-05"), "2026-11-05");
  assert.equal(D.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(D.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(D.addDays("2028-02-28", 2), "2028-03-01");
});

test("calendar validation rejects rollover and ambiguous dates", () => {
  for (const value of ["2026-02-29", "2026-02-30T12:00:00Z", "2026-11-05T12:00:00", "2026-11-05T24:00:00Z", "11/5/2026", "0000-01-01", new Date(NaN), 1234]) {
    assert.throws(() => D.dateKey(value));
  }
  assert.throws(() => D.addDays("2026-01-01", 1.5));
  assert.throws(() => D.addDays("2026-13-01", 1));
});

test("late fees start the calendar day after the deadline", () => {
  assert.equal(D.overdueDays("2026-11-05", "2026-11-04"), 0);
  assert.equal(D.overdueDays("2026-11-05", "2026-11-05"), 0);
  assert.equal(D.overdueDays("2026-11-05", "2026-11-06"), 1);
  assert.equal(D.fineTotal("2026-11-05", "2026-11-08"), 1500);
});

test("movie snapshots retain safe metadata and reject unsafe links", () => {
  const movie = D.validateMovie({ id: "tt123", title: " A movie ", year: "2024", runtime: 100, cast: ["Actor", "Actor"], genres: ["Drama"], poster: "javascript:alert(1)", trailer: "data:text/html,bad" });
  assert.equal(movie.title, "A movie");
  assert.equal(movie.year, 2024);
  assert.deepEqual(movie.cast, ["Actor"]);
  assert.equal(movie.poster, "");
  assert.equal(movie.trailer, null);
  assert.throws(() => D.validateMovie({ id: "../bad", title: "A movie" }));
  assert.throws(() => D.validateMovie({ id: "tt123", title: "" }));
});
