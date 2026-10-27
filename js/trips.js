/* Trips: which trip a line belongs to, including bookings made before or after the trip (flights, hotels, deposits).
   A trip's total counts every line tagged with it, whatever its date. The yearly Travel budget is unchanged:
   each line still counts in the month it was paid (M.month / M.ytd). Pure; nothing is stored here.
   options(): trips for a picker (on this date first, then the others, nearest first).
   relation(): during / before / after the trip, with days.   cost(): a trip's total and how much was booked before or after.
   rows(): the trips to show for a year on Home.   tag(): a copy of a line put on (or taken off) a trip, or why it cannot be. */
var Trips = (function () {
  'use strict';
  var DAY = 86400000;
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY); }
  function list(cfg) { return (cfg && cfg.trips) || []; }
  function byId(cfg, id) { return list(cfg).filter(function (t) { return t.id === id; })[0] || null; }
  function travelCat(cfg) { return (cfg.categories || []).filter(function (c) { return c.period === 'year' && !c.archived; })[0] || null; }

  function relation(trip, date) {
    if (date < trip.start) return { when: 'before', days: days(date, trip.start) };
    if (date > trip.end) return { when: 'after', days: days(trip.end, date) };
    return { when: 'during', days: 0 };
  }
  /* "Booked 41 days before the trip" / "3 days after the trip" / null during it */
  function say(trip, date) {
    var r = relation(trip, date); if (r.when === 'during') return null;
    var d = r.days === 1 ? '1 day' : r.days + ' days';
    return r.when === 'before' ? d + ' before the trip' : d + ' after the trip';
  }
  function options(cfg, date) {
    var on = [], other = [];
    list(cfg).forEach(function (t) { var r = relation(t, date); (r.when === 'during' ? on : other).push({ trip: t, rel: r }); });
    // upcoming trips first (a booking is usually made before), then past ones, nearest first
    other.sort(function (a, b) { return (a.rel.when === b.rel.when ? a.rel.days - b.rel.days : a.rel.when === 'before' ? -1 : 1); });
    return { on: on.map(function (x) { return x.trip; }), other: other.map(function (x) { return x.trip; }) };
  }

  function counts(t) { return t.type === 'expense'; }
  function cost(cfg, txs, trip, upTo) {
    var out = { total: 0, before: 0, during: 0, after: 0, count: 0, fromFunds: 0, firstDate: null };
    txs.forEach(function (t) {
      if (t.tripId !== trip.id || !counts(t) || (upTo && t.date > upTo)) return;
      var v = M.counted(t), w = relation(trip, t.date).when;
      out.total += v; out[w] += v; out.count++;
      if (t.fundId) out.fromFunds += v;
      if (!out.firstDate || t.date < out.firstDate) out.firstDate = t.date;
    });
    ['total', 'before', 'during', 'after', 'fromFunds'].forEach(function (k) { out[k] = U.round2(out[k]); });
    return out;
  }
  /* Trips for a year (as of the end of month ym): those starting that year, and any with a line booked that year. */
  function rows(cfg, txs, ym) {
    var year = ym.slice(0, 4), upTo = ym + '-31', booked = {};
    txs.forEach(function (t) { if (t.tripId && counts(t) && t.date.slice(0, 4) === year && t.date <= upTo) booked[t.tripId] = 1; });
    return list(cfg).filter(function (t) { return t.start.slice(0, 4) === year || booked[t.id]; })
      .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; })
      .map(function (t) { var c = cost(cfg, txs, t, upTo); return { trip: t, spent: c.total, before: c.before, after: c.after, count: c.count, otherYear: t.start.slice(0, 4) !== year }; });
  }

  /* Put a line on a trip (tripId null takes it off). Spending only; a trip line goes to Travel, as when added by hand,
     except a part of a split, which keeps its category (only a Travel part may carry a trip). */
  function tag(cfg, t, tripId) {
    if (!tripId) { if (!t.tripId) return { skip: 'not on a trip' }; var o = JSON.parse(JSON.stringify(t)); o.tripId = null; return { t: o }; }
    if (t.type !== 'expense') return { skip: 'not spending' };
    var tc = travelCat(cfg), cm = M.catMap(cfg);
    if (t.splitGroup && !(cm[t.categoryId] && cm[t.categoryId].period === 'year')) return { skip: 'part of a split that is not Travel' };
    if (t.tripId === tripId) return { skip: 'already on this trip' };
    var u = JSON.parse(JSON.stringify(t));
    u.tripId = tripId;
    if (tc && !t.splitGroup && !t.fundId) u.categoryId = tc.id;   // a line paid from a big expense keeps that fund's category
    return { t: u };
  }

  return { options: options, relation: relation, say: say, cost: cost, rows: rows, tag: tag, byId: byId, travelCat: travelCat };
})();
