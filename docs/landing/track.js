// Аналітика лендингу: власний лічильник, без cookies і без сторонніх сервісів.
// Події: view (відкриття), click (кнопки з data-track), section (який блок побачили),
// scroll (глибина 25/50/75/100 %), leave (скільки секунд на сторінці).
// Жодних персональних даних: лише випадковий id візиту на час вкладки.
(function () {
  var ENDPOINT = window.TRACK_ENDPOINT || '/api/track';
  // Події приймає лише наш сервер (landing/server.mjs). На статичному хостингу (GitHub Pages, Cloudflare Pages)
  // його немає, тож там лічильник вимкнений, доки не задано window.TRACK_ENDPOINT.
  if (!window.TRACK_ENDPOINT && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  var sid;
  try {
    sid = sessionStorage.getItem('pg_sid');
    if (!sid) { sid = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('pg_sid', sid); }
  } catch (e) { sid = Math.random().toString(36).slice(2, 12); }

  var q = new URLSearchParams(location.search);
  var base = {
    sid: sid,
    dev: window.innerWidth < 760 ? 'mobile' : 'desktop',
    src: q.get('utm_source') || '',
    cmp: q.get('utm_campaign') || '',
    ref: document.referrer ? (function () { try { return new URL(document.referrer).hostname; } catch (e) { return ''; } })() : ''
  };

  function send(type, name) {
    var body = JSON.stringify(Object.assign({ t: type, n: name || '' }, base));
    if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
    else fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true }).catch(function () {});
  }

  send('view');

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-track]');
    if (el) send('click', el.getAttribute('data-track'));
  });

  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        var n = en.target.getAttribute('data-sec');
        if (en.isIntersecting && !seen[n]) { seen[n] = 1; send('section', n); io.unobserve(en.target); }
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('[data-sec]').forEach(function (s) { io.observe(s); });
  }

  var marks = [25, 50, 75, 100], hit = {};
  window.addEventListener('scroll', function () {
    var h = document.documentElement.scrollHeight - innerHeight;
    var p = h > 0 ? (scrollY / h) * 100 : 100;
    marks.forEach(function (m) { if (p >= m - 1 && !hit[m]) { hit[m] = 1; send('scroll', String(m)); } });
  }, { passive: true });

  var t0 = Date.now(), left = false;
  function leave() { if (left) return; left = true; send('leave', String(Math.round((Date.now() - t0) / 1000))); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leave(); });
  window.addEventListener('pagehide', leave);
})();
