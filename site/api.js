/* ArhoShop — клиент бэкенда + ленивая подгрузка каталога.
   Подключается ДО основного скрипта index.html.
   База API: тот же origin (раздаётся сервером). Можно переопределить window.ARHO_API_BASE. */
(function () {
  'use strict';
  const API = (window.ARHO_API_BASE || '') + '/api';
  const TOKEN_KEY = 'arho_token';

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  async function req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = getToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw { error: 'network', message: 'Нет связи с сервером' };
    }
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw (data || { error: 'http_' + res.status, message: 'Ошибка ' + res.status });
    return data;
  }

  /* ---------- Каталог: ленивая подгрузка чанков ---------- */
  const ArhoCatalog = {
    onProgress: null,
    progress(n, total) {
      const el = document.getElementById('catalogGrid');
      if (el && !window.__catReady) {
        el.setAttribute('data-loading', Math.round((n / total) * 100) + '%');
      }
    },
    async load(onProgress) {
      const base = (window.ARHO_DATA_BASE || '/data');
      const manifest = await fetch(base + '/manifest.json').then((r) => r.json());
      window.SIZE_CHARTS = await fetch(base + '/' + manifest.charts).then((r) => r.json());
      window.PRODUCTS_DATA = [];
      for (const chunk of manifest.chunks) {
        const part = await fetch(base + '/' + chunk).then((r) => r.json());
        for (let i = 0; i < part.length; i++) window.PRODUCTS_DATA.push(part[i]);
        (onProgress || this.progress)(window.PRODUCTS_DATA.length, manifest.total);
      }
      window.__catReady = true;
      return { count: window.PRODUCTS_DATA.length };
    },
  };

  /* ---------- Популярность (просмотры товаров) ---------- */
  const ArhoPopular = {
    // фиксируем просмотр: локально (мгновенно) + на сервере (глобально)
    track(id) {
      try {
        const c = JSON.parse(localStorage.getItem('arho_clicks') || '{}');
        c[id] = (c[id] || 0) + 1;
        localStorage.setItem('arho_clicks', JSON.stringify(c));
      } catch (e) {}
      req('POST', '/products/' + encodeURIComponent(id) + '/view').catch(() => {});
    },
    // подмешать глобальные просмотры с сервера в локальный счётчик
    async seed() {
      try {
        const { items } = await req('GET', '/products/popular?limit=50');
        const c = JSON.parse(localStorage.getItem('arho_clicks') || '{}');
        items.forEach((it) => {
          const id = it.product_id;
          c[id] = Math.max(c[id] || 0, it.views);
        });
        localStorage.setItem('arho_clicks', JSON.stringify(c));
        return true;
      } catch (e) { return false; }
    },
  };

  /* ---------- Аутентификация / профиль / заказы ---------- */
  let cached = null; // { user, loyalty, orders }

  function shapeAccount() {
    if (!cached || !cached.user) return null;
    const u = cached.user, l = cached.loyalty || {};
    return {
      name: u.name, phone: u.phone, email: u.email,
      spent: l.spent != null ? l.spent : u.spent,
      bonuses: l.bonuses != null ? l.bonuses : u.bonuses,
      orders: (cached.orders || []).map((o) => ({
        num: o.id, total: o.total, count: o.count,
        date: o.createdAt, earned: o.earnedBonuses,
      })),
    };
  }

  const ArhoAuth = {
    isLoggedIn() { return !!getToken() && !!cached; },
    account() { return shapeAccount(); },
    async restore() {
      if (!getToken()) return null;
      try { cached = await req('GET', '/me'); return shapeAccount(); }
      catch (e) { if (e.error === 'unauthorized') setToken(''); cached = null; return null; }
    },
    async refresh() {
      try { cached = await req('GET', '/me'); } catch (e) { cached = null; }
      return shapeAccount();
    },
    async register({ name, phone, password, email }) {
      const r = await req('POST', '/auth/register', { name, phone, password, email });
      setToken(r.token); await this.refresh(); return r;
    },
    async login({ phone, password }) {
      const r = await req('POST', '/auth/login', { phone, password });
      setToken(r.token); await this.refresh(); return r;
    },
    async forgot(email) { return req('POST', '/auth/forgot', { email }); },
    async updateProfile({ name, phone, email }) {
      const r = await req('PATCH', '/me', { name, phone, email });
      await this.refresh(); return r;
    },
    async changePassword(current, next) {
      return req('POST', '/me/password', { current, next });
    },
    logout() { setToken(''); cached = null; },
    async createOrder(payload) {
      const r = await req('POST', '/orders', payload);
      if (this.isLoggedIn()) await this.refresh();
      return r;
    },
  };

  window.ArhoCatalog = ArhoCatalog;
  window.ArhoPopular = ArhoPopular;
  window.ArhoAuth = ArhoAuth;
})();
