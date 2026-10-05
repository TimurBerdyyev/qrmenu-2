// Сервер кафе-POS. Работает на чистом Node.js, без внешних зависимостей.
// Запуск: node server/server.js   (или npm start)
// Все устройства в кафе заходят по адресу http://<IP-этого-компьютера>:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const { readDB, writeDB, genId, dailyBackup, exportBackup, importBackup, UPLOADS_DIR, DATA_DIR } = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function notFound(res) {
  sendJSON(res, 404, { error: 'not_found' });
}

function parseBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// --- Загруженные фото (логотип, фото блюд) ---
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function saveUpload(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const name = genId('img') + IMAGE_EXT[m[1]];
  fs.writeFileSync(path.join(UPLOADS_DIR, name), Buffer.from(m[2], 'base64'));
  return '/uploads/' + name;
}

// Удаляет файл, если он больше нигде не используется.
function removeUpload(db, fileUrl) {
  if (!fileUrl || !fileUrl.startsWith('/uploads/')) return;
  const stillUsed =
    db.menuItems.some((mi) => mi.image === fileUrl) ||
    db.guestMenu.logo === fileUrl ||
    db.guestMenu.heroImage === fileUrl;
  if (stillUsed) return;
  fs.unlink(path.join(UPLOADS_DIR, path.basename(fileUrl)), () => {});
}

// Адреса этого компьютера в локальной сети — для QR-кода гостевого меню.
function lanAddresses() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) result.push(addr.address);
    }
  }
  return result;
}

// Гостевое меню: только видимые позиции, без служебных данных.
function buildGuestMenu(db) {
  const categories = [...db.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      id: c.id,
      name: c.name,
      items: db.menuItems
        .filter((mi) => mi.categoryId === c.id && mi.available)
        .map((mi) => ({
          id: mi.id,
          name: mi.name,
          price: mi.price,
          description: mi.description || '',
          image: mi.image || ''
        }))
    }))
    .filter((c) => c.items.length > 0);
  return { settings: db.guestMenu, categories };
}

// --- Вычисление итогов заказа ---
function computeTotal(order) {
  return order.items.reduce((sum, it) => sum + it.price * it.qty, 0);
}

function orderPublicView(order) {
  return { ...order, total: computeTotal(order) };
}

// --- Отчёты ---
function buildDailyReport(db, dateStr) {
  const orders = db.orders.filter(
    (o) => o.status === 'closed' && o.closedAt && o.closedAt.slice(0, 10) === dateStr
  );
  const total = orders.reduce((s, o) => s + computeTotal(o), 0);
  const byWaiterMap = {};
  for (const o of orders) {
    if (!byWaiterMap[o.waiterId]) {
      byWaiterMap[o.waiterId] = { waiterId: o.waiterId, name: o.waiterName, total: 0, ordersCount: 0 };
    }
    byWaiterMap[o.waiterId].total += computeTotal(o);
    byWaiterMap[o.waiterId].ordersCount += 1;
  }
  return {
    date: dateStr,
    total,
    ordersCount: orders.length,
    byWaiter: Object.values(byWaiterMap).sort((a, b) => b.total - a.total)
  };
}

function buildMonthlyReport(db, monthStr) {
  // monthStr: 'YYYY-MM'
  const orders = db.orders.filter(
    (o) => o.status === 'closed' && o.closedAt && o.closedAt.slice(0, 7) === monthStr
  );
  const total = orders.reduce((s, o) => s + computeTotal(o), 0);
  const dayMap = {};
  for (const o of orders) {
    const d = o.closedAt.slice(0, 10);
    dayMap[d] = (dayMap[d] || 0) + computeTotal(o);
  }
  const days = Object.keys(dayMap)
    .sort()
    .map((d) => ({ date: d, total: dayMap[d] }));

  const byWaiterMap = {};
  for (const o of orders) {
    if (!byWaiterMap[o.waiterId]) {
      byWaiterMap[o.waiterId] = { waiterId: o.waiterId, name: o.waiterName, total: 0, ordersCount: 0 };
    }
    byWaiterMap[o.waiterId].total += computeTotal(o);
    byWaiterMap[o.waiterId].ordersCount += 1;
  }

  const itemMap = {};
  for (const o of orders) {
    for (const it of o.items) {
      itemMap[it.name] = (itemMap[it.name] || 0) + it.qty;
    }
  }
  const topItems = Object.entries(itemMap)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  return {
    month: monthStr,
    total,
    ordersCount: orders.length,
    days,
    byWaiter: Object.values(byWaiterMap).sort((a, b) => b.total - a.total),
    topItems
  };
}

