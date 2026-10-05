// Простое файловое хранилище (JSON) — без внешних зависимостей.
// Для маленького кафе этого достаточно; позже легко заменить на PostgreSQL.

const fs = require('fs');
const path = require('path');

// Данные кафе (меню, заказы, фото) живут в папке data/ и НЕ хранятся в git,
// поэтому обновление программы их не затирает. Папку можно вынести в другое
// место переменной окружения CAFE_DATA_DIR.
const DATA_DIR = process.env.CAFE_DATA_DIR
  ? path.resolve(process.env.CAFE_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const BACKUPS_TO_KEEP = 30;

// Настройки гостевого QR-меню (название, приветствие, контакты, логотип).
function defaultGuestMenu() {
  return {
    name: 'Наше кафе',
    tagline: 'Меню и тёплые встречи',
    badge: 'Открыто 24/7',
    welcome:
      'Добро пожаловать!\nМы рады приветствовать вас в нашем заведении.\n' +
      'Здесь вы найдёте блюда, приготовленные с душой и заботой,\n' +
      'а также уютную атмосферу для приятного отдыха.\nПриятного аппетита!',
    instagram: '',
    phone: '',
    address: '',
    currency: '₽',
    logo: '',
    heroImage: ''
  };
}

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
    guestMenu: defaultGuestMenu(),
    _meta: { createdAt: now }
  };
}

function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

function ensureDB() {
  if (fs.existsSync(DB_PATH)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Файл базы пропал (например, папку перезаписали при обновлении) —
  // поднимаем последнюю автокопию вместо пустого стартового меню.
  const backups = listBackups();
  if (backups.length) {
    const latest = backups[backups.length - 1];
    fs.copyFileSync(path.join(BACKUPS_DIR, latest), DB_PATH);
    console.log('Файл базы не найден — восстановлен из резервной копии ' + latest);
    return;
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(seedData(), null, 2), 'utf8');
}

function readDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db = JSON.parse(raw);
  // Базы, созданные до появления гостевого меню, дополняем настройками по умолчанию.
  db.guestMenu = { ...defaultGuestMenu(), ...(db.guestMenu || {}) };
  return db;
}

// Очень простая защита от гонок записи: запись синхронная и быстрая,
// для масштаба одного кафе (десятки заказов в день) этого достаточно.
// Пишем во временный файл и переименовываем, чтобы при отключении света
// посреди записи база не оказалась обрезанной.
function writeDB(db) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

// Автокопия базы в data/backups/: один файл на день, обновляется каждый час
// (сервер вызывает раз в час), хранятся последние 30 дней.
function dailyBackup() {
  ensureDB();
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const name = 'db-' + new Date().toISOString().slice(0, 10) + '.json';
  fs.copyFileSync(DB_PATH, path.join(BACKUPS_DIR, name));
  const backups = listBackups();
  backups.slice(0, Math.max(0, backups.length - BACKUPS_TO_KEEP)).forEach((f) => {
    fs.unlinkSync(path.join(BACKUPS_DIR, f));
  });
}

// Полная копия одним файлом: база + фото (в base64). Её скачивают из админки
// и при необходимости загружают обратно — например, на новом компьютере.
const BACKUP_FORMAT = 'cafe-pos-backup';

function exportBackup() {
  const uploads = {};
  if (fs.existsSync(UPLOADS_DIR)) {
    for (const f of fs.readdirSync(UPLOADS_DIR)) {
      uploads[f] = fs.readFileSync(path.join(UPLOADS_DIR, f)).toString('base64');
    }
  }
  return { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), db: readDB(), uploads };
}

function importBackup(backup) {
  const db = backup && backup.db;
  const valid =
    backup &&
    backup.format === BACKUP_FORMAT &&
    db &&
    ['waiters', 'categories', 'menuItems', 'tables', 'orders'].every((k) => Array.isArray(db[k]));
  if (!valid) throw new Error('bad_backup');

  // Перед восстановлением сохраняем текущее состояние — на случай ошибки.
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(DB_PATH, path.join(BACKUPS_DIR, 'before-restore-' + stamp + '.json'));

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const [name, b64] of Object.entries(backup.uploads || {})) {
    if (!/^[\w-]+\.(jpg|png|webp)$/.test(name)) continue;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), Buffer.from(String(b64), 'base64'));
  }
  // Пароль администратора оставляем текущий, чтобы не потерять доступ к админке.
  db.admin = readDB().admin;
  writeDB(db);
}

function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

module.exports = { readDB, writeDB, genId, dailyBackup, exportBackup, importBackup, UPLOADS_DIR, DATA_DIR };
