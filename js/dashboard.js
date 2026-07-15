/* =====================================================================
   App: header navigation + pages (shown after a wallet connects).

   Nav links appear next to the logo on connect:
     $ww      -> token info (price / market cap / liquidity / volume)
     Staking  -> staking page (placeholder for now)
     Treasury -> Gnosis Safe assets

   Each link swaps the panel content; the background stays the same.
   On mobile the nav collapses into a hamburger menu.

   Styling lives in css/theme.css. Config constants are at the top.
   ===================================================================== */

(function () {
  // ---- config -----------------------------------------------------------
  var TOKEN_ADDRESS = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b'; // $ww token

  var SAFE_ADDRESS = '0x108eD952C1D78F3E502Ad6A07506e5651cEFF682';
  var SAFE_CHAIN   = 1;      // 1 = Ethereum mainnet
  var SAFE_PREFIX  = 'eth';

  var DS_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
  var DS_PAIRS  = 'https://api.dexscreener.com/latest/dex/pairs/';
  var SAFE_GW   = 'https://safe-client.safe.global';
  var REFRESH_MS = 30000;

  var PAGES = [
    { k: 'ww',       label: '$ww' },
    { k: 'staking',  label: 'Staking' },
    { k: 'treasury', label: 'Treasury' }
  ];

  // ---- state ------------------------------------------------------------
  var tok = { chain: null, pair: null };
  var tokenPair = null, safeData = null, activePage = 'ww';
  var refreshTimer = null;

  // ---- formatting -------------------------------------------------------
  function fmtPrice(p) {
    var v = Number(p);
    if (!isFinite(v) || v === 0) return '$0';
    if (v >= 1)    return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (v >= 0.01) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 6 });
    return '$' + v.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  function fmtCompact(n) {
    var v = Number(n);
    if (!isFinite(v) || v === 0) return '\u2014';
    return '$' + v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    if (n === undefined || n === null || isNaN(n)) return '';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function fmtAmount(raw, decimals) {
    var val = Number(raw) / Math.pow(10, Number(decimals || 0));
    if (!isFinite(val) || val === 0) return '0';
    if (val >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (val >= 1)    return val.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return val.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  function shortAddr(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }
  function enc(x) { return encodeURIComponent(x); }

  // ---- panel ------------------------------------------------------------
  function ensurePanel() {
    var el = document.getElementById('dashPanel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dashPanel';
    el.className = 'panel';
    el.innerHTML = '<div class="dash-scroll" id="pageContent"></div>';
    document.body.appendChild(el);
    return el;
  }
  function show(el) { el.classList.add('open'); }
  function hide(el) { el.classList.remove('open'); }

  // ===================================================================
  //  PAGE CONTENT BUILDERS
  // ===================================================================
  function wwHtml(pair) {
    var info = pair.info || {};
    var baseSym = (pair.baseToken && pair.baseToken.symbol) || '?';
    var quoteSym = (pair.quoteToken && pair.quoteToken.symbol) || '';
    var name = (pair.baseToken && pair.baseToken.name) || baseSym;
    var chg = pair.priceChange ? pair.priceChange.h24 : null;
    var chgClass = (chg > 0) ? 'up' : (chg < 0 ? 'down' : '');
    var logoHtml = info.imageUrl
      ? '<img class="tp-logo" src="' + info.imageUrl + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      : '<span class="tp-logo"></span>';
    return '<div class="p-head">' + logoHtml
      + '<div><div class="tp-name">' + name + '</div>'
      + '<div class="tp-sub">' + baseSym + (quoteSym ? ' / ' + quoteSym : '') + ' \u00b7 ' + tok.chain + '</div></div></div>'
      + '<div class="tp-price-row"><span class="tp-price">' + fmtPrice(pair.priceUsd) + '</span>'
      + (chg !== null && chg !== undefined ? '<span class="tp-chg ' + chgClass + '">' + fmtPct(chg) + ' (24h)</span>' : '')
      + '</div>'
      + '<div class="tp-stats">'
      + '<div class="tp-cell"><div class="k">Market Cap</div><div class="v">' + fmtCompact(pair.marketCap || pair.fdv) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Liquidity</div><div class="v">' + fmtCompact(pair.liquidity ? pair.liquidity.usd : null) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Vol 24h</div><div class="v">' + fmtCompact(pair.volume ? pair.volume.h24 : null) + '</div></div>'
      + '</div>';
  }

  function stakingHtml() {
    return '<div class="p-head"><span class="p-title">$ww Staking</span></div>'
      + '<div class="tp-stats">'
      + '<div class="tp-cell"><div class="k">APR</div><div class="v">\u2014</div></div>'
      + '<div class="tp-cell"><div class="k">Total Staked</div><div class="v">\u2014</div></div>'
      + '<div class="tp-cell"><div class="k">Your Stake</div><div class="v">\u2014</div></div>'
      + '</div>'
      + '<div class="p-msg">Staking is coming soon.</div>';
  }

  function treasuryHtml(data) {
    var items = (data && data.items) ? data.items.slice() : [];
    items.sort(function (a, b) { return Number(b.fiatBalance || 0) - Number(a.fiatBalance || 0); });
    var link = 'https://app.safe.global/home?safe=' + SAFE_PREFIX + ':' + SAFE_ADDRESS;
    var rows = items.map(function (it) {
      var t = it.tokenInfo || {}, sym = t.symbol || '???';
      var icon = t.logoUri
        ? '<img class="sp-ico" src="' + t.logoUri + '" alt="" onerror="this.style.visibility=\'hidden\'">'
        : '<span class="sp-ico"></span>';
      return '<div class="sp-row">' + icon
        + '<div class="sp-meta"><div class="sp-sym">' + sym + '</div>'
        + '<div class="sp-amt">' + fmtAmount(it.balance, t.decimals) + ' ' + sym + '</div></div>'
        + '<div class="sp-val">' + fmtCompact(it.fiatBalance) + '</div></div>';
    }).join('');
    if (!rows) rows = '<div class="p-msg">No assets in this Safe.</div>';
    return '<div class="p-head"><span class="p-title">Treasury</span></div>'
      + '<div class="sp-addr"><a href="' + link + '" target="_blank" rel="noopener">' + shortAddr(SAFE_ADDRESS) + ' \u2197</a></div>'
      + '<div class="sp-total">' + fmtCompact(data ? data.fiatTotal : 0) + '</div>'
      + '<div class="sp-list">' + rows + '</div>'
      + '<div class="p-foot">' + items.length + ' asset' + (items.length === 1 ? '' : 's') + ' \u00b7 via Safe</div>';
  }

  // ===================================================================
  //  DATA
  // ===================================================================
  async function resolvePair() {
    var res = await fetch(DS_TOKENS + enc(TOKEN_ADDRESS));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var pairs = (data && data.pairs) || [];
    if (!pairs.length) return null;
    var t = TOKEN_ADDRESS.toLowerCase();
    var pref = pairs.filter(function (p) { return p.baseToken && p.baseToken.address && p.baseToken.address.toLowerCase() === t; });
    return (pref.length ? pref : pairs).sort(function (a, b) {
      return Number((b.liquidity && b.liquidity.usd) || 0) - Number((a.liquidity && a.liquidity.usd) || 0);
    })[0];
  }

  async function loadToken() {
    if (!tok.pair) {
      var p = await resolvePair();
      if (!p) throw new Error('no pool');
      tok.chain = p.chainId; tok.pair = p.pairAddress; tokenPair = p;
      return p;
    }
    var res = await fetch(DS_PAIRS + enc(tok.chain) + '/' + enc(tok.pair));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var d = await res.json();
    tokenPair = (d && d.pairs && d.pairs[0]) || (d && d.pair) || tokenPair;
    return tokenPair;
  }

  async function loadSafe() {
    var url = SAFE_GW + '/v1/chains/' + SAFE_CHAIN + '/safes/' + SAFE_ADDRESS + '/balances/USD?trusted=true&exclude_spam=true';
    var res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    safeData = await res.json();
    return safeData;
  }

  // ===================================================================
  //  ROUTER
  // ===================================================================
  function content() { return document.getElementById('pageContent'); }

  function renderPage(key) {
    var c = content(); if (!c) return;
    if (key === 'staking') { c.innerHTML = stakingHtml(); return; }

    if (key === 'ww') {
      if (tokenPair) { c.innerHTML = wwHtml(tokenPair); return; }
      c.innerHTML = '<div class="p-msg">Loading token\u2026</div>';
      loadToken().then(function () { if (activePage === 'ww' && content()) content().innerHTML = wwHtml(tokenPair); })
        .catch(function () { if (activePage === 'ww' && content()) content().innerHTML = '<div class="p-msg">Could not load token data.</div>'; });
      return;
    }

    if (key === 'treasury') {
      if (safeData) { c.innerHTML = treasuryHtml(safeData); return; }
      c.innerHTML = '<div class="p-msg">Loading treasury\u2026</div>';
      loadSafe().then(function () { if (activePage === 'treasury' && content()) content().innerHTML = treasuryHtml(safeData); })
        .catch(function () { if (activePage === 'treasury' && content()) content().innerHTML = '<div class="p-msg">Could not load treasury.</div>'; });
      return;
    }
  }

  function setActive(key) {
    ['nav', 'mobileNav'].forEach(function (id) {
      var box = document.getElementById(id); if (!box) return;
      var links = box.querySelectorAll('a[data-p]');
      for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].getAttribute('data-p') === key);
    });
  }

  function showPage(key) {
    activePage = key;
    show(ensurePanel());
    setActive(key);
    renderPage(key);
  }

  function navHtml() {
    return PAGES.map(function (p) {
      return '<a data-p="' + p.k + '" href="javascript:void(0)">' + p.label + '</a>';
    }).join('');
  }
  function buildNav() {
    var nav = document.getElementById('nav'); if (nav) nav.innerHTML = navHtml();
    var mnav = document.getElementById('mobileNav'); if (mnav) mnav.innerHTML = navHtml();
    setActive(activePage);
  }
  function clearNav() {
    var nav = document.getElementById('nav'); if (nav) nav.innerHTML = '';
    var mnav = document.getElementById('mobileNav'); if (mnav) { mnav.innerHTML = ''; mnav.classList.remove('open'); }
  }
  function closeMobileMenu() {
    var m = document.getElementById('mobileNav'); if (m) m.classList.remove('open');
  }

  // ---- static wiring (elements exist at load) ---------------------------
  function bindNav(box) {
    if (!box || box._bound) return;
    box._bound = true;
    box.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[data-p]') : null;
      if (!a) return;
      showPage(a.getAttribute('data-p'));
      closeMobileMenu();
    });
  }
  bindNav(document.getElementById('nav'));
  bindNav(document.getElementById('mobileNav'));
  var burger = document.getElementById('hamburger');
  if (burger) burger.addEventListener('click', function () {
    var m = document.getElementById('mobileNav'); if (m) m.classList.toggle('open');
  });

  // ===================================================================
  //  WALLET EVENTS
  // ===================================================================
  window.addEventListener('wallet:connected', function () {
    document.body.classList.add('connected');
    buildNav();
    showPage(activePage || 'ww');
    if (!refreshTimer) refreshTimer = setInterval(function () {
      if (activePage === 'ww') loadToken().then(function () {
        if (activePage === 'ww' && content()) content().innerHTML = wwHtml(tokenPair);
      }).catch(function () {});
    }, REFRESH_MS);
  });

  window.addEventListener('wallet:disconnected', function () {
    document.body.classList.remove('connected');
    clearNav();
    var el = document.getElementById('dashPanel'); if (el) hide(el);
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  });
})();
