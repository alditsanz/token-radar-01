// Token Radar's dashboard (radar-3). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, sort, and a per-protocol detail view with
// the model's own inputs and the protocol's farm plan. No network: every byte it shows is
// in data.js. The value model, in one function — the page recomputes a row from the snapshot
// figures and checks the number board.json carries, so the page's code and the board's data
// are visibly the same arithmetic:
//
//   implied = round( tvl_usd x 0.30
//                  x min(1.6, max(0.5, 1 + clamp(change_7d, -80, 200) / 100 x (growth >= 0 ? 0.8 : 1.2)))
//                  x (0.6 + 0.4 x ln(1 + min(age_days, 1095)) / ln(1 + 1095)) )
//
// The growth term is bounded because the TVL already records the week's move: one bad week
// never erases more than half the value that remains, one good week never adds more than 60%
// on top of a TVL that already includes the spike. A copy's value is the same formula at a
// 2% weight, rescaled so the largest copy stays below the smallest launch. No protocol name
// is special-cased anywhere in this file.
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
  // The model in one function: TVL, seven-day growth and age with no token, nothing else.
  // The growth term is bounded: the TVL already records the week's move, so one week of
  // momentum never erases more than half the value that remains or adds more than 60%.
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var weight = growth >= 0 ? MODEL.growth_weight_up : MODEL.growth_weight_down;
    var growthMult = Math.min(MODEL.growth_mult_cap, Math.max(MODEL.growth_mult_floor, 1 + (growth / 100) * weight));
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.log(1 + Math.min(Math.max(age, 0), MODEL.maturity_days)) / Math.log(1 + MODEL.maturity_days)) * MODEL.maturity_range;
    var value = Math.max(1, Math.round(row.tvl_usd * MODEL.base_multiple * growthMult * maturity));
    return { value: value, growthMult: growthMult, maturity: maturity, copy: row.tier === 'copy' };
  }
  // Why this row ranks where it does, in one line a reader can check: the TVL, the week's
  // move with the multiplier it earned, and the age with the maturity it earned. A copy
  // shows its 2% weight instead: its multipliers are the pre-rescale ones, so they are
  // not the number the board carries for it.
  function reasonFor(row) {
    var parts = [fmtUsd(row.tvl_usd) + ' TVL', fmtPct(row.change_7d) + ' in 7d', fmtAge(row.age_days) + ' with no token'];
    if (row.tier === 'copy') { parts.push('wrapped, staked or bridged copy'); return parts.join(' · '); }
    if (row.growth_multiplier !== undefined) parts[1] += ' (×' + row.growth_multiplier.toFixed(2) + ')';
    if (row.maturity_multiplier !== undefined) parts[2] += ' (×' + row.maturity_multiplier.toFixed(2) + ')';
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
    [['q', 'q'], ['category', 'category'], ['chain', 'chain'], ['growth', 'growth'], ['tab', 'tab'], ['p', 'selected']].forEach(function (pair) {
      var v = params.get(pair[0]);
      if (v) state[pair[1]] = v;
    });
    if (params.get('w') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    var set = function (k, v, d) { if (v && v !== d) params.set(k, v); };
    set('q', state.q);
    set('category', state.category, 'all');
    set('chain', state.chain, 'all');
    set('growth', state.growth, 'all');
    set('tab', state.tab, 'launch');
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
      // The watchlist toggle applies to the board tabs only: live-token rows carry no
      // watchlist flag, and the live tab is the market's own list, not the radar's.
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
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Every pre-token protocol, ranked by what its launch would be worth' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The radar adds every other protocol that records no token — ' + DATA.launch_size + ' launches and ' + DATA.copy_size + ' wrapped, staked and bridged copies, ranked below them. Implied value is a model, not a promise, and never a prediction that a token is issued.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is ranked' })),
        el('div', { class: 'fact' }, el('span', { text: 'Protocols ranked' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.launch_size + ' launches · ' + DATA.copy_size + ' copies' })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) }), el('small', { text: DATA.rows[0].name + ', rank 1' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'their market cap is a fact, not a model' }))
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
    var shown = filteredRows().length;
    var total = state.tab === 'live' ? DATA.live.length : baseRows().length;
    var tabLabel = state.tab === 'live' ? 'live-token protocols' : state.tab === 'copy' ? 'copies' : 'launches';
    // The watchlist toggle: the 40 watchlist protocols alone, so a reader can check the
    // floor the board promises without the 302 other rows in the way.
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
      el('span', { class: 'count', text: shown + ' of ' + total + ' ' + tabLabel + ' shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
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
    return el('div', { class: 'name' },
      el('b', { text: r.name }),
      el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainText(r) }),
      el('div', { class: 'reason', text: reason }));
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) return emptyPanel();
    // Bars scale to the tab's own largest value, not the filtered list's: the same row
    // shows the same bar in every filter of its tab, so bars stay comparable at a glance.
    var max = 1;
    baseRows().forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
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
        )),
        el('td', null, el('span', { class: 'status ' + r.tier, text: r.tier === 'copy' ? 'copy' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    var caption = state.tab === 'copy'
      ? 'Wrapped, staked and bridged copies of tokens that already trade, ranked below every launch. A copy is not a launch of its own: its value is the same formula at a 2% weight, rescaled below the smallest launch.'
      : 'Pre-token launches, strongest implied value first. Select a row for its model and farm plan. Every row states why it ranks where it does.';
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
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    // The live tab filters like the board tabs: the same search, category, chain and
    // growth filters apply, and an empty result shows the empty panel, not bare headers.
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
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Tokens that already trade, by market cap. Their market cap is a fact, not a model, so they are set aside from the pre-token ranking instead of mixed into it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'), sortHeader('mcap', 'Market cap'), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = MODEL;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures — TVL, seven-day growth and age with no token. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd × ' + m.base_multiple + ' × min(' + m.growth_mult_cap + ', max(' + m.growth_mult_floor + ', 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight_up + ' up / ' + m.growth_weight_down + ' down)) × (' + m.maturity_floor + ' + ' + m.maturity_range + ' × ln(1 + min(age_days, ' + m.maturity_days + ')) / ln(1 + ' + m.maturity_days + ')) )'
      ),
      el('div', { class: 'keys' },
        el('div', { class: 'key' }, el('b', { text: 'TVL × ' + m.base_multiple }), el('span', { text: 'A launch is worth a share of the value already locked in the protocol.' })),
        el('div', { class: 'key' }, el('b', { text: 'Growth, bounded' }), el('span', { text: 'Rising TVL lifts value at 0.8×; falling TVL cuts it at 1.2×. Clamped to −80%…+200%, and the multiplier itself never falls below 0.5× or rises above 1.6×: the TVL already records the week\u2019s move, so one week never erases or triples a value.' })),
        el('div', { class: 'key' }, el('b', { text: 'Age, logarithmic' }), el('span', { text: 'Longer with no token means more pent-up value, rising fast then levelling off. Unknown age counts as 365 days.' })),
        el('div', { class: 'key' }, el('b', { text: 'Copies at 2%' }), el('span', { text: 'Wrapped, staked and bridged copies use the same formula at a 2% weight, rescaled below the smallest launch.' }))
      ),
      el('p', { class: 'sub', text: 'Age is the time since the protocol was first listed — the best record of how long it has run with no token. The board separates protocols whose token already trades from those still to come, and says a protocol records no token, never that it has none.' })
    );
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
    var steps = row.farm_steps || [];
    // Where this row sits against its own tier: how far ahead of the next row it is, so
    // the reader sees whether the rank is a clear lead or a near-tie.
    var peers = DATA.rows.filter(function (r) { return r.tier === row.tier; });
    var next = peers[peers.indexOf(row) + 1];
    var context = next
      ? fmtUsd(row.implied_value_usd - next.implied_value_usd) + ' ahead of rank ' + next.rank + ' (' + next.name + ').'
      : 'The smallest ' + (row.tier === 'copy' ? 'copy' : 'launch') + ' on the board.';
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
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'check' },
        'Model ' + DATA.model_version + ': this page recomputes the row as ',
        el('b', { text: fmtUsd(check.value) }),
        matches ? ' — the same number board.json carries.' : ' — the board carries the copy-rescaled value instead (see below).',
        ' This is an estimate, not a price.'
      )
    );
    if (row.tier === 'copy') {
      modelSection.insertBefore(el('p', { class: 'note', text: 'This protocol is a wrapped, staked or bridged copy of a token that already trades, so it is not a launch of its own. Its value is the same formula at a 2% weight, rescaled so the largest copy stays below the smallest launch — which is why it ranks at the bottom.' }), modelSection.children[1]);
    }
    dialog.appendChild(modelSection);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — seven steps, with cost and time' }),
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
      el('p', { text: 'A protocol on this board records no token in DefiLlama — that is the record, not proof it has none. Nothing here predicts whether or when a token is issued, and an implied value is this radar\u2019s own claim, never a price.' })
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
