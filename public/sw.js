// 서비스워커: 홈 화면 앱으로 설치되게 하고, 화면 파일을 미리 저장해 빨리 열리게 한다.
// /api, /auth 요청과 녹음 데이터는 절대 저장하지 않는다.
const VERSION = 'vn-shell-v5';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/i18n.js', '/recorder.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // 먼저 서버에서 새로 받고, 인터넷이 안 되면 저장해 둔 것을 쓴다.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && SHELL.includes(url.pathname)) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
  );
});
