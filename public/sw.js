// 서비스워커: 홈 화면 앱으로 설치되게 하고, 화면 파일을 미리 저장해 빨리 열리게 한다.
// /api, /auth 요청은 저장하지 않는다. (녹음 조각은 화면 쪽에서 IndexedDB 에 따로 보관)
// 인터넷이 없을 때도 앱 화면이 열려야 녹음을 할 수 있으므로 화면 파일은 꼭 보관한다.
const VERSION = 'vn-shell-v14';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/i18n.js', '/recorder.js', '/offline.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/favicon-32.png', '/icons/apple-touch-icon.png',
  '/jina/portrait.png', '/jina/point.png', '/jina/think.png', '/jina/wave.png'];

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
