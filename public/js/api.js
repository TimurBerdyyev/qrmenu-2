// Небольшой хелпер поверх fetch для обращения к нашему API.
const Api = {
  // Админские запросы подписываем паролем, сохранённым при входе в админку.
  _headers(json) {
    const h = json ? { 'Content-Type': 'application/json' } : {};
    const pw = sessionStorage.getItem('cafepos_admin_pw');
    if (pw) h['X-Admin-Password'] = pw;
    return h;
  },
  async get(url) {
    const r = await fetch(url, { headers: Api._headers(false) });
    if (!r.ok) throw await Api._err(r);
    return r.json();
  },
  async post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: Api._headers(true),
      body: JSON.stringify(body || {})
    });
    if (!r.ok) throw await Api._err(r);
    return r.json();
  },
  async put(url, body) {
    const r = await fetch(url, {
      method: 'PUT',
      headers: Api._headers(true),
      body: JSON.stringify(body || {})
    });
    if (!r.ok) throw await Api._err(r);
    return r.json();
  },
  async patch(url, body) {
    const r = await fetch(url, {
      method: 'PATCH',
      headers: Api._headers(true),
      body: JSON.stringify(body || {})
    });
    if (!r.ok) throw await Api._err(r);
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE', headers: Api._headers(false) });
    if (!r.ok) throw await Api._err(r);
    return r.json();
  },
  async _err(r) {
    try {
      const j = await r.json();
      return new Error(j.error || 'request_failed');
    } catch (e) {
      return new Error('request_failed');
    }
  }
};

function money(n) {
  return Math.round(n).toLocaleString('ru-RU') + ' \u20bd';
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
