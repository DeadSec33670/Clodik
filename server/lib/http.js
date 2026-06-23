'use strict';
const http = require('node:http');
const { verify } = require('./auth');

/**
 * Маленький роутер поверх node:http: маршруты, JSON-парсинг тела,
 * CORS, авторизация по Bearer-токену. Без внешних зависимостей.
 */

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    // /users/:id → регэксп с именованными группами
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    }) + '/?$');
    this.routes.push({ method, rx, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }
}

function send(res, status, body, extraHeaders = {}) {
  const json = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extraHeaders,
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { tooBig = true; req.destroy(); } // 1 МБ лимит
    });
    req.on('end', () => {
      if (tooBig || !data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function createServer(router) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') return send(res, 204);

    const route = router.match(req.method, url.pathname);
    if (!route) return send(res, 404, { error: 'not_found' });

    // Контекст запроса
    const ctx = {
      params: route.params,
      query: Object.fromEntries(url.searchParams),
      body: ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {},
      headers: req.headers,
      user: null,
      // Хелперы ответа
      json: (status, body) => send(res, status, body),
      ok: (body) => send(res, 200, body),
      created: (body) => send(res, 201, body),
      error: (status, code, msg) => send(res, status, { error: code, message: msg }),
    };

    // Авторизация (если есть токен) — заполняет ctx.user
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      ctx.auth = verify(auth.slice(7));
    }

    try {
      await route.handler(ctx);
    } catch (err) {
      console.error('[error]', req.method, url.pathname, err);
      if (!res.headersSent) send(res, 500, { error: 'internal', message: 'Внутренняя ошибка сервера' });
    }
  });
}

module.exports = { Router, createServer, send };
