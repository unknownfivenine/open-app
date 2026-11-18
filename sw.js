const CACHE = 'open-browser-v11';
const FILES = ['./','./index.html','./style.css','./app.js','./audio.js','./music.js','./transport.js','./compose.js','./intention.js','./route.js','./instruments.js','./sampler.js','./samples/manifest.json','./manifest.webmanifest','./icon.svg'];
// The app shell must cache for install to succeed; recordings are cached afterwards, best effort.
async function recordings(cache) {
  const manifest = await (await fetch('./samples/manifest.json')).json(), urls = [];
  for (const [name, instrument] of Object.entries(manifest.instruments)) for (const note of instrument.notes) urls.push(`./samples/${name}/${note}.mp3`);
  await cache.addAll(urls.map(url => new Request(url, {cache:'reload'})));
}
// A new version takes over as soon as it has cached the app, so an open tab never keeps running old files.
self.addEventListener('install',event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(url => new Request(url, {cache:'reload'}))).then(() => recordings(cache).catch(() => {}))).then(() => self.skipWaiting())); });
// Only OPEN caches are owned here; never touch Lull or other apps' caches.
self.addEventListener('activate',event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('open-browser-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch',event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./',self.location).pathname)) return;
  // Page loads match the cached page whatever follows '?' in the address.
  const options = event.request.mode === 'navigate' ? {ignoreSearch:true} : undefined;
  event.respondWith(caches.match(event.request, options).then(cached => cached || fetch(event.request)));
});
