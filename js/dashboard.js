/* =====================================================================
   App: sidebar navigation + pages, LessWrong-style editorial layout.

     Home     -> intro hero + section list
     $WWW      -> token info + holder data (DexScreener + Blockscout)
     Security -> placeholder
     Treasury -> Gnosis Safe assets

   Content is public (no wallet needed to browse). The Connect button is
   a top-right action that opens the wallet modal.

   Styling lives in css/theme.css. Config constants are at the top.
   ===================================================================== */

(function () {
  var TOKEN_ADDRESS = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b'; // $WWW token

  var SAFE_ADDRESS = '0x108eD952C1D78F3E502Ad6A07506e5651cEFF682';
  var SAFE_CHAIN   = 1;
  var SAFE_PREFIX  = 'eth';

  var DS_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
  var DS_PAIRS  = 'https://api.dexscreener.com/latest/dex/pairs/';
  var SAFE_GW   = 'https://safe-client.safe.global';
  var REFRESH_MS = 30000;

  // Holder data via GeckoTerminal free API (keyless, CORS-friendly)
  var GT_API = 'https://api.geckoterminal.com/api/v2/networks/';
  var GT_NET = { ethereum: 'eth', base: 'base', bsc: 'bsc', polygon: 'polygon_pos', arbitrum: 'arbitrum', optimism: 'optimism', avalanche: 'avax' };
  function gtNet() { return GT_NET[tok.chain] || tok.chain; }
  var EXPLORER = { base: 'https://basescan.org', ethereum: 'https://etherscan.io', arbitrum: 'https://arbiscan.io', optimism: 'https://optimistic.etherscan.io', polygon: 'https://polygonscan.com', bsc: 'https://bscscan.com' };

  var tok = { chain: null, pair: null };
  var tokenPair = null, holderData = null, safeData = null, activePage = 'home';
  var refreshTimer = null, holdersError = null;

  // ---- formatting -------------------------------------------------------
  function fmtPrice(p) {
    var v = Number(p);
    if (!isFinite(v) || v === 0) return '$0';
    if (v >= 1)    return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (v >= 0.01) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 6 });
    return '$' + v.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  function fmtUsd(n) { var v = Number(n); if (!isFinite(v) || v === 0) return '\u2014'; return '$' + v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 }); }
  function fmtNum(n) { var v = Number(n); if (!isFinite(v)) return '\u2014'; return v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 }); }
  function fmtInt(n) { var v = Number(n); if (!isFinite(v)) return '\u2014'; return v.toLocaleString(); }
  function fmtPct(n) { if (n === undefined || n === null || isNaN(n)) return ''; return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }
  function fmtAmount(raw, decimals) {
    var val = Number(raw) / Math.pow(10, Number(decimals || 0));
    if (!isFinite(val) || val === 0) return '0';
    if (val >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (val >= 1)    return val.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return val.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  function shortAddr(a) { return a ? a.slice(0, 6) + '\u2026' + a.slice(-4) : ''; }
  function enc(x) { return encodeURIComponent(x); }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  function content() { return document.getElementById('pageContent'); }

  // ===================================================================
  //  PAGE BUILDERS
  // ===================================================================
  function homeHtml() {
    function row(p, title, desc) {
      return '<a class="pl-row" data-p="' + p + '" href="javascript:void(0)">'
        + '<div class="pl-body"><div class="pl-title">' + title + '</div><div class="pl-desc">' + desc + '</div></div>'
        + '<div class="pl-go">\u2192</div></a>';
    }
    return '<div class="hero">'
      + '<div class="hero-text">'
      + '<div class="hero-kicker">weiword community</div>'
      + '<h1 class="hero-title">The $WWW Home</h1>'
      + '<p class="hero-desc">Track the $WWW token and its holders, explore security, and follow the community treasury \u2014 all in one place.</p>'
      + '<div class="hero-by">by weiword</div>'
      + '</div>'
      + '<div class="hero-img" style="background-image:url(background.jpeg)"></div>'
      + '</div>'
      + '<div class="pl">'
      + row('ww', '$WWW Token', 'Live price, market cap, liquidity, and holder distribution.')
      + row('security', 'Security', 'How the project and treasury are protected.')
      + row('treasury', 'Treasury', 'Assets held in the community Safe.')
      + '</div>';
  }

  function stat(k, v, cls) { return '<div class="stat"><div class="stat-k">' + k + '</div><div class="stat-v ' + (cls || '') + '">' + v + '</div></div>'; }

  function wwHtml() {
    var pair = tokenPair, hd = holderData;
    var info = (pair && pair.info) || {};
    var baseSym = (pair && pair.baseToken && pair.baseToken.symbol) || 'WWW';
    var name = (pair && pair.baseToken && pair.baseToken.name) || '$WWW';
    var chg = pair && pair.priceChange ? pair.priceChange.h24 : null;
    var chgClass = (chg > 0) ? 'up' : (chg < 0 ? 'down' : '');
    var exp = EXPLORER[tok.chain];
    var tokenLink = exp ? (exp + '/token/' + TOKEN_ADDRESS) : ('https://dexscreener.com/' + tok.chain + '/' + (tok.pair || ''));

    var gInfo = hd && hd.info && hd.info.data && hd.info.data.attributes;
    var gTok = hd && hd.token && hd.token.data && hd.token.data.attributes;
    var holdersObj = gInfo && gInfo.holders;
    var holders = holdersObj ? holdersObj.count : null;
    var dist = holdersObj ? holdersObj.distribution_percentage : null;
    var supply = gTok ? (gTok.normalized_total_supply != null ? Number(gTok.normalized_total_supply)
      : (gTok.total_supply != null && gTok.decimals != null ? Number(gTok.total_supply) / Math.pow(10, Number(gTok.decimals)) : null)) : null;
    var supplyStr = supply != null ? fmtNum(supply) : (hd === null ? '\u2026' : '\u2014');

    var priceStr = pair ? fmtPrice(pair.priceUsd) : '\u2014';
    var mcapStr = pair ? fmtUsd(pair.marketCap || pair.fdv) : '\u2014';
    var liqStr = pair ? fmtUsd(pair.liquidity ? pair.liquidity.usd : null) : '\u2014';
    var volStr = pair ? fmtUsd(pair.volume ? pair.volume.h24 : null) : '\u2014';
    var holdersStr = holders != null ? fmtInt(holders) : (hd === null ? '\u2026' : '\u2014');

    function srow(k, v) { return '<div class="srow"><span class="sk">' + k + '</span><span class="sv">' + v + '</span></div>'; }
    var statList =
      '<div class="mcap"><span class="mcap-k">Market Cap</span><span class="mcap-v">' + mcapStr + '</span></div>'
      + '<div class="statlist">'
      + srow('Price', priceStr)
      + srow('Liquidity', liqStr)
      + srow('Volume 24h', volStr)
      + srow('Holders', holdersStr)
      + srow('Total Supply', supplyStr)
      + '</div>';

    return '<div class="ww-head">'
      + '<h1 class="page-title">' + esc(name) + ' <span style="font-variant:normal;color:var(--dim);font-size:20px">(' + esc(baseSym) + ')</span>'
      + (chg !== null && chg !== undefined ? '<span class="title-chg ' + chgClass + '">' + fmtPct(chg) + '</span>' : '') + '</h1>'
      + '<a class="buy-btn" href="https://app.uniswap.org/swap?chain='
      + encodeURIComponent(tok.chain || 'base') + '&inputCurrency=NATIVE&outputCurrency=' + TOKEN_ADDRESS
      + '" target="_blank" rel="noopener noreferrer">Buy \u2197</a>'
      + '</div>'
      + '<div class="addr"><a href="' + tokenLink + '" target="_blank" rel="noopener">' + TOKEN_ADDRESS + ' \u2197</a></div>'
      + '<div class="ww-panel">' + statList + '</div>';
  }

  function securityHtml() {
    return '<h1 class="page-title">Security</h1>'
      + '<div class="page-sub">How $WWW is kept safe.</div>'
      + '<div class="tbl-wrap"><div class="note">Security details coming soon.</div></div>';
  }

  function treasuryHtml(data) {
    var items = (data && data.items) ? data.items.slice() : [];
    items.sort(function (a, b) { return Number(b.fiatBalance || 0) - Number(a.fiatBalance || 0); });
    var link = 'https://app.safe.global/home?safe=' + SAFE_PREFIX + ':' + SAFE_ADDRESS;
    var rows = items.map(function (it) {
      var t = it.tokenInfo || {}, sym = t.symbol || '???';
      var icon = t.logoUri ? '<img class="ico" src="' + esc(t.logoUri) + '" alt="" onerror="this.style.display=\'none\'">' : '';
      return '<tr><td>' + icon + esc(sym) + '</td><td class="num">' + fmtAmount(it.balance, t.decimals) + '</td><td class="num">' + fmtUsd(it.fiatBalance) + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="3"><span class="note" style="padding:12px 0;display:block">No assets in this Safe.</span></td></tr>';

    return '<h1 class="page-title">Treasury</h1>'
      + '<div class="addr"><a href="' + link + '" target="_blank" rel="noopener">' + SAFE_ADDRESS + ' \u2197</a></div>'
      + '<div class="stats">' + stat('Total Value', fmtUsd(data ? data.fiatTotal : 0)) + stat('Assets', fmtInt(items.length)) + '</div>'
      + '<div class="section-h">Assets</div>'
      + '<div class="tbl-wrap"><div class="tbl-scroll"><table class="tbl"><thead><tr>'
      + '<th>Asset</th><th class="num">Balance</th><th class="num">Value</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
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
      tok.chain = p.chainId; tok.pair = p.pairAddress; tokenPair = p; return p;
    }
    var res = await fetch(DS_PAIRS + enc(tok.chain) + '/' + enc(tok.pair));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var d = await res.json();
    tokenPair = (d && d.pairs && d.pairs[0]) || (d && d.pair) || tokenPair;
    return tokenPair;
  }
  async function loadHolders() {
    holdersError = null;
    var net = gtNet();
    function get(path) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 10000);
      return fetch(GT_API + net + path, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
        .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function (e) {
          clearTimeout(timer);
          holdersError = (e && e.name === 'AbortError') ? 'timed out' : (e.message || String(e));
          console.warn('[holders] ' + GT_API + net + path + ' failed:', e);
          return null;
        });
    }
    var r = await Promise.all([
      get('/tokens/' + TOKEN_ADDRESS),
      get('/tokens/' + TOKEN_ADDRESS + '/info')
    ]);
    return { token: r[0], info: r[1] };
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
  function renderPage(key) {
    var c = content(); if (!c) return;
    if (key === 'home') { c.innerHTML = homeHtml(); return; }
    if (key === 'security') { c.innerHTML = securityHtml(); return; }

    if (key === 'ww') {
      c.innerHTML = wwHtml();
      ensureWwData();
      return;
    }
    if (key === 'treasury') {
      if (safeData) { c.innerHTML = treasuryHtml(safeData); return; }
      c.innerHTML = '<h1 class="page-title">Treasury</h1><div class="note">Loading treasury\u2026</div>';
      loadSafe().then(function () { if (activePage === 'treasury' && content()) content().innerHTML = treasuryHtml(safeData); })
        .catch(function () { if (activePage === 'treasury' && content()) content().innerHTML = '<h1 class="page-title">Treasury</h1><div class="note">Could not load treasury.</div>'; });
      return;
    }
  }
  function reWW() { if (activePage === 'ww' && content()) content().innerHTML = wwHtml(); }

  async function ensureWwData() {
    try { if (!tokenPair) { await loadToken(); reWW(); } }
    catch (e) { reWW(); }
    try { if (!holderData) { holderData = await loadHolders(); reWW(); } }
    catch (e) { holderData = { info: null, counters: null, holders: null }; reWW(); }
  }

  function setActive(key) {
    var links = document.querySelectorAll('.side-item[data-p]');
    for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].getAttribute('data-p') === key);
  }
  function showPage(key) {
    activePage = key;
    setActive(key);
    renderPage(key);
    window.scrollTo(0, 0);
  }

  // ---- navigation wiring ------------------------------------------------
  function closeSidebar() {
    var s = document.getElementById('sidebar'); if (s) s.classList.remove('open');
    var sc = document.getElementById('scrim'); if (sc) sc.classList.remove('show');
  }
  document.addEventListener('click', function (e) {
    if (!document.body.classList.contains('connected')) return; // nav only after connect
    var t = e.target.closest ? e.target.closest('[data-p]') : null;
    if (t) { showPage(t.getAttribute('data-p')); closeSidebar(); }
  });
  var burger = document.getElementById('hamburger');
  if (burger) burger.addEventListener('click', function () {
    var s = document.getElementById('sidebar'); var sc = document.getElementById('scrim');
    if (s) s.classList.toggle('open');
    if (sc) sc.classList.toggle('show', s && s.classList.contains('open'));
  });
  var scrim = document.getElementById('scrim');
  if (scrim) scrim.addEventListener('click', closeSidebar);

  // ---- show/hide app on connect / disconnect ----------------------------
  window.addEventListener('wallet:connected', function () {
    document.body.classList.add('connected');
    showPage(activePage || 'home');
    if (!refreshTimer) refreshTimer = setInterval(function () {
      if (activePage === 'ww') loadToken().then(reWW).catch(function () {});
    }, REFRESH_MS);
  });
  window.addEventListener('wallet:disconnected', function () {
    document.body.classList.remove('connected');
    closeSidebar();
    var c = content(); if (c) c.innerHTML = '';
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  });
})();
