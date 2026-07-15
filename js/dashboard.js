/* =====================================================================
   App: sidebar navigation + pages, LessWrong-style editorial layout.

     Home     -> intro hero + section list
     $WW      -> token info + holder data (DexScreener + Blockscout)
     Staking  -> placeholder
     Treasury -> Gnosis Safe assets

   Content is public (no wallet needed to browse). The Connect button is
   a top-right action that opens the wallet modal.

   Styling lives in css/theme.css. Config constants are at the top.
   ===================================================================== */

(function () {
  var TOKEN_ADDRESS = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b'; // $WW token

  var SAFE_ADDRESS = '0x108eD952C1D78F3E502Ad6A07506e5651cEFF682';
  var SAFE_CHAIN   = 1;
  var SAFE_PREFIX  = 'eth';

  var DS_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
  var DS_PAIRS  = 'https://api.dexscreener.com/latest/dex/pairs/';
  var SAFE_GW   = 'https://safe-client.safe.global';
  var REFRESH_MS = 30000;

  var BLOCKSCOUT = {
    ethereum: 'https://eth.blockscout.com', base: 'https://base.blockscout.com',
    optimism: 'https://optimism.blockscout.com', arbitrum: 'https://arbitrum.blockscout.com',
    polygon: 'https://polygon.blockscout.com', gnosis: 'https://gnosis.blockscout.com'
  };
  function scoutBase() { return BLOCKSCOUT[tok.chain] || null; }

  var tok = { chain: null, pair: null };
  var tokenPair = null, holderData = null, safeData = null, activePage = 'home';
  var refreshTimer = null;

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
      + '<h1 class="hero-title">The $WW Home</h1>'
      + '<p class="hero-desc">Track the $WW token and its holders, explore staking, and follow the community treasury \u2014 all in one place.</p>'
      + '<div class="hero-by">by weiword</div>'
      + '</div>'
      + '<div class="hero-img" style="background-image:url(background.jpeg)"></div>'
      + '</div>'
      + '<div class="pl">'
      + row('ww', '$WW Token', 'Live price, market cap, liquidity, and holder distribution.')
      + row('staking', 'Staking', 'Stake $WW to earn rewards \u00b7 coming soon.')
      + row('treasury', 'Treasury', 'Assets held in the community Safe.')
      + '</div>';
  }

  function stat(k, v, cls) { return '<div class="stat"><div class="stat-k">' + k + '</div><div class="stat-v ' + (cls || '') + '">' + v + '</div></div>'; }

  function wwHtml() {
    var pair = tokenPair, hd = holderData, base = scoutBase();
    var info = (pair && pair.info) || {};
    var baseSym = (pair && pair.baseToken && pair.baseToken.symbol) || 'WW';
    var name = (pair && pair.baseToken && pair.baseToken.name) || '$WW';
    var chg = pair && pair.priceChange ? pair.priceChange.h24 : null;
    var chgClass = (chg > 0) ? 'up' : (chg < 0 ? 'down' : '');
    var tokenLink = base ? (base + '/token/' + TOKEN_ADDRESS) : ('https://dexscreener.com/' + tok.chain + '/' + (tok.pair || ''));

    var holders = hd && hd.counters ? hd.counters.token_holders_count : (hd && hd.info ? hd.info.holders_count : null);
    var transfers = hd && hd.counters ? hd.counters.transfers_count : null;
    var supplyRaw = hd && hd.info ? hd.info.total_supply : null;
    var decimals = hd && hd.info ? Number(hd.info.decimals) : 18;
    var supply = supplyRaw != null ? fmtNum(Number(supplyRaw) / Math.pow(10, decimals)) : '\u2014';

    var stats =
      stat('Price', pair ? fmtPrice(pair.priceUsd) : '\u2014')
      + stat('Market Cap', pair ? fmtUsd(pair.marketCap || pair.fdv) : '\u2014')
      + stat('Liquidity', pair ? fmtUsd(pair.liquidity ? pair.liquidity.usd : null) : '\u2014')
      + stat('Volume 24h', pair ? fmtUsd(pair.volume ? pair.volume.h24 : null) : '\u2014')
      + stat('Holders', holders != null ? fmtInt(holders) : (hd === null ? '\u2026' : '\u2014'))
      + stat('Total Supply', supply)
      + stat('Transfers', transfers != null ? fmtInt(transfers) : (hd === null ? '\u2026' : '\u2014'));

    var items = hd && hd.holders && hd.holders.items ? hd.holders.items.slice(0, 15) : [];
    var rows;
    if (items.length) {
      var total = supplyRaw ? Number(supplyRaw) : null;
      rows = items.map(function (it, i) {
        var a = it.address || it.address_hash;
        var hash = (typeof a === 'string') ? a : (a && a.hash);
        var pct = total ? (Number(it.value) / total * 100) : null;
        var addrCell = hash
          ? (base ? '<a href="' + base + '/address/' + hash + '" target="_blank" rel="noopener">' + shortAddr(hash) + '</a>' : shortAddr(hash))
          : '\u2014';
        return '<tr><td>' + (i + 1) + '</td><td>' + addrCell + '</td>'
          + '<td class="num">' + fmtAmount(it.value, decimals) + '</td>'
          + '<td class="num">' + (pct != null ? pct.toFixed(2) + '%' : '\u2014') + '</td></tr>';
      }).join('');
    } else if (hd === null) {
      rows = '<tr><td colspan="4"><span class="note" style="padding:12px 0;display:block">Loading holders\u2026</span></td></tr>';
    } else if (!base) {
      rows = '<tr><td colspan="4"><span class="note" style="padding:12px 0;display:block">Holder data isn\u2019t available for this chain.</span></td></tr>';
    } else {
      rows = '<tr><td colspan="4"><span class="note" style="padding:12px 0;display:block">No holder data.</span></td></tr>';
    }

    return '<h1 class="page-title">' + esc(name) + ' <span style="font-variant:normal;color:var(--dim);font-size:20px">(' + esc(baseSym) + ')</span>'
      + (chg !== null && chg !== undefined ? '<span class="title-chg ' + chgClass + '">' + fmtPct(chg) + '</span>' : '') + '</h1>'
      + '<div class="addr"><a href="' + tokenLink + '" target="_blank" rel="noopener">' + TOKEN_ADDRESS + ' \u2197</a></div>'
      + '<div class="stats">' + stats + '</div>'
      + '<div class="section-h">Top Holders</div>'
      + '<div class="tbl-wrap"><div class="tbl-scroll"><table class="tbl"><thead><tr>'
      + '<th>#</th><th>Address</th><th class="num">Quantity</th><th class="num">Percentage</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function stakingHtml() {
    return '<h1 class="page-title">$WW Staking</h1>'
      + '<div class="page-sub">Stake $WW to earn rewards.</div>'
      + '<div class="stats">' + stat('APR', '\u2014') + stat('Total Staked', '\u2014') + stat('Your Stake', '\u2014') + stat('Rewards', '\u2014') + '</div>'
      + '<div class="tbl-wrap"><div class="note">Staking is coming soon.</div></div>';
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
    var base = scoutBase();
    if (!base) return { info: null, counters: null, holders: null };
    function get(path) { return fetch(base + path).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    var r = await Promise.all([
      get('/api/v2/tokens/' + TOKEN_ADDRESS),
      get('/api/v2/tokens/' + TOKEN_ADDRESS + '/counters'),
      get('/api/v2/tokens/' + TOKEN_ADDRESS + '/holders')
    ]);
    return { info: r[0], counters: r[1], holders: r[2] };
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
    if (key === 'staking') { c.innerHTML = stakingHtml(); return; }

    if (key === 'ww') {
      c.innerHTML = wwHtml();
      if (!tokenPair) loadToken().then(reWW).catch(reWW);
      if (!holderData) loadHolders().then(function (d) { holderData = d; reWW(); }).catch(function () { holderData = { info: null, counters: null, holders: null }; reWW(); });
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
