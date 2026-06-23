'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Router, createServer } = require('./lib/http');
const auth = require('./routes/auth');
const profile = require('./routes/profile');
const orders = require('./routes/orders');
const catalog = require('./routes/catalog');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..');

const router = new Router();

// --- API ---
router.get('/api/health', (ctx) => ctx.ok({ ok: true, ts: Date.now() }));

// Аутентификация
router.post('/api/auth/register', auth.register);
router.post('/api/auth/login', auth.login);
router.post('/api/auth/forgot', auth.forgot);

// Профиль / лояльность / история (требуют токен)
router.get('/api/me', profile.me);
router.patch('/api/me', profile.updateProfile);
router.post('/api/me/password', profile.changePassword);

// Заказы
router.post('/api/orders', orders.createOrder);

// Каталог / популярность
router.post('/api/products/:id/view', catalog.view);
router.get('/api/products/popular', catalog.popular);

// --- Статика: сайт (/), приложение (/app), данные каталога (/data) ---
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // маршрутизация статических корней
  let filePath;
  if (pathname === '/' || pathname === '/index.html') filePath = path.join(ROOT, 'site', 'index.html');
  else if (pathname === '/app' || pathname === '/app/') filePath = path.join(ROOT, 'app', 'index.html');
  else if (pathname.startsWith('/app/')) filePath = path.join(ROOT, 'app', pathname.slice(5));
  else if (pathname.startsWith('/data/')) filePath = path.join(ROOT, 'site', 'data', pathname.slice(6));
  else filePath = path.join(ROOT, 'site', pathname.replace(/^\//, ''));

  // защита от выхода за пределы корня
  const root = path.join(ROOT);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.json' ? 'public, max-age=3600' : 'no-cache',
    });
    res.end(data);
  });
}

const server = createServer(router);

// Перехват не-API запросов на отдачу статики
const origListeners = server.listeners('request').slice();
server.removeAllListeners('request');
server.on('request', (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/') || req.method === 'OPTIONS') {
    return origListeners[0](req, res);
  }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end();
});

server.listen(PORT, () => {
  console.log(`ArhoShop server → http://localhost:${PORT}`);
  console.log(`  сайт:        http://localhost:${PORT}/`);
  console.log(`  приложение:  http://localhost:${PORT}/app`);
  console.log(`  API health:  http://localhost:${PORT}/api/health`);
});

module.exports = server;
