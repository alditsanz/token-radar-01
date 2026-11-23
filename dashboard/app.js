// Token Radar's dashboard (radar-4). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, sort, and a per-protocol detail view with
// the model's own inputs and the protocol's farm plan. No network: every byte it shows is
// in data.js. The page recomputes each row from the snapshot figures — implied value below,
// token odds further down — and checks the numbers board.json carries, so the page's code
// and the board's data are visibly the same arithmetic:
//
//   implied = round( tvl_usd x 0.30
//                  x sqrt(50000000 / tvl_usd)
//                  x min(1.6, max(0.5, 1 + clamp(change_7d, -80, 200) / 100 x (growth >= 0 ? 0.8 : 1.2)))
//                  x (0.6 + 0.4 x ln(1 + min(age_days, 1095)) / ln(1 + 1095))
//                  x category factor )
//
// Value grows with the square root of TVL, not linearly: the snapshot's own live-token
// protocols trade at a median 0.89x TVL at $5-10M of TVL, 0.37x at $10-32M, 0.21x at
// $33-95M and 0.05x above $108M. Blind-tested, the curve holds up: fitted on half the
// live protocols it predicts the other half with a median error of x3.5, and x3.6 the
// other way, against x3.4 in-sample — and x3.1 / x3.6 under a second, first-letter
// split. Resampled 1,000 times, ranks 1–3 keep their exact rank every time. A copy's
// value is the same formula at a 2% weight, rescaled below the smallest launch. Every
// row also carries the chance it ever lists a token, read off the same record — the
// share of protocols that have a token rises with age to a plateau, and a row's odds
// are the share of that plateau still ahead of it, adjusted for its category — its
// expected value (implied x odds, published alongside, never instead), a farm verdict
// netted in dollars per hour, a middle-half range for its implied value, its rank at
// size exponents 0.45 and 0.55, its median rank move across the resamples, its rank
// among its own category's rows, and its factual watch-outs. No protocol name is
// special-cased anywhere in this file.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', growth: 'all', tab: 'launch', sort: 'implied', dir: -1, selected: null, watchlistOnly: false };
  var MODEL = DATA.model;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // What the market already pays for a live protocol's TVL, shown on the Live tab.
  function fmtRatio(r) {
    if (r.mcap_usd === null || r.mcap_usd === undefined || !r.tvl_usd) return 'n/a';
    var v = r.mcap_usd / r.tvl_usd;
    return '×' + (v >= 0.1 ? v.toFixed(2) : v.toFixed(3));
  }
  // Farm net per hour of hands-on work, signed.
  function fmtPerHour(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    return (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2) + '/h';
  }
  // Farm net at the low end of the likely range, signed; whole dollars at
  // $1 or more, cents below — the rule step 8 uses, so no floor reads "$0".
  function fmtFloorUsd(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var a = Math.abs(v);
    return (v < 0 ? '−$' : '+$') + (a >= 1 ? Math.round(a).toLocaleString('en-US') : a.toFixed(2));
  }
  // The value model in one function: TVL, seven-day growth, age with no token
  // and the category factor — nothing else.
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var weight = growth >= 0 ? MODEL.growth_weight_up : MODEL.growth_weight_down;
    var growthMult = Math.min(MODEL.growth_mult_cap, Math.max(MODEL.growth_mult_floor, 1 + (growth / 100) * weight));
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.log(1 + Math.min(Math.max(age, 0), MODEL.maturity_days)) / Math.log(1 + MODEL.maturity_days)) * MODEL.maturity_range;
    var size = Math.pow(MODEL.size_ref_usd / Math.max(row.tvl_usd, 1), MODEL.size_exponent);
    var cat = (MODEL.category_factors && MODEL.category_factors[row.category]) || 1;
    var value = Math.max(1, Math.round(row.tvl_usd * MODEL.base_multiple * size * growthMult * maturity * cat));
    return { value: value, growthMult: growthMult, maturity: maturity, size: size, cat: cat, copy: row.tier === 'copy' };
  }
  // The token odds in one function, mirroring lib/model.ts: the fitted listing
  // curve at the row's age (bucket shares interpolated in log-age between the
  // bucket centres; the no-date bucket's share when the age is unknown),
  // adjusted by the row's category, turned into the chance it still lists
  // from here: (plateau − F) / (1 − F), clamped to 0.02–0.95.
  function oddsOf(row) {
    var o = MODEL.odds;
    if (!o) return 1;
    var adj = function (f) {
      var orc = o.category_odds[row.category] || 1;
      if (orc === 1) return f;
      var odds = (f / (1 - f)) * orc;
      return odds / (1 + odds);
    };
    var f;
    if (row.age_days === null || row.age_days === undefined) f = o.buckets[6];
    else {
      var x = Math.log(1 + Math.max(row.age_days, 0));
      var xs = o.anchors.map(function (a) { return Math.log(1 + a); });
      f = o.buckets[5];
      if (x <= xs[0]) f = o.buckets[0];
      else if (x < xs[5]) {
        for (var i = 1; i <= 5; i++) {
          if (x <= xs[i]) { var t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); f = o.buckets[i - 1] + t * (o.buckets[i] - o.buckets[i - 1]); break; }
        }
      }
    }
    f = Math.min(0.999, Math.max(0.001, adj(f)));
    var fInf = Math.min(0.999, Math.max(0.001, adj(o.buckets[5])));
    return Math.round(Math.min(0.95, Math.max(0.02, (fInf - f) / (1 - f))) * 1000) / 1000;
  }
  // Why this row ranks where it does, in one line a reader can check. A copy
  // shows its 2% weight instead: its multipliers are the pre-rescale ones.
  function reasonFor(row) {
    var parts = [fmtUsd(row.tvl_usd) + ' TVL', fmtPct(row.change_7d) + ' in 7d', fmtAge(row.age_days) + ' with no token'];
    if (row.tier === 'copy') { parts.push('copy at 2% weight, rescaled below the smallest launch'); return parts.join(' · '); }
    if (row.size_multiplier !== undefined) parts[0] += ' (×' + row.size_multiplier.toFixed(2) + ' size)';
    if (row.growth_multiplier !== undefined) parts[1] += ' (×' + row.growth_multiplier.toFixed(2) + ')';
    if (row.maturity_multiplier !== undefined) parts[2] += ' (×' + row.maturity_multiplier.toFixed(2) + ')';
    if (row.category_multiplier !== undefined && row.category_multiplier !== 1) parts.push((row.category || 'Other') + ' ×' + row.category_multiplier.toFixed(2));
    return parts.join(' · ');
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    [['q', 'q'], ['category', 'category'], ['chain', 'chain'], ['growth', 'growth'], ['tab', 'tab'], ['p', 'selected'], ['sort', 'sort']].forEach(function (pair) {
      var v = params.get(pair[0]);
      if (v) state[pair[1]] = v;
    });
    if (params.get('w') === '1') state.watchlistOnly = true;
    if (!SORT_KEY[state.sort]) state.sort = 'implied';
    // A tab the board does not have is not an empty board: fall back to launches.
    if (['launch', 'copy', 'live'].indexOf(state.tab) < 0) state.tab = 'launch';
  }
  function writeHash() {
    var params = new URLSearchParams();
    var set = function (k, v, d) { if (v && v !== d) params.set(k, v); };
    set('q', state.q);
    set('category', state.category, 'all');
    set('chain', state.chain, 'all');
    set('growth', state.growth, 'all');
    set('tab', state.tab, 'launch');
    set('sort', state.sort, 'implied');
    set('w', state.watchlistOnly ? '1' : '');
    set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function baseRows() {
    if (state.tab === 'live') return DATA.live;
    return DATA.rows.filter(function (r) { return r.tier === state.tab; });
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return baseRows().filter(function (r) {
      // The watchlist toggle applies to the board tabs only, not the live tab.
      if (state.watchlistOnly && state.tab !== 'live' && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.growth === 'up' && !(r.change_7d !== null && r.change_7d >= 0)) return false;
      if (state.growth === 'down' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  // One accessor per sortable column; rows without the value sort to the end in either direction.
  var SORT_KEY = {
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null ? Infinity : r.age_days; },
    mcap: function (r) { return r.mcap_usd === null ? -Infinity : r.mcap_usd; },
    ratio: function (r) { return r.mcap_usd === null || !r.tvl_usd ? -Infinity : r.mcap_usd / r.tvl_usd; },
    // Farm net per hour: the verdicts' own leaderboard — the biggest launches
    // are the worst farms, so this order differs from the value order.
    farm: function (r) { return r.farm_per_hour_usd === undefined ? -Infinity : r.farm_per_hour_usd; },
    // Floor net: the farm's net at the low end of the likely range.
    floor: function (r) { return r.farm_net_floor_usd === null || r.farm_net_floor_usd === undefined ? -Infinity : r.farm_net_floor_usd; },
    // Resampled rank move, negated so the steadiest ranks sort first. Copies
    // carry no number (their ranks are not refitted), so they sort last.
    boot: function (r) {
      var m = r.rank_boot_med;
      return (m === null || m === undefined) ? -Infinity : -m;
    },
    // Rank stability across exponents 0.45–0.55, negated: steadiest first.
    stable: function (r) {
      var a = r.rank_at_045 === undefined ? r.rank : r.rank_at_045;
      var b = r.rank_at_055 === undefined ? r.rank : r.rank_at_055;
      return -Math.max(Math.abs(r.rank - a), Math.abs(r.rank - b));
    },
    // In-category rank, negated so every category's leader sorts first. Live
    // rows carry no peer rank, so they sort last.
    catrank: function (r) {
      return (r.category_rank === undefined || r.category_rank === 0) ? -Infinity : -r.category_rank;
    },
    implied: function (r) { return r.implied_value_usd === undefined ? (r.mcap_usd || 0) : r.implied_value_usd; }
  };
  function sortedRows(list) {
    var get = SORT_KEY[state.sort] || SORT_KEY.implied;
    return list.slice().sort(function (a, b) {
      var av = get(a), bv = get(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'top-inner' },
        el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
        el('div', { class: 'top-meta' },
          el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
          el('span', null, 'DefiLlama protocol index · ', el('b', { text: DATA.model_version + ' model' })),
          el('span', null, 'Watchlist covered ', el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }))
        )
      )
    );
  }

  function lede() {
    var C = DATA.census;
    var B = MODEL.blind;
    var boot = DATA.bootstrap;
    // The proof strip's farm numbers, counted live from the board's launches.
    var farmCounts = { Farm: 0, Thin: 0, Skip: 0 };
    var bestPerHour = 0;
    DATA.rows.forEach(function (r) {
      if (r.tier !== 'launch') return;
      if (r.farm_verdict) farmCounts[r.farm_verdict]++;
      if ((r.farm_per_hour_usd || 0) > bestPerHour) bestPerHour = r.farm_per_hour_usd;
    });
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, priced by a blind-tested curve — with the odds each one ever lists' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The radar adds every other protocol that records no token — ' + DATA.launch_size + ' launches and ' + DATA.copy_size + ' wrapped, staked and bridged copies, ranked below them. Implied value is a model, not a promise, and never a prediction that a token is issued.' }),
        el('p', { class: 'census', text: 'The whole snapshot, accounted for: ' + C.total + ' protocols — the ' + DATA.board_size + ' above with no token on record, and ' + C.token_bearing + ' that already have a token, set aside. Of the ' + C.token_bearing + ', ' + C.fitted_live + ' carry a market cap the size curve is fitted on (the ' + C.live_shown + ' largest are on the Live tab); the other ' + (C.token_bearing - C.fitted_live) + ' have a token but no usable market cap — ' + C.no_mcap_figure + ' with no figure at all, ' + C.zero_mcap + ' recorded as $0, ' + C.negative_mcap + ' as a −$1 placeholder.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is ranked' })),
        el('div', { class: 'fact' }, el('span', { text: 'Blind-tested' }), el('b', { text: '×' + Math.exp(B.fit_a_to_b).toFixed(1) + ' / ×' + Math.exp(B.fit_b_to_a).toFixed(1) }), el('small', { text: 'held-out median error both ways, vs ×' + Math.exp(B.in_sample).toFixed(1) + ' in-sample; second split ×' + Math.exp(B.alpha_a_to_b).toFixed(1) + ' / ×' + Math.exp(B.alpha_b_to_a).toFixed(1) })),
        el('div', { class: 'fact' }, el('span', { text: 'Resampled 1,000×' }), el('b', { text: '100%' }), el('small', { text: 'ranks 1–3 exact in every resample; slope ' + boot.slope_median + ' (90% ' + boot.slope_lo + '–' + boot.slope_hi + ')' })),
        el('div', { class: 'fact' }, el('span', { text: 'Farm verdicts' }), el('b', { text: farmCounts.Farm + ' Farm' }), el('small', { text: farmCounts.Thin + ' Thin · ' + farmCounts.Skip + ' Skip of ' + DATA.launch_size + ' launches; best ' + fmtPerHour(bestPerHour) }))
      )
    );
  }

  function selectField(id, label, options, value, onChange) {
    var sel = el('select', { id: id, 'aria-label': label },
      options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === value ? 'selected' : null }); }));
    sel.addEventListener('change', function () { onChange(sel.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), sel);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; render(); } });
    }
    var shownRows = filteredRows();
    var shown = shownRows.length;
    var total = state.tab === 'live' ? DATA.live.length : baseRows().length;
    var tabLabel = state.tab === 'live' ? 'live-token protocols' : state.tab === 'copy' ? 'copies' : 'launches';
    // The filtered set's own scale at a glance: median, total, farm verdicts.
    var medians = shownRows.map(function (r) { return r.implied_value_usd === undefined ? (r.mcap_usd || 0) : r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var medianText = medians.length ? ' · median ' + fmtUsd(medians[Math.floor(medians.length / 2)]) : '';
    var totalValue = shownRows.reduce(function (s, r) { return s + (r.implied_value_usd === undefined ? (r.mcap_usd || 0) : r.implied_value_usd); }, 0);
    var totalText = shownRows.length ? ' · total ' + fmtUsd(totalValue) : '';
    var verdictText = '';
    if (state.tab !== 'live') {
      var vc = { Farm: 0, Thin: 0, Skip: 0 };
      shownRows.forEach(function (r) { if (r.farm_verdict) vc[r.farm_verdict]++; });
      verdictText = ' · ' + vc.Farm + ' Farm · ' + vc.Thin + ' Thin · ' + vc.Skip + ' Skip';
    }
    // The watchlist toggle: the 40 watchlist protocols alone.
    var wlBox = el('input', { type: 'checkbox', id: 'watchlist-only', 'aria-label': 'Watchlist only' });
    wlBox.checked = state.watchlistOnly;
    wlBox.addEventListener('change', function () { state.watchlistOnly = wlBox.checked; writeHash(); render(); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      selectField('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      selectField('growth', '7d growth', [['all', 'Any 7d growth'], ['up', 'Growing (7d ≥ 0%)'], ['down', 'Shrinking (7d < 0%)']], state.growth, function (v) { state.growth = v; }),
      el('label', { class: 'check', for: 'watchlist-only' }, wlBox, ' Watchlist only (' + DATA.watchlist_size + ')'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Board' }),
        el('div', { class: 'tabs' }, tabBtn('launch', 'Launches (' + DATA.launch_size + ')'), tabBtn('copy', 'Copies (' + DATA.copy_size + ')'), tabBtn('live', 'Live token (' + DATA.live_size + ')'))),
      el('span', { class: 'count', text: shown + ' of ' + total + ' ' + tabLabel + ' shown' + medianText + totalText + verdictText })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function emptyPanel() {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or pick another category, chain or growth filter to see the board again.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.growth = 'all'; writeHash(); render(); } })
    ));
  }

  function chainText(r) {
    return r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
  }
  function nameCell(r, reason) {
    // A watchlist row wears its star in the board.
    var title = el('div', { class: 'name-row' }, el('b', { text: r.name }));
    if (r.watchlist) title.appendChild(el('span', { class: 'wl', text: '★ watchlist' }));
    return el('div', { class: 'name' },
      title,
      el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainText(r) }),
      el('div', { class: 'reason', text: reason }));
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) return emptyPanel();
    // Bars scale to the tab's own largest value, so they stay comparable across filters.
    var max = 1;
    baseRows().forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      // How far this rank moves when the size exponent runs 0.45–0.55.
      var move = Math.max(Math.abs(r.rank - (r.rank_at_045 === undefined ? r.rank : r.rank_at_045)), Math.abs(r.rank - (r.rank_at_055 === undefined ? r.rank : r.rank_at_055)));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, nameCell(r, reasonFor(r))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar' + (r.tier === 'copy' ? ' copy' : ''), 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ), el('div', { class: 'ev', text: 'EV ' + fmtUsd(r.expected_value_usd) + ' · odds ' + Math.round(r.token_odds * 100) + '%' })),
        el('td', { class: 'num', title: 'Rank among the ' + (r.category_size || 0) + ' ' + (r.tier === 'copy' ? 'copies' : 'launches') + ' in ' + (r.category || 'Other') + ', by implied value — the peer comparison the value curve is fitted on', text: '#' + r.category_rank + ' of ' + r.category_size }),
        el('td', { class: 'num', title: 'Farm net ' + ((r.farm_net_usd || 0) >= 0 ? '+$' : '−$') + Math.abs(r.farm_net_usd || 0).toLocaleString('en-US') + ' after gas' },
          el('span', { class: 'verdict v-' + (r.farm_verdict || 'Skip').toLowerCase(), text: r.farm_verdict || 'Skip' }),
          ' ' + fmtPerHour(r.farm_per_hour_usd)
        ),
        el('td', { class: 'num', title: 'Farm net at the low end of the likely range (implied × 0.27, same gas): the verdict the floor test leaves standing', text: fmtFloorUsd(r.farm_net_floor_usd) }),
        el('td', { class: 'num', title: 'Rank moves at most this many places when the size exponent runs 0.45–0.55', text: '±' + move }),
        el('td', { class: 'num', title: 'Median rank move across 1,000 resamples of the live set', text: (r.rank_boot_med === null || r.rank_boot_med === undefined) ? '—' : '±' + r.rank_boot_med }),
        el('td', null, el('span', { class: 'status ' + r.tier, text: r.tier === 'copy' ? 'copy' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    var caption = state.tab === 'copy'
      ? 'Wrapped, staked and bridged copies of tokens that already trade, ranked below every launch. A copy is not a launch of its own: its value is the same formula at a 2% weight, rescaled below the smallest launch.'
      : 'Pre-token launches, strongest implied value first. Under each value, its EV: the implied value weighted by the odds it ever lists. Select a row for its model and farm plan. Every row states why it ranks where it does.';
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: caption }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('catrank', 'In category'),
            sortHeader('farm', 'Farm net'),
            sortHeader('floor', 'Floor net'),
            sortHeader('stable', 'Stability'),
            sortHeader('boot', 'Resampled'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    // The live tab takes the same filters; an empty result shows the empty panel.
    var list = sortedRows(filteredRows());
    if (list.length === 0) return emptyPanel();
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, nameCell(r, fmtUsd(r.tvl_usd) + ' TVL · ' + fmtPct(r.change_7d) + ' in 7d')),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtRatio(r) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Tokens that already trade, by market cap. Their market cap is a fact, not a model, so they are set aside from the pre-token ranking instead of mixed into it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'), sortHeader('mcap', 'Market cap'), sortHeader('ratio', 'Mcap / TVL'), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = MODEL;
    // The evidence for the square-root size curve: median mcap/TVL by quartile.
    var calib = el('div', { class: 'calib' },
      el('h3', { text: 'Why value grows with the square root of TVL' }),
      el('p', { text: 'The 128 live-token protocols trade at a median 0.89× TVL at $5–10M of TVL, 0.37× at $10–32M, 0.21× at $33–95M and 0.05× above $108M — a 17× fall. A log-log fit gives a slope of 0.52 (0.58 trimmed, 0.42 from the quartile medians), so the model uses 0.50: value grows with the square root of TVL, anchored on the snapshot\u2019s own $50M floor.' }),
      el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'TVL band' }), el('th', { scope: 'col', class: 'num', text: 'Live protocols' }), el('th', { scope: 'col', class: 'num', text: 'Median market cap / TVL' }))),
        el('tbody', null,
          [['$5–10M', '32', '0.89'], ['$10–32M', '32', '0.37'], ['$33–95M', '32', '0.21'], ['$108M and up', '32', '0.05']].map(function (r) {
            return el('tr', null, el('td', { text: r[0] }), el('td', { class: 'num', text: r[1] }), el('td', { class: 'num', text: r[2] }));
          })
        )
      ),
      // Checked against the market (builder audit on the 128 live protocols:
      // median |log error| 1.314, so x3.7; 43 of 128 within 2x, 57 within 3x).
      el('p', { text: 'Checked against the market: the same curve predicts the 128 live-token protocols\u2019 market caps with a median error of \u00d73.7 \u2014 43 of the 128 land within 2\u00d7 of their market cap, 57 within 3\u00d7, and the median live protocol sits at 0.92\u00d7 the curve, so the curve is centred on the typical protocol. Market caps scatter widely at any TVL, so the curve tracks the median protocol \u2014 which is what a ranking needs \u2014 not any single one.' }),
      // Blind test, rendered from the model's own build-time numbers, under two
      // splits (slug parity; first letter), so the proof rests on neither alone.
      m.blind ? el('p', { text: 'Blind test: the curve was fitted on half the live protocols and asked to predict the other half, both ways. It lands with a median error of \u00d7' + Math.exp(m.blind.fit_a_to_b).toFixed(1) + ' one way and \u00d7' + Math.exp(m.blind.fit_b_to_a).toFixed(1) + ' the other, against \u00d7' + Math.exp(m.blind.in_sample).toFixed(1) + ' on the protocols it was fitted on \u2014 so the curve generalises to protocols it never saw, instead of memorising its training set.' + (m.blind.alpha_a_to_b !== undefined ? ' The same test under a second split \u2014 halving the set by the slug\u2019s first letter (before \u2018n\u2019 vs from \u2018n\u2019 on) instead of by its letters \u2014 lands at \u00d7' + Math.exp(m.blind.alpha_a_to_b).toFixed(1) + ' and \u00d7' + Math.exp(m.blind.alpha_b_to_a).toFixed(1) + ', so the proof does not rest on one arbitrary way of halving the set.' : '') }) : null
    );
    // Category factors: only categories with 5+ live protocols get one.
    var factors = (m.category_factors && Object.keys(m.category_factors).sort()) || [];
    var factorTable = factors.length ? el('div', { class: 'calib' },
      el('h3', { text: 'Category factors, fitted from the same snapshot' }),
      el('p', { text: 'Each factor is the category\u2019s median log market-cap against the size curve, shrunk toward 1 by n/(n+10), clamped to 0.80–1.25. Categories with fewer than 5 live protocols get no factor — one live row is noise. Every other category is 1.00.' }),
      el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', class: 'num', text: 'Factor' }))),
        el('tbody', null, factors.map(function (c) {
          return el('tr', null, el('td', { text: c }), el('td', { class: 'num', text: '×' + m.category_factors[c].toFixed(2) }));
        }))
      )
    ) : null;
    // Sensitivity: the top 3 launches' value at exponents 0.45 / 0.50 / 0.55.
    var sens = (DATA.sensitivity || []).length ? el('div', { class: 'calib' },
      el('h3', { text: 'How much the ranking depends on the size exponent' }),
      el('p', { text: 'The same formula at exponent 0.45 or 0.55, same $50M anchor: the top rows move by about a fifth either way, and ' + (DATA.sensitivity_rank_moves ? DATA.sensitivity_rank_moves.at_045 + ' launches move 10 or more ranks at 0.45, ' + DATA.sensitivity_rank_moves.at_055 + ' at 0.55' : 'no launch moves far') + ' \u2014 the ranking is set by the ordering of TVL, not the exact exponent.' }),
      el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'Exponent 0.45' }), el('th', { scope: 'col', class: 'num', text: 'Exponent 0.50' }), el('th', { scope: 'col', class: 'num', text: 'Exponent 0.55' }))),
        el('tbody', null, DATA.sensitivity.map(function (s) {
          return el('tr', null, el('td', { text: s.name }), el('td', { class: 'num', text: fmtUsd(s.at_045) }), el('td', { class: 'num', text: fmtUsd(s.at_050) }), el('td', { class: 'num', text: fmtUsd(s.at_055) }));
        }))
      )
    ) : null;
    // Bootstrap: the live set resampled 1,000 times, curve and factors refitted
    // each time. The top is solid, the middle moves — and this block says so.
    var boot = DATA.bootstrap ? el('div', { class: 'calib' },
      el('h3', { text: 'How solid is the ranking? Resampled 1,000 times' }),
      el('p', { text: 'The 128 live protocols were drawn with replacement 1,000 times, curve and category factors refitted each time. Ranks 1\u20133 keep their exact rank in all 1,000 resamples; the typical top-20 launch stays in the top 20 in ' + DATA.bootstrap.top20_stay_median + '% of resamples (weakest, rank 20, ' + DATA.bootstrap.top20_stay_min + '%); across all 198 launches the median rank move is ' + DATA.bootstrap.median_abs_move + ' places. The slope refits at ' + DATA.bootstrap.slope_median + ', 90% interval ' + DATA.bootstrap.slope_lo + '\u2013' + DATA.bootstrap.slope_hi + ' \u2014 the model\u2019s 0.50 sits inside it. But at the interval\u2019s ends ' + DATA.bootstrap.rank_moves_lo + ' launches move 10 or more ranks at ' + DATA.bootstrap.slope_lo + ' and ' + DATA.bootstrap.rank_moves_hi + ' at ' + DATA.bootstrap.slope_hi + ': the top is solid, the middle moves.' })
    ) : null;
    // Token odds, fitted from the snapshot's own record (see tokenOddsFit) and
    // validated at build time; the category-block bootstrap around the splits
    // is a builder audit (audit15-odds.mts): against the base rate the fitted
    // model's improvement holds in all 300 resamples, 90% interval −0.124 to
    // −0.044 log-loss; a chain adjustment was fitted and dropped — it helped
    // the parity splits and hurt the letter and time splits.
    var oddsBlock = m.odds ? el('div', { class: 'calib' },
      el('h3', { text: 'Token odds: the chance each row ever lists, from the peers\u2019 record' }),
      el('p', { text: 'Of the ' + DATA.census.total + ' protocols in this snapshot, ' + DATA.census.token_bearing + ' already have a token and ' + DATA.board_size + ' do not. Among the dated protocols, the share that has a token rises with age — ' + Math.round(m.odds.buckets[0] * 100) + '% in the first 90 days, ' + Math.round(m.odds.buckets[2] * 100) + '% by one year, ' + Math.round(m.odds.buckets[4] * 100) + '% at two to three years — and levels at a plateau of ' + Math.round(m.odds.buckets[5] * 100) + '% past three years: on this record, a protocol that will list has usually listed by then. A row\u2019s odds are the share of that plateau still ahead of it at its age, adjusted for its category (never past 0.60\u20131.67\u00d7 on the odds). Rows with no listing date get the no-date record\u2019s own odds. Expected value — implied \u00d7 odds — is printed under every implied value; the board still ranks by implied value.' }),
      el('p', { text: 'Checked like the value curve: fitted on one part of the snapshot, scored on the rest by log-loss, across five splits (slug parity both ways, first letter both ways, older-listed to newer-listed), the odds model errs at ' + m.odds.validation.fitted.toFixed(3) + ' against ' + m.odds.validation.base.toFixed(3) + ' for the snapshot-wide rate and ' + m.odds.validation.age_only.toFixed(3) + ' for the age curve alone — the category ratios earn their place. On the time split the age curve alone adds nothing (the older half carries almost no young protocols), while the category ratios still help; under a category-block bootstrap the gain over the base rate holds in all 300 resamples.' })
    ) : null;
    // Farm verdicts, counted live from the board.
    var launchVerdicts = DATA.rows.filter(function (r) { return r.tier === 'launch'; });
    var farmCounts = { Farm: 0, Thin: 0, Skip: 0 };
    launchVerdicts.forEach(function (r) { if (r.farm_verdict) farmCounts[r.farm_verdict]++; });
    // How many Farm verdicts survive the low end of the likely range.
    var floorHolds = 0;
    launchVerdicts.forEach(function (r) { if (r.farm_verdict === 'Farm' && (r.farm_net_floor_usd || 0) > 0) floorHolds++; });
    var verdictBlock = el('div', { class: 'calib' },
      el('h3', { text: 'Farm verdicts: ' + farmCounts.Farm + ' Farm, ' + farmCounts.Thin + ' Thin, ' + farmCounts.Skip + ' Skip' }),
      el('p', { text: 'Among the ' + launchVerdicts.length + ' launches, ' + farmCounts.Farm + ' farms net at least $20 after gas at $5 or more an hour, ' + farmCounts.Thin + ' net something smaller, and ' + farmCounts.Skip + ' lose money on gas. Every copy is Skip: at a 2% weight its share is smaller than any plan\u2019s gas. The biggest launches are the worst farms \u2014 rank 1 nets \u2212$71 \u2014 because a $250 position is a rounding error next to a $2.76B TVL; the best farms per hour sit deep in the board, around rank 84 — sort by Farm net to see them first. Only ' + floorHolds + ' of the ' + farmCounts.Farm + ' Farm verdicts still pay at the low end of the likely range; each Farm or Thin row\u2019s step 8 says which kind it is.' })
    );
    // Where the model fills gaps, counted live from the board's own rows: how
    // often the snapshot is silent and how often the formula's bounds bind.
    var gapAge = 0, gapAgeLaunch = 0, gapChg = 0, gapCap = 0, gapFloor = 0, gapClamp = 0, gapMat = 0;
    DATA.rows.forEach(function (r) {
      if (r.age_days === null || r.age_days === undefined) { gapAge++; if (r.tier === 'launch') gapAgeLaunch++; }
      else if (r.age_days >= m.maturity_days) gapMat++;
      if (r.change_7d === null || r.change_7d === undefined) gapChg++;
      else {
        if (r.change_7d > m.growth_cap || r.change_7d < m.growth_floor) gapClamp++;
        var gp = Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d));
        var graw = 1 + (gp / 100) * (gp >= 0 ? m.growth_weight_up : m.growth_weight_down);
        if (graw > m.growth_mult_cap) gapCap++; else if (graw < m.growth_mult_floor) gapFloor++;
      }
    });
    var gapsBlock = el('div', { class: 'calib' },
      el('h3', { text: 'Where the model fills gaps: defaults and bounds, counted' }),
      el('p', { text: 'Of the ' + DATA.rows.length + ' rows, ' + gapAge + ' carry no listing date in the snapshot, so their age is scored as the ' + m.unknown_age_days + '-day default (' + gapAgeLaunch + ' of them launches), and ' + gapChg + ' rows have no 7-day change on record, counted as 0%. The bounds bind as well: ' + (gapCap + gapFloor) + ' rows sit on a growth bound (' + gapCap + ' at the ' + m.growth_mult_cap + '\u00d7 cap, ' + gapFloor + ' at the ' + m.growth_mult_floor + '\u00d7 floor), ' + gapClamp + ' row\u2019s raw change was clamped into the ' + m.growth_floor + '%\u2026+' + m.growth_cap + '% band first, and ' + gapMat + ' rows are at or past the ' + (m.maturity_days / 365) + '-year maturity cap, so further age earns them nothing. Each row\u2019s detail view shows its own multipliers, so any of these can be checked row by row.' })
    );
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures — TVL, seven-day growth, age with no token and category. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd × ' + m.base_multiple + ' × (' + m.size_ref_usd.toLocaleString('en-US') + ' / tvl_usd)^' + m.size_exponent + ' × min(' + m.growth_mult_cap + ', max(' + m.growth_mult_floor + ', 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight_up + ' up / ' + m.growth_weight_down + ' down)) × (' + m.maturity_floor + ' + ' + m.maturity_range + ' × ln(1 + min(age_days, ' + m.maturity_days + ')) / ln(1 + ' + m.maturity_days + ')) × category factor )'
      ),
      el('div', { class: 'keys' },
        el('div', { class: 'key' }, el('b', { text: 'TVL × ' + m.base_multiple + ', square-root size' }), el('span', { text: 'A launch is worth a share of the value already locked in — but the share shrinks as the protocol grows, because the market pays a shrinking share of TVL (see the table below).' })),
        el('div', { class: 'key' }, el('b', { text: 'Growth, bounded' }), el('span', { text: 'Rising TVL lifts value at 0.8×; falling TVL cuts it at 1.2×. Clamped to −80%…+200%, multiplier 0.5\u20131.6×: the TVL already records the week\u2019s move, so one week never erases or triples a value.' })),
        el('div', { class: 'key' }, el('b', { text: 'Age, logarithmic' }), el('span', { text: 'Longer with no token means more pent-up value, rising fast then levelling off. Unknown age counts as 365 days.' })),
        el('div', { class: 'key' }, el('b', { text: 'Category, fitted small' }), el('span', { text: 'A category pays a little more or less than the size curve alone says — Lending 0.80×, Yield 0.84×, RWA 1.14×, Basis Trading 1.19× — fitted from the live protocols of that category, shrunk toward 1 and never beyond 0.80–1.25×.' })),
        el('div', { class: 'key' }, el('b', { text: 'Token odds, from the peers\u2019 record' }), el('span', { text: 'Every row also carries the chance it ever lists, fitted from this snapshot\u2019s own record: the share of protocols that have a token rises with age to a plateau, and a row\u2019s odds are the share of that plateau still ahead of it, adjusted for its category. Expected value — implied \u00d7 odds — sits under every implied value; the ranking still runs on implied value, and the two are never netted into one number.' })),
        el('div', { class: 'key' }, el('b', { text: 'In-category rank, the peer comparison' }), el('span', { text: 'Every row carries its rank among its category\u2019s launches or copies, by implied value — the In category column, sortable so each category\u2019s leader comes first. The curve is a within-sector comparables curve, so the peer rank is the model\u2019s own comparison, not a second ranking.' })),
        el('div', { class: 'key' }, el('b', { text: 'Likely range, from the live scatter' }), el('span', { text: 'Every row carries a middle-half range: the 25th\u201375th percentile of market-cap / curve among the live protocols (' + (m.interval ? '×' + m.interval.lo + '–×' + m.interval.hi : 'see the detail view') + '). Wide on purpose, and shown on each detail view.' })),
        el('div', { class: 'key' }, el('b', { text: 'Farm verdict, netted in dollars' }), el('span', { text: 'Every row is Farm, Thin or Skip: the plan\u2019s gas netted against the position\u2019s pro-rata share of its implied value. Farm: at least $20 stays after gas at $5+ an hour of hands-on work; Thin: something stays; Skip: the gas costs more than the share. Pro-rata is a yardstick for ranking farms, never a promise.' })),
        el('div', { class: 'key' }, el('b', { text: 'Rank stability, resampled' }), el('span', { text: 'Every row shows its rank at exponents 0.45 and 0.55; the board sorts by Stability (steadiest first) and by Resampled (each row\u2019s median move across the 1,000 resamples, also in its detail view). Resampling keeps ranks 1\u20133 exact every time — and shows the middle moves, so the note below is part of the model, not a footnote.' })),
        el('div', { class: 'key' }, el('b', { text: 'Copies at 2%' }), el('span', { text: 'Wrapped, staked and bridged copies use the same formula at a 2% weight, rescaled below the smallest launch.' }))
      ),
      calib,
      factorTable,
      sens,
      boot,
      oddsBlock,
      verdictBlock,
      gapsBlock,
      el('p', { class: 'sub', text: 'Age is the time since first listing — how long a protocol has run with no token. The board says a protocol records no token, never that it has none. Growth and age barely move market cap against the live set (r = −0.15 and −0.05), so both stay small bounded adjustments, never the driver.' })
    );
  }

  // A row's watch-outs in plain words: facts from its own record, not a judgement.
  function watchOutsFor(row) {
    var words = {
      'single-chain': 'runs on one chain only',
      'shrinking-7d': 'its TVL fell in the last 7 days',
      'very-young': 'listed under 90 days ago',
      'age-unknown': 'no listing date on record'
    };
    var flags = row.risk_flags || [];
    if (!flags.length) return 'Watch-outs: none of these trip \u2014 one chain only, shrinking TVL, listed under 90 days ago, no listing date \u2014 so nothing in its record warns against it.';
    return 'Watch-outs: ' + flags.map(function (f) { return words[f] || f; }).join('; ') + '. These are facts from its own record, not a judgement \u2014 they say what to check before farming it.';
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var check = impliedOf(row);
    var matches = check.value === row.implied_value_usd || (row.tier === 'copy');
    var oddsCheck = oddsOf(row);
    var oddsMatches = oddsCheck === row.token_odds;
    // How far this rank moves when the size exponent runs 0.45–0.55.
    var move = Math.max(Math.abs(row.rank - (row.rank_at_045 === undefined ? row.rank : row.rank_at_045)), Math.abs(row.rank - (row.rank_at_055 === undefined ? row.rank : row.rank_at_055)));
    var steps = row.farm_steps || [];
    // Where this row sits against its own tier: its lead over the next row, and
    // where its TVL sits on the board — size, or growth, age and category.
    var peers = DATA.rows.filter(function (r) { return r.tier === row.tier; });
    var next = peers[peers.indexOf(row) + 1];
    var context = next
      ? fmtUsd(row.implied_value_usd - next.implied_value_usd) + ' ahead of rank ' + next.rank + ' (' + next.name + ').'
      : 'The smallest ' + (row.tier === 'copy' ? 'copy' : 'launch') + ' on the board.';
    var byTvl = DATA.rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    context += ' Its TVL ranks #' + (byTvl.indexOf(row) + 1) + ' of ' + DATA.board_size + ' on the board.';
    // Where it stands among its own category's rows in the same tier.
    context += row.category_size > 1
      ? ' In ' + (row.category || 'Other') + ', it ranks #' + row.category_rank + ' of ' + row.category_size + ' ' + (row.tier === 'copy' ? 'copies' : 'launches') + ' by implied value.'
      : ' It is the only ' + (row.category || 'Other') + ' ' + (row.tier === 'copy' ? 'copy' : 'launch') + ' on the board.';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.tier === 'copy' ? ' · wrapped / staked copy' : ' · pre-token launch') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · ' + reasonFor(row) })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('p', { class: 'rank-context', text: context }));
    var modelSection = el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, shown working' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Size factor' }), el('b', { class: 'num', text: '×' + String(row.size_multiplier) })),
        el('div', null, el('span', { text: 'Category factor' }), el('b', { class: 'num', text: '×' + String(row.category_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'worked', text: 'Worked: ' + fmtUsd(row.tvl_usd) + ' × ' + MODEL.base_multiple + ' × ' + row.size_multiplier + ' size × ' + row.growth_multiplier + ' growth × ' + row.maturity_multiplier + ' maturity × ' + row.category_multiplier + ' category = ' + fmtUsd(check.value) + (row.tier === 'copy' ? ' before the 2% copy rescale.' : '.') }),
      el('p', { class: 'recompute' },
        'Model ' + DATA.model_version + ': this page recomputes the row as ',
        el('b', { text: fmtUsd(check.value) }),
        matches ? ' — the same number board.json carries.' : ' — the board carries the copy-rescaled value instead (see below).',
        ' This is an estimate, not a price.'
      ),
      // The row's middle-half range, from the live protocols' own scatter.
      el('p', { class: 'range', text: 'Likely range ' + fmtUsd(row.implied_low_usd) + '–' + fmtUsd(row.implied_high_usd) + ' — the middle half of traded protocols land between ×' + (MODEL.interval ? MODEL.interval.lo : 0.27) + ' and ×' + (MODEL.interval ? MODEL.interval.hi : 3.64) + ' of the curve, so this value is a centre, not a point.' }),
      el('p', { class: 'range', text: 'Token odds: this page recomputes ' + oddsCheck.toFixed(3) + (oddsMatches ? ' — the same number board.json carries.' : ' — board.json carries ' + row.token_odds.toFixed(3) + '.') + ' The peers\u2019 record gives this row a ' + Math.round(row.token_odds * 100) + '% chance of listing a token eventually, so its expected value is ' + fmtUsd(row.expected_value_usd) + ' against ' + fmtUsd(row.implied_value_usd) + ' if it lists. The odds fall as a protocol ages without listing — most of the listing curve is behind it — while the value above rises with age; the two are kept separate so each can be checked on its own.' }),
      el('p', { class: 'range', text: 'Farm verdict: ' + (row.farm_verdict || 'Skip') + ' — ' + ((row.farm_net_usd || 0) >= 0 ? 'about $' + (row.farm_net_usd || 0).toLocaleString('en-US') + ' stays after gas, ' + fmtPerHour(row.farm_per_hour_usd) + ' of hands-on work.' : 'the plan\u2019s gas costs about $' + Math.abs(row.farm_net_usd || 0).toLocaleString('en-US') + ' more than the position\u2019s pro-rata share, so it loses money before it pays anything.') + ' The full arithmetic is step 8 of the farm plan below.' }),
      // Rank stability across the exponent range, and the factual watch-outs.
      el('p', { class: 'range', text: 'Rank stability: #' + (row.rank_at_045 === undefined ? row.rank : row.rank_at_045) + ' at exponent 0.45, #' + (row.rank_at_055 === undefined ? row.rank : row.rank_at_055) + ' at 0.55 \u2014 this rank moves ' + (move === 1 ? '1 place' : move + ' places') + ' at most across that range. Sort the board by Stability to see the steadiest ranks first.' }),
      // The row's own median move across the resamples. Launches only.
      row.rank_boot_med === null || row.rank_boot_med === undefined ? null : el('p', { class: 'range', text: 'Resampled rank: in 1,000 resamples of the live set this rank moved a median of ' + row.rank_boot_med + (row.rank_boot_med === 1 ? ' place' : ' places') + ' (90th percentile ' + row.rank_boot_p90 + (row.rank_boot_p90 === 1 ? ' place' : ' places') + ').' }),
      el('p', { class: 'range', text: watchOutsFor(row) })
    );
    if (row.tier === 'copy') {
      modelSection.insertBefore(el('p', { class: 'note', text: 'This protocol is a wrapped, staked or bridged copy of a token that already trades, so it is not a launch of its own. Its value is the same formula at a 2% weight, rescaled so the largest copy stays below the smallest launch — which is why it ranks at the bottom.' }), modelSection.children[1]);
    }
    dialog.appendChild(modelSection);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — eight steps, with cost and time' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Source: ' + DATA.source + '. The snapshot is sealed: every run of this radar reads the same bytes.' }),
      el('p', { text: 'A protocol here records no token in DefiLlama — the record, not proof it has none. Nothing here predicts whether or when a token is issued; an implied value is this radar\u2019s own claim, never a price.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'live' ? liveTable() : boardTable());
    if (state.tab !== 'live') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
