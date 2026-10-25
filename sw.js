/* 설치형 웹앱: 화면 파일을 휴대폰에 보관해 인터넷이 끊겨도 열리게 한다.
   AI 서버 요청은 보관하지 않는다. 파일을 고치면 VERSION 숫자를 올린다. */
const VERSION = 'pcs-v1';
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/data.js', './js/personas.js', './js/storage.js', './js/speech.js', './js/ai.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* 같은 주소의 파일만: 인터넷이 되면 새 파일, 안 되면 보관한 파일 */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
