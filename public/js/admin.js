(function () {
  const viewLogin = document.getElementById('view-login');
  const viewMain = document.getElementById('view-main');
  const tabContent = document.getElementById('tabContent');
  const tabs = document.querySelectorAll('.admin-tab');
  let activeTab = 'dashboard';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // Уменьшаем фото в браузере перед загрузкой: снимки с телефона весят мегабайты,
  // а гостям по Wi‑Fi нужна быстрая загрузка меню.
  function resizeImage(file, maxSize, keepTransparency) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        const png = keepTransparency && file.type === 'image/png';
        resolve(canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('bad_image'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadImage(file, maxSize, keepTransparency) {
    const dataUrl = await resizeImage(file, maxSize, keepTransparency);
    const { url } = await Api.post('/api/admin/upload', { dataUrl });
    return url;
  }

  // Поле «фото»: превью + кнопки «Загрузить» / «Убрать». Возвращает функцию,
  // которая отдаёт текущий адрес фото (загрузка происходит сразу при выборе файла).
  function mountPhotoField(container, initialUrl, opts) {
    let current = initialUrl || '';
    container.innerHTML = `
      <div class="photo-field">
        <img class="photo-preview ${opts.logo ? 'logo' : ''}" alt="" />
        <label class="btn btn-ghost">Загрузить фото
          <input type="file" accept="image/*" hidden />
        </label>
        <button type="button" class="btn btn-ghost" data-remove>Убрать</button>
        <span class="meta" data-status></span>
      </div>`;
    const preview = container.querySelector('img');
    const removeBtn = container.querySelector('[data-remove]');
    const status = container.querySelector('[data-status]');
    const sync = () => {
      preview.style.visibility = current ? 'visible' : 'hidden';
      if (current) preview.src = current;
      removeBtn.hidden = !current;
    };
    sync();
    container.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      status.textContent = 'Загрузка…';
      try {
        current = await uploadImage(file, opts.maxSize || 1600, !!opts.logo);
        status.textContent = '';
      } catch (err) {
        status.textContent = 'Не удалось загрузить фото';
      }
      e.target.value = '';
      sync();
    });
    removeBtn.addEventListener('click', () => {
      current = '';
      sync();
    });
    return () => current;
  }

  // ---------- ВХОД ----------
  async function tryLogin() {
    const password = document.getElementById('adminPassword').value;
    try {
      await Api.post('/api/login/admin', { password });
      sessionStorage.setItem('cafepos_admin_pw', password);
      viewLogin.style.display = 'none';
      viewLogin.hidden = true;
      viewMain.hidden = false;
      viewMain.style.display = '';
      document.body.style.overflow = 'auto';
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      selectTab('dashboard');
    } catch (e) {
      document.getElementById('loginError').innerHTML = '<div class="error-msg">Неверный пароль</div>';
    }
  }
  document.getElementById('btnAdminLogin').addEventListener('click', tryLogin);
  document.getElementById('adminPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryLogin();
  });

  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  function selectTab(name) {
    activeTab = name;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.body.style.overflow = 'auto';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const renderers = {
      dashboard: renderDashboard,
      menu: renderMenu,
      waiters: renderWaiters,
      tables: renderTables,
      reports: renderReports,
      guest: renderGuestMenu,
      settings: renderSettings
    };
    renderers[name]();
  }

  // ---------- ДАШБОРД (выручка сегодня) ----------
  async function renderDashboard() {
    tabContent.innerHTML = '<div class="empty-state">Загрузка…</div>';
    const today = new Date().toISOString().slice(0, 10);
    const report = await Api.get('/api/admin/reports/daily?date=' + today);
    const maxWaiter = report.byWaiter[0] ? report.byWaiter[0].total : 0;

    tabContent.innerHTML = `
      <div class="grid stat-cards">
        <div class="card stat-card">
          <div class="label">Выручка сегодня</div>
          <div class="value">${money(report.total)}</div>
        </div>
        <div class="card stat-card">
          <div class="label">Заказов закрыто</div>
          <div class="value">${report.ordersCount}</div>
        </div>
        <div class="card stat-card">
          <div class="label">Средний чек</div>
          <div class="value">${money(report.ordersCount ? report.total / report.ordersCount : 0)}</div>
        </div>
      </div>
      <div class="card">
        <div class="section-title">Продажи по официантам сегодня</div>
        <div id="waiterBars"></div>
      </div>
    `;

    const bars = document.getElementById('waiterBars');
    if (report.byWaiter.length === 0) {
      bars.innerHTML = '<div class="empty-state">Пока нет закрытых заказов</div>';
    } else {
      report.byWaiter.forEach((w) => {
        const pct = maxWaiter ? Math.round((w.total / maxWaiter) * 100) : 0;
        const row = document.createElement('div');
        row.className = 'bar-row';
        row.innerHTML = `
          <div class="bar-label">${w.name}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="bar-value">${money(w.total)}</div>
        `;
        bars.appendChild(row);
      });
    }
  }

  // ---------- МЕНЮ ----------
  async function renderMenu() {
    tabContent.innerHTML = '<div class="empty-state">Загрузка…</div>';
    const { categories, menuItems } = await Api.get('/api/menu');
    categories.sort((a, b) => a.sortOrder - b.sortOrder);

    let html = `
      <div class="card">
        <div class="section-title">Новая категория</div>
        <div class="inline-form">
          <div class="form-row"><label>Название</label><input id="newCatName" placeholder="Напр. Салаты" /></div>
          <button class="btn btn-primary" id="btnAddCat">Добавить категорию</button>
        </div>
      </div>
    `;

    categories.forEach((cat) => {
      const items = menuItems.filter((mi) => mi.categoryId === cat.id);
      html += `
        <div class="card" style="margin-top:14px;">
          <div class="list-row" style="border:none;padding-top:0;">
            <div class="main">${cat.name}</div>
            <div class="row-actions">
              <button class="btn btn-ghost" data-rename-cat="${cat.id}">Переименовать</button>
              <button class="btn btn-danger" data-del-cat="${cat.id}">Удалить</button>
            </div>
          </div>
          <div id="items-${cat.id}"></div>
          <div class="inline-form" style="margin-top:10px;">
            <div class="form-row"><label>Название</label><input id="newItemName-${cat.id}" placeholder="Название блюда" /></div>
            <div class="form-row"><label>Цена, ₽</label><input id="newItemPrice-${cat.id}" type="number" min="0" style="width:100px" /></div>
            <button class="btn btn-primary" data-add-item="${cat.id}">Добавить позицию</button>
          </div>
        </div>
      `;
    });

    tabContent.innerHTML = html;

    categories.forEach((cat) => {
      const container = document.getElementById('items-' + cat.id);
      const items = menuItems.filter((mi) => mi.categoryId === cat.id);
      if (items.length === 0) {
        container.innerHTML = '<div class="empty-state">Пока нет позиций</div>';
      } else {
        items.forEach((it) => {
          const row = document.createElement('div');
          row.className = 'list-row';
          row.innerHTML = `
            <div class="with-thumb">
              ${it.image ? `<img class="thumb" src="${esc(it.image)}" alt="" />` : '<div class="thumb"></div>'}
              <div style="min-width:0;">
                <div class="main">${esc(it.name)} ${it.available ? '' : '<span class="badge badge-warn">скрыто</span>'}</div>
                <div class="meta">${money(it.price)}</div>
                ${it.description ? `<div class="desc-snippet">${esc(it.description)}</div>` : ''}
              </div>
            </div>
            <div class="row-actions">
              <button class="btn btn-ghost" data-edit-item="${it.id}">Изменить</button>
              <button class="btn btn-ghost" data-toggle-item="${it.id}">${it.available ? 'Скрыть' : 'Показать'}</button>
              <button class="btn btn-danger" data-del-item="${it.id}">Удалить</button>
            </div>
          `;
          container.appendChild(row);
        });
      }
    });

    document.getElementById('btnAddCat').addEventListener('click', async () => {
      const name = document.getElementById('newCatName').value.trim();
      if (!name) return;
      await Api.post('/api/admin/categories', { name });
      renderMenu();
    });

    tabContent.querySelectorAll('[data-rename-cat]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.dataset.renameCat;
        const cat = categories.find((c) => c.id === id);
        const name = prompt('Новое название категории:', cat.name);
        if (name) {
          await Api.put('/api/admin/categories/' + id, { name });
          renderMenu();
        }
      })
    );
    tabContent.querySelectorAll('[data-del-cat]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (confirm('Удалить категорию и все её позиции?')) {
          await Api.del('/api/admin/categories/' + btn.dataset.delCat);
          renderMenu();
        }
      })
    );
    tabContent.querySelectorAll('[data-add-item]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const catId = btn.dataset.addItem;
        const nameInput = document.getElementById('newItemName-' + catId);
        const priceInput = document.getElementById('newItemPrice-' + catId);
        const name = nameInput.value.trim();
        const price = parseFloat(priceInput.value);
        if (!name || isNaN(price)) return alert('Укажите название и цену');
        await Api.post('/api/admin/menu-items', { categoryId: catId, name, price });
        renderMenu();
      })
    );
    tabContent.querySelectorAll('[data-edit-item]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const it = menuItems.find((mi) => mi.id === btn.dataset.editItem);
        openItemEditor(it);
      })
    );
    tabContent.querySelectorAll('[data-toggle-item]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const it = menuItems.find((mi) => mi.id === btn.dataset.toggleItem);
        await Api.put('/api/admin/menu-items/' + it.id, { available: !it.available });
        renderMenu();
      })
    );
    tabContent.querySelectorAll('[data-del-item]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (confirm('Удалить позицию из меню?')) {
          await Api.del('/api/admin/menu-items/' + btn.dataset.delItem);
          renderMenu();
        }
      })
    );
  }

  // Окно редактирования позиции: название, цена, описание и фото для гостевого меню
  function openItemEditor(it) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <div class="section-title">Позиция меню</div>
        <div class="form-row"><label>Название</label><input data-f="name" value="${esc(it.name)}" /></div>
        <div class="form-row"><label>Цена, ₽</label><input data-f="price" type="number" min="0" value="${esc(it.price)}" /></div>
        <div class="form-row"><label>Описание (видят гости в QR-меню)</label>
          <textarea data-f="description" placeholder="Состав, способ приготовления, вес…">${esc(it.description || '')}</textarea></div>
        <div class="form-row"><label>Фото</label><div data-photo></div></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-cancel>Отмена</button>
          <button class="btn btn-primary" data-save>Сохранить</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const getPhoto = mountPhotoField(backdrop.querySelector('[data-photo]'), it.image, {});
    const close = () => backdrop.remove();
    backdrop.querySelector('[data-cancel]').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    backdrop.querySelector('[data-save]').addEventListener('click', async () => {
      const f = (n) => backdrop.querySelector(`[data-f="${n}"]`).value;
      const name = f('name').trim();
      const price = parseFloat(f('price'));
      if (!name || isNaN(price)) return alert('Укажите название и цену');
      await Api.put('/api/admin/menu-items/' + it.id, {
        name,
        price,
        description: f('description'),
        image: getPhoto()
      });
      close();
      renderMenu();
    });
  }

  // ---------- ОФИЦИАНТЫ ----------
  async function renderWaiters() {
    tabContent.innerHTML = '<div class="empty-state">Загрузка…</div>';
    const waiters = await Api.get('/api/admin/waiters');
    let html = `
      <div class="card">
        <div class="section-title">Новый официант</div>
        <div class="inline-form">
          <div class="form-row"><label>Имя</label><input id="newWaiterName" placeholder="Имя" /></div>
          <div class="form-row"><label>PIN (4 цифры)</label><input id="newWaiterPin" maxlength="4" style="width:100px" /></div>
          <button class="btn btn-primary" id="btnAddWaiter">Добавить</button>
        </div>
      </div>
      <div class="card" style="margin-top:14px;">
        <div class="section-title">Список официантов</div>
        <div id="waitersList"></div>
      </div>
    `;
    tabContent.innerHTML = html;

    const list = document.getElementById('waitersList');
    if (waiters.length === 0) {
      list.innerHTML = '<div class="empty-state">Официантов пока нет</div>';
    } else {
      waiters.forEach((w) => {
        const row = document.createElement('div');
        row.className = 'list-row';
        row.innerHTML = `
          <div>
            <div class="main">${w.name} ${w.active ? '' : '<span class="badge badge-warn">отключён</span>'}</div>
            <div class="meta">PIN: ${w.pin}</div>
          </div>
          <div class="row-actions">
            <button class="btn btn-ghost" data-edit-waiter="${w.id}">Изменить</button>
            <button class="btn btn-ghost" data-toggle-waiter="${w.id}">${w.active ? 'Отключить' : 'Включить'}</button>
            <button class="btn btn-danger" data-del-waiter="${w.id}">Удалить</button>
          </div>
        `;
        list.appendChild(row);
      });
    }

    document.getElementById('btnAddWaiter').addEventListener('click', async () => {
      const name = document.getElementById('newWaiterName').value.trim();
      const pinVal = document.getElementById('newWaiterPin').value.trim();
      if (!name || !/^\d{4}$/.test(pinVal)) return alert('Укажите имя и 4-значный PIN');
      await Api.post('/api/admin/waiters', { name, pin: pinVal });
      renderWaiters();
    });
    tabContent.querySelectorAll('[data-edit-waiter]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const w = waiters.find((x) => x.id === btn.dataset.editWaiter);
        const name = prompt('Имя:', w.name);
        if (name === null) return;
        const pinVal = prompt('PIN (4 цифры):', w.pin);
        if (pinVal === null) return;
        if (!/^\d{4}$/.test(pinVal)) return alert('PIN должен состоять из 4 цифр');
        await Api.put('/api/admin/waiters/' + w.id, { name, pin: pinVal });
        renderWaiters();
      })
    );
    tabContent.querySelectorAll('[data-toggle-waiter]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const w = waiters.find((x) => x.id === btn.dataset.toggleWaiter);
        await Api.put('/api/admin/waiters/' + w.id, { active: !w.active });
        renderWaiters();
      })
    );
    tabContent.querySelectorAll('[data-del-waiter]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (confirm('Удалить официанта?')) {
          await Api.del('/api/admin/waiters/' + btn.dataset.delWaiter);
          renderWaiters();
        }
      })
    );
  }

  // ---------- СТОЛЫ ----------
  async function renderTables() {
    tabContent.innerHTML = '<div class="empty-state">Загрузка…</div>';
    const tablesList = await Api.get('/api/tables');
    let html = `
      <div class="card">
        <div class="section-title">Новый стол</div>
        <div class="inline-form">
          <div class="form-row"><label>Название</label><input id="newTableName" placeholder="Напр. Стол 6 / Веранда 1" /></div>
          <button class="btn btn-primary" id="btnAddTable">Добавить</button>
        </div>
      </div>
      <div class="card" style="margin-top:14px;">
        <div class="section-title">Столы</div>
        <div id="tablesList"></div>
      </div>
    `;
    tabContent.innerHTML = html;
    const list = document.getElementById('tablesList');
    if (tablesList.length === 0) {
      list.innerHTML = '<div class="empty-state">Столов пока нет</div>';
    } else {
      tablesList.forEach((t) => {
        const row = document.createElement('div');
        row.className = 'list-row';
        row.innerHTML = `<div class="main">${t.name}</div>
          <div class="row-actions"><button class="btn btn-danger" data-del-table="${t.id}">Удалить</button></div>`;
        list.appendChild(row);
      });
    }
    document.getElementById('btnAddTable').addEventListener('click', async () => {
      const name = document.getElementById('newTableName').value.trim();
      if (!name) return;
      await Api.post('/api/admin/tables', { name });
      renderTables();
    });
    tabContent.querySelectorAll('[data-del-table]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (confirm('Удалить стол?')) {
          await Api.del('/api/admin/tables/' + btn.dataset.delTable);
          renderTables();
        }
      })
    );
  }

  // ---------- ОТЧЁТЫ ЗА МЕСЯЦ ----------
  async function renderReports() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    tabContent.innerHTML = `
      <div class="card">
        <div class="inline-form">
          <div class="form-row"><label>Месяц</label><input type="month" id="reportMonth" value="${currentMonth}" /></div>
          <button class="btn btn-primary" id="btnLoadReport">Показать</button>
          <button class="btn btn-ghost" id="btnExportCsv">Скачать CSV</button>
        </div>
      </div>
      <div id="reportBody" style="margin-top:14px;"></div>
    `;
    document.getElementById('btnLoadReport').addEventListener('click', loadReport);
    document.getElementById('btnExportCsv').addEventListener('click', exportCsv);
    await loadReport();

    async function loadReport() {
      const month = document.getElementById('reportMonth').value || currentMonth;
      const report = await Api.get('/api/admin/reports/monthly?month=' + month);
      const body = document.getElementById('reportBody');
      const maxDay = report.days.reduce((m, d) => Math.max(m, d.total), 0);

      let daysHtml = report.days
        .map((d) => {
          const pct = maxDay ? Math.round((d.total / maxDay) * 100) : 0;
          return `<div class="bar-row">
            <div class="bar-label">${d.date.slice(8, 10)}.${d.date.slice(5, 7)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            <div class="bar-value">${money(d.total)}</div>
          </div>`;
        })
        .join('');
      if (!daysHtml) daysHtml = '<div class="empty-state">Нет закрытых заказов за этот месяц</div>';

      let waitersHtml = report.byWaiter
        .map((w) => `<tr><td>${w.name}</td><td>${w.ordersCount}</td><td>${money(w.total)}</td></tr>`)
        .join('');
      if (!waitersHtml) waitersHtml = '<tr><td colspan="3" class="empty-state">Нет данных</td></tr>';

      let topItemsHtml = report.topItems.map((it) => `<tr><td>${it.name}</td><td>${it.qty} шт.</td></tr>`).join('');
      if (!topItemsHtml) topItemsHtml = '<tr><td colspan="2" class="empty-state">Нет данных</td></tr>';

      body.innerHTML = `
        <div class="grid stat-cards">
          <div class="card stat-card"><div class="label">Выручка за месяц</div><div class="value">${money(report.total)}</div></div>
          <div class="card stat-card"><div class="label">Заказов</div><div class="value">${report.ordersCount}</div></div>
          <div class="card stat-card"><div class="label">Средний чек</div><div class="value">${money(report.ordersCount ? report.total / report.ordersCount : 0)}</div></div>
        </div>
        <div class="card">
          <div class="section-title">Выручка по дням</div>
          ${daysHtml}
        </div>
        <div class="card" style="margin-top:14px;">
          <div class="section-title">По официантам</div>
          <table class="data-table"><thead><tr><th>Официант</th><th>Заказов</th><th>Сумма</th></tr></thead><tbody>${waitersHtml}</tbody></table>
        </div>
        <div class="card" style="margin-top:14px;">
          <div class="section-title">Топ позиций меню</div>
          <table class="data-table"><thead><tr><th>Позиция</th><th>Продано</th></tr></thead><tbody>${topItemsHtml}</tbody></table>
        </div>
      `;
      body.dataset.report = JSON.stringify(report);
    }

    function exportCsv() {
      const body = document.getElementById('reportBody');
      const report = JSON.parse(body.dataset.report || '{}');
      if (!report.days) return;
      let csv = 'Дата;Выручка\n';
      report.days.forEach((d) => (csv += `${d.date};${d.total}\n`));
      csv += `\nОфициант;Заказов;Сумма\n`;
      report.byWaiter.forEach((w) => (csv += `${w.name};${w.ordersCount};${w.total}\n`));
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `отчёт-${report.month}.csv`;
      a.click();
    }
  }

  // ---------- QR-МЕНЮ ДЛЯ ГОСТЕЙ ----------
  async function renderGuestMenu() {
    tabContent.innerHTML = '<div class="empty-state">Загрузка…</div>';
    const [{ settings: s }, info] = await Promise.all([
      Api.get('/api/guest-menu'),
      Api.get('/api/admin/server-info')
    ]);

    const field = (key, label, placeholder) =>
      `<div class="form-row"><label>${label}</label><input data-g="${key}" value="${esc(s[key])}" placeholder="${esc(placeholder || '')}" /></div>`;

    // Адрес, который увидят гости: берём тот, по которому открыта админка,
    // если это не localhost; иначе — IP компьютера в локальной сети.
    const hosts = [];
    if (!/^(localhost|127\.)/.test(location.hostname)) hosts.push(location.host);
    info.addresses.forEach((ip) => {
      const h = ip + ':' + info.port;
      if (!hosts.includes(h)) hosts.push(h);
    });
    if (hosts.length === 0) hosts.push(location.host);

    tabContent.innerHTML = `
      <div class="guest-layout">
        <div class="card">
          <div class="section-title">Оформление и контакты</div>
          ${field('name', 'Название заведения')}
          ${field('tagline', 'Подпись под названием', 'Меню и тёплые встречи')}
          <div class="form-row"><label>Логотип (если не загружен — показывается название)</label><div data-logo></div></div>
          ${field('badge', 'Плашка сверху', 'Открыто 24/7')}
          <div class="form-row"><label>Приветствие</label><textarea data-g="welcome" rows="6">${esc(s.welcome)}</textarea></div>
          ${field('instagram', 'Instagram', '@your_cafe')}
          ${field('phone', 'Телефон', '+996 ...')}
          ${field('address', 'Адрес')}
          ${field('currency', 'Валюта в ценах', '₽ / сом / ₸')}
          <div class="form-row"><label>Большое фото на главной</label><div data-hero></div></div>
          <button class="btn btn-primary" id="btnSaveGuest">Сохранить</button>
          <span id="guestSaved"></span>
        </div>
        <div class="card qr-box">
          <div class="section-title">QR-код для столов</div>
          ${hosts.length > 1 ? `<div class="form-row"><select id="qrHost">${hosts.map((h) => `<option>${esc(h)}</option>`).join('')}</select></div>` : ''}
          <div id="qrImage"></div>
          <div class="qr-url" id="qrUrl"></div>
          <div class="row-actions" style="justify-content:center;">
            <a class="btn btn-ghost" id="qrOpen" target="_blank">Открыть меню</a>
            <button class="btn btn-primary" id="qrPrint">Печать</button>
          </div>
          <p class="meta" style="margin-top:14px;">Гости должны быть подключены к Wi‑Fi заведения — меню открывается с этого компьютера.</p>
        </div>
      </div>
      <div class="print-qr" id="printQr"></div>
    `;

    const getLogo = mountPhotoField(tabContent.querySelector('[data-logo]'), s.logo, { logo: true, maxSize: 800 });
    const getHero = mountPhotoField(tabContent.querySelector('[data-hero]'), s.heroImage, { maxSize: 2000 });

    function drawQr() {
      const sel = document.getElementById('qrHost');
      const menuUrl = 'http://' + (sel ? sel.value : hosts[0]) + '/menu';
      const svg = QRCode.toSvg(menuUrl);
      document.getElementById('qrImage').innerHTML = svg;
      document.getElementById('qrUrl').textContent = menuUrl;
      document.getElementById('qrOpen').href = menuUrl;
      const name = tabContent.querySelector('[data-g="name"]').value;
      document.getElementById('printQr').innerHTML =
        `<h2>${esc(name)}</h2><p>Наведите камеру, чтобы открыть меню</p>${svg}<p>${esc(menuUrl)}</p>`;
    }
    drawQr();
    const hostSel = document.getElementById('qrHost');
    if (hostSel) hostSel.addEventListener('change', drawQr);

    document.getElementById('qrPrint').addEventListener('click', () => {
      drawQr();
      document.body.classList.add('printing-qr');
      window.print();
      document.body.classList.remove('printing-qr');
    });

    document.getElementById('btnSaveGuest').addEventListener('click', async () => {
      const body = { logo: getLogo(), heroImage: getHero() };
      tabContent.querySelectorAll('[data-g]').forEach((el) => (body[el.dataset.g] = el.value));
      await Api.put('/api/admin/guest-menu', body);
      drawQr();
      document.getElementById('guestSaved').innerHTML = '<span class="badge badge-ok" style="margin-left:10px;">Сохранено</span>';
    });
  }

  // ---------- НАСТРОЙКИ ----------
  function renderSettings() {
    tabContent.innerHTML = `
      <div class="card" style="max-width:420px;">
        <div class="section-title">Сменить пароль администратора</div>
        <div class="form-row"><label>Новый пароль</label><input type="password" id="newAdminPassword" /></div>
        <button class="btn btn-primary" id="btnSavePassword">Сохранить</button>
        <div id="pwSaved"></div>
      </div>
      <div class="card" style="max-width:560px;margin-top:14px;">
        <div class="section-title">Резервная копия</div>
        <p class="meta">Меню, фото, официанты, столы и заказы — одним файлом. Скачивайте перед
          обновлением программы и время от времени храните копию на флешке или в облаке.
          Кроме того, сервер сам каждый час обновляет копию базы в папке <b>data/backups</b> (по файлу на день, 30 дней).</p>
        <div class="row-actions" style="flex-wrap:wrap;">
          <button class="btn btn-primary" id="btnBackup">Скачать копию</button>
          <label class="btn btn-ghost">Восстановить из файла
            <input type="file" id="restoreFile" accept=".json,application/json" hidden />
          </label>
        </div>
        <div id="backupStatus" style="margin-top:10px;"></div>
      </div>
    `;
    const backupStatus = document.getElementById('backupStatus');
    document.getElementById('btnBackup').addEventListener('click', async () => {
      const r = await fetch('/api/admin/backup', { headers: Api._headers(false) });
      if (!r.ok) {
        backupStatus.innerHTML = '<div class="error-msg">Не удалось сделать копию</div>';
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob());
      a.download = 'cafe-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
    });
    document.getElementById('restoreFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!confirm('Заменить все текущие данные (меню, заказы, официантов) данными из файла «' + file.name + '»?')) return;
      backupStatus.textContent = 'Восстановление…';
      try {
        await Api.post('/api/admin/restore', JSON.parse(await file.text()));
        backupStatus.innerHTML = '<span class="badge badge-ok">Данные восстановлены</span>';
      } catch (err) {
        backupStatus.innerHTML = '<div class="error-msg">Это не файл резервной копии Cafe POS</div>';
      }
    });
    document.getElementById('btnSavePassword').addEventListener('click', async () => {
      const password = document.getElementById('newAdminPassword').value;
      if (!password) return;
      await Api.put('/api/admin/password', { password });
      sessionStorage.setItem('cafepos_admin_pw', password);
      document.getElementById('pwSaved').innerHTML = '<div class="badge badge-ok" style="margin-top:10px;">Сохранено</div>';
    });
  }

  // ---------- СТАРТ ----------
  // Автовход, если пароль уже был введён в этой вкладке браузера
  const savedPw = sessionStorage.getItem('cafepos_admin_pw');
  if (savedPw) {
    Api.post('/api/login/admin', { password: savedPw })
      .then(() => {
        viewLogin.style.display = 'none';
        viewLogin.hidden = true;
        viewMain.hidden = false;
        viewMain.style.display = '';
        document.body.style.overflow = 'auto';
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        selectTab('dashboard');
      })
      .catch(() => {});
  }
})();