// --- Роутинг API ---
async function handleApi(req, res, pathname, query) {
  const db = readDB();

  // ---- Публичное меню / столы ----
  if (req.method === 'GET' && pathname === '/api/menu') {
    return sendJSON(res, 200, { categories: db.categories, menuItems: db.menuItems });
  }
  if (req.method === 'GET' && pathname === '/api/tables') {
    return sendJSON(res, 200, db.tables);
  }
  if (req.method === 'GET' && pathname === '/api/guest-menu') {
    return sendJSON(res, 200, buildGuestMenu(db));
  }

  // ---- Логин официанта ----
  if (req.method === 'POST' && pathname === '/api/login/waiter') {
    const body = await parseBody(req);
    const waiter = db.waiters.find((w) => w.pin === String(body.pin) && w.active);
    if (!waiter) return sendJSON(res, 401, { error: 'invalid_pin' });
    return sendJSON(res, 200, { id: waiter.id, name: waiter.name });
  }

  // ---- Логин админа ----
  if (req.method === 'POST' && pathname === '/api/login/admin') {
    const body = await parseBody(req);
    if (body.password !== db.admin.password) return sendJSON(res, 401, { error: 'invalid_password' });
    return sendJSON(res, 200, { ok: true });
  }

  // ---- Заказы: список ----
  if (req.method === 'GET' && pathname === '/api/orders') {
    let orders = db.orders;
    if (query.status) orders = orders.filter((o) => o.status === query.status);
    return sendJSON(res, 200, orders.map(orderPublicView));
  }

  // ---- Заказы: получить один ----
  let m = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    const order = db.orders.find((o) => o.id === m[1]);
    if (!order) return notFound(res);
    return sendJSON(res, 200, orderPublicView(order));
  }

  // ---- Заказы: создать (или добавить в открытый заказ этого стола) ----
  if (req.method === 'POST' && pathname === '/api/orders') {
    const body = await parseBody(req);
    const { waiterId, waiterName, tableId, items } = body;
    if (!waiterId || !tableId || !Array.isArray(items) || items.length === 0) {
      return sendJSON(res, 400, { error: 'bad_request' });
    }
    const newItems = items.map((it) => {
      const menuItem = db.menuItems.find((mi) => mi.id === it.menuItemId);
      if (!menuItem) return null;
      return {
        id: genId('oi'),
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        qty: it.qty || 1,
        status: 'cooking' // cooking | ready
      };
    }).filter(Boolean);

    if (newItems.length === 0) return sendJSON(res, 400, { error: 'no_valid_items' });

    let order = db.orders.find((o) => o.tableId === tableId && o.status === 'open');
    if (order) {
      order.items.push(...newItems);
      order.updatedAt = new Date().toISOString();
    } else {
      const table = db.tables.find((t) => t.id === tableId);
      order = {
        id: genId('ord'),
        waiterId,
        waiterName: waiterName || '',
        tableId,
        tableName: table ? table.name : tableId,
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        closedAt: null,
        items: newItems
      };
      db.orders.push(order);
    }
    writeDB(db);
    return sendJSON(res, 200, orderPublicView(order));
  }

  // ---- Позиция заказа: изменить статус готовности (повар) ----
  m = pathname.match(/^\/api\/orders\/([^/]+)\/items\/([^/]+)$/);
  if (req.method === 'PATCH' && m) {
    const body = await parseBody(req);
    const order = db.orders.find((o) => o.id === m[1]);
    if (!order) return notFound(res);
    const item = order.items.find((i) => i.id === m[2]);
    if (!item) return notFound(res);
    if (body.status === 'cooking' || body.status === 'ready') {
      item.status = body.status;
      order.updatedAt = new Date().toISOString();
      writeDB(db);
    }
    return sendJSON(res, 200, orderPublicView(order));
  }

  // ---- Закрыть заказ (пробить чек) ----
  m = pathname.match(/^\/api\/orders\/([^/]+)\/close$/);
  if (req.method === 'POST' && m) {
    const order = db.orders.find((o) => o.id === m[1]);
    if (!order) return notFound(res);
    order.status = 'closed';
    order.closedAt = new Date().toISOString();
    writeDB(db);
    return sendJSON(res, 200, orderPublicView(order));
  }

  // ================= АДМИНКА =================
  // Гости подключаются к той же Wi‑Fi сети ради QR-меню, поэтому админские
  // запросы принимаем только с паролем администратора.
  if (pathname.startsWith('/api/admin/') && req.headers['x-admin-password'] !== db.admin.password) {
    return sendJSON(res, 401, { error: 'unauthorized' });
  }

  // Категории
  if (req.method === 'POST' && pathname === '/api/admin/categories') {
    const body = await parseBody(req);
    if (!body.name) return sendJSON(res, 400, { error: 'name_required' });
    const cat = { id: genId('c'), name: body.name, sortOrder: db.categories.length + 1 };
    db.categories.push(cat);
    writeDB(db);
    return sendJSON(res, 200, cat);
  }
  m = pathname.match(/^\/api\/admin\/categories\/([^/]+)$/);
  if (req.method === 'PUT' && m) {
    const body = await parseBody(req);
    const cat = db.categories.find((c) => c.id === m[1]);
    if (!cat) return notFound(res);
    if (body.name) cat.name = body.name;
    if (typeof body.sortOrder === 'number') cat.sortOrder = body.sortOrder;
    writeDB(db);
    return sendJSON(res, 200, cat);
  }
  if (req.method === 'DELETE' && m) {
    db.categories = db.categories.filter((c) => c.id !== m[1]);
    db.menuItems = db.menuItems.filter((mi) => mi.categoryId !== m[1]);
    writeDB(db);
    return sendJSON(res, 200, { ok: true });
  }

  // Позиции меню
  if (req.method === 'POST' && pathname === '/api/admin/menu-items') {
    const body = await parseBody(req);
    if (!body.name || !body.categoryId || typeof body.price !== 'number') {
      return sendJSON(res, 400, { error: 'bad_request' });
    }
    const item = {
      id: genId('m'),
      categoryId: body.categoryId,
      name: body.name,
      price: body.price,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      image: '',
      available: body.available !== false
    };
    db.menuItems.push(item);
    writeDB(db);
    return sendJSON(res, 200, item);
  }
  m = pathname.match(/^\/api\/admin\/menu-items\/([^/]+)$/);
  if (req.method === 'PUT' && m) {
    const body = await parseBody(req);
    const item = db.menuItems.find((mi) => mi.id === m[1]);
    if (!item) return notFound(res);
    if (body.name) item.name = body.name;
    if (body.categoryId) item.categoryId = body.categoryId;
    if (typeof body.price === 'number') item.price = body.price;
    if (typeof body.available === 'boolean') item.available = body.available;
    if (typeof body.description === 'string') item.description = body.description.trim();
    if (typeof body.image === 'string' && body.image !== item.image) {
      const old = item.image;
      item.image = body.image;
      removeUpload(db, old);
    }
    writeDB(db);
    return sendJSON(res, 200, item);
  }
  if (req.method === 'DELETE' && m) {
    const item = db.menuItems.find((mi) => mi.id === m[1]);
    db.menuItems = db.menuItems.filter((mi) => mi.id !== m[1]);
    if (item) removeUpload(db, item.image);
    writeDB(db);
    return sendJSON(res, 200, { ok: true });
  }

  // Официанты
  if (req.method === 'GET' && pathname === '/api/admin/waiters') {
    return sendJSON(res, 200, db.waiters);
  }
  if (req.method === 'POST' && pathname === '/api/admin/waiters') {
    const body = await parseBody(req);
    if (!body.name || !body.pin) return sendJSON(res, 400, { error: 'bad_request' });
    const waiter = { id: genId('w'), name: body.name, pin: String(body.pin), active: true };
    db.waiters.push(waiter);
    writeDB(db);
    return sendJSON(res, 200, waiter);
  }
  m = pathname.match(/^\/api\/admin\/waiters\/([^/]+)$/);
  if (req.method === 'PUT' && m) {
    const body = await parseBody(req);
    const waiter = db.waiters.find((w) => w.id === m[1]);
    if (!waiter) return notFound(res);
    if (body.name) waiter.name = body.name;
    if (body.pin) waiter.pin = String(body.pin);
    if (typeof body.active === 'boolean') waiter.active = body.active;
    writeDB(db);
    return sendJSON(res, 200, waiter);
  }
  if (req.method === 'DELETE' && m) {
    db.waiters = db.waiters.filter((w) => w.id !== m[1]);
    writeDB(db);
    return sendJSON(res, 200, { ok: true });
  }

  // Столы
  if (req.method === 'POST' && pathname === '/api/admin/tables') {
    const body = await parseBody(req);
    if (!body.name) return sendJSON(res, 400, { error: 'name_required' });
    const table = { id: genId('t'), name: body.name };
    db.tables.push(table);
    writeDB(db);
    return sendJSON(res, 200, table);
  }
  m = pathname.match(/^\/api\/admin\/tables\/([^/]+)$/);
  if (req.method === 'DELETE' && m) {
    db.tables = db.tables.filter((t) => t.id !== m[1]);
    writeDB(db);
    return sendJSON(res, 200, { ok: true });
  }

  // Смена пароля админа
  if (req.method === 'PUT' && pathname === '/api/admin/password') {
    const body = await parseBody(req);
    if (!body.password) return sendJSON(res, 400, { error: 'bad_request' });
    db.admin.password = body.password;
    writeDB(db);
    return sendJSON(res, 200, { ok: true });
  }

  // Гостевое QR-меню: настройки
  if (req.method === 'PUT' && pathname === '/api/admin/guest-menu') {
    const body = await parseBody(req);
    const fields = ['name', 'tagline', 'badge', 'welcome', 'instagram', 'phone', 'address', 'currency', 'logo', 'heroImage'];
    const oldImages = [db.guestMenu.logo, db.guestMenu.heroImage];
    for (const f of fields) {
      if (typeof body[f] === 'string') db.guestMenu[f] = body[f].trim();
    }
    oldImages.forEach((u) => removeUpload(db, u));
    writeDB(db);
    return sendJSON(res, 200, db.guestMenu);
  }

  // Загрузка фото (фото уже уменьшено в браузере перед отправкой)
  if (req.method === 'POST' && pathname === '/api/admin/upload') {
    const body = await parseBody(req, 12 * 1024 * 1024);
    const fileUrl = saveUpload(body.dataUrl);
    if (!fileUrl) return sendJSON(res, 400, { error: 'bad_image' });
    return sendJSON(res, 200, { url: fileUrl });
  }

  // Резервная копия: скачать всё одним файлом / восстановить из файла
  if (req.method === 'GET' && pathname === '/api/admin/backup') {
    const name = 'cafe-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + name + '"'
    });
    return res.end(JSON.stringify(exportBackup()));
  }
  if (req.method === 'POST' && pathname === '/api/admin/restore') {
    const body = await parseBody(req, 300 * 1024 * 1024);
    try {
      importBackup(body);
    } catch (e) {
      return sendJSON(res, 400, { error: 'bad_backup' });
    }
    return sendJSON(res, 200, { ok: true });
  }

  // Адрес сервера в локальной сети (для QR-кода)
  if (req.method === 'GET' && pathname === '/api/admin/server-info') {
    return sendJSON(res, 200, { port: Number(PORT), addresses: lanAddresses() });
  }

  // Отчёты
  if (req.method === 'GET' && pathname === '/api/admin/reports/daily') {
    const dateStr = query.date || new Date().toISOString().slice(0, 10);
    return sendJSON(res, 200, buildDailyReport(db, dateStr));
  }
  if (req.method === 'GET' && pathname === '/api/admin/reports/monthly') {
    const monthStr = query.month || new Date().toISOString().slice(0, 7);
    return sendJSON(res, 200, buildMonthlyReport(db, monthStr));
  }

  return notFound(res);
}

// --- Раздача статических файлов ---
function serveStatic(req, res, pathname) {
  let filePath;
  let baseDir = PUBLIC_DIR;
  if (pathname.startsWith('/uploads/')) {
    baseDir = UPLOADS_DIR;
    filePath = path.join(UPLOADS_DIR, pathname.slice('/uploads/'.length));
  } else {
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/menu' || pathname === '/menu/') pathname = '/menu.html';
    filePath = path.join(PUBLIC_DIR, pathname);
  }

  // защита от выхода за пределы разрешённой папки
  if (!filePath.startsWith(baseDir + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Страница не найдена');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, parsed.query);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'server_error', message: err.message });
  }
});

dailyBackup();
setInterval(dailyBackup, 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log('Данные кафе: ' + DATA_DIR);
  console.log(`Cafe POS сервер запущен: http://localhost:${PORT}`);
  console.log('На других устройствах используйте локальный IP этого компьютера, например http://192.168.1.50:' + PORT);
});
