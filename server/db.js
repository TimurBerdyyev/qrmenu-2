// Простое файловое хранилище (JSON) — без внешних зависимостей.
// Для маленького кафе этого достаточно; позже легко заменить на PostgreSQL.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function seedData() {
  const now = new Date().toISOString();
  return {
    admin: { password: 'admin123' }, // сменить перед реальным использованием
    waiters: [
      { id: 'w1', name: 'Анна', pin: '1111', active: true },
      { id: 'w2', name: 'Игорь', pin: '2222', active: true }
    ],
    categories: [
      { id: 'c1', name: 'Кофе', sortOrder: 1 },
      { id: 'c2', name: 'Десерты', sortOrder: 2 },
      { id: 'c3', name: 'Завтраки', sortOrder: 3 }
    ],
    menuItems: [
      { id: 'm1', categoryId: 'c1', name: 'Эспрессо', price: 120, available: true },
      { id: 'm2', categoryId: 'c1', name: 'Капучино', price: 180, available: true },
      { id: 'm3', categoryId: 'c1', name: 'Латте', price: 190, available: true },
      { id: 'm4', categoryId: 'c2', name: 'Чизкейк', price: 250, available: true },
      { id: 'm5', categoryId: 'c2', name: 'Тирамису', price: 270, available: true },
      { id: 'm6', categoryId: 'c3', name: 'Омлет', price: 220, available: true },
      { id: 'm7', categoryId: 'c3', name: 'Сырники', price: 240, available: true }
    ],
    tables: [
      { id: 't1', name: 'Стол 1' },
      { id: 't2', name: 'Стол 2' },
      { id: 't3', name: 'Стол 3' },
      { id: 't4', name: 'Стол 4' },
      { id: 't5', name: 'Стол 5' }
    ],
    orders: [],
    _meta: { createdAt: now }
  };
}

function ensureDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(seedData(), null, 2), 'utf8');
  }
}

function readDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

// Очень простая защита от гонок записи: запись синхронная и быстрая,
// для масштаба одного кафе (десятки заказов в день) этого достаточно.
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

module.exports = { readDB, writeDB, genId };
