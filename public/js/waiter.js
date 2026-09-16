(function () {
  const views = {
    login: document.getElementById('view-login'),
    tables: document.getElementById('view-tables'),
    order: document.getElementById('view-order'),
    receipt: document.getElementById('view-receipt')
  };

  function showView(name) {
    Object.keys(views).forEach((k) => {
      const isVisible = k === name;
      views[k].hidden = !isVisible;
      views[k].style.display = isVisible ? '' : 'none';
    });
    document.body.style.overflow = name === 'login' ? 'hidden' : 'auto';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }

  let waiter = JSON.parse(localStorage.getItem('cafepos_waiter') || 'null');

  let menu = { categories: [], menuItems: [] };
  let tables = [];
  let openOrders = [];

  let currentTable = null;
  let currentOrder = null; // открытый заказ на сервере (или null, если ещё не создан)
  let cart = []; // { menuItemId, name, price, qty } — ещё не отправлено на кухню
  let activeCategoryId = null;
  let pollTimer = null;

  // ---------- PIN-ВХОД ----------
  let pin = '';
  const pinDots = document.getElementById('pinDots');
  const pinError = document.getElementById('pinError');

  function renderPinDots() {
    pinDots.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'pin-dot' + (i < pin.length ? ' filled' : '');
      pinDots.appendChild(d);
    }
  }

  document.getElementById('pinPad').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.d !== undefined) {
      if (pin.length < 4) pin += btn.dataset.d;
    } else if (btn.dataset.action === 'back') {
      pin = pin.slice(0, -1);
    } else if (btn.dataset.action === 'clear') {
      pin = '';
    }
    pinError.innerHTML = '';
    renderPinDots();
    if (pin.length === 4) {
      try {
        const w = await Api.post('/api/login/waiter', { pin });
        waiter = w;
        localStorage.setItem('cafepos_waiter', JSON.stringify(w));
        pin = '';
        renderPinDots();
        enterTablesView();
      } catch (err) {
        pinError.innerHTML = '<div class="error-msg">Неверный PIN-код</div>';
        pin = '';
        renderPinDots();
      }
    }
  });

  document.getElementById('btnLogout').addEventListener('click', () => {
    localStorage.removeItem('cafepos_waiter');
    waiter = null;
    showView('login');
  });

  // ---------- СТОЛЫ ----------
  async function enterTablesView() {
    document.getElementById('waiterGreeting').textContent = 'Привет, ' + waiter.name;
    showView('tables');
    await loadTables();
  }

  async function loadTables() {
    [tables, openOrders] = await Promise.all([
      Api.get('/api/tables'),
      Api.get('/api/orders?status=open')
    ]);
    const grid = document.getElementById('tablesGrid');
    grid.innerHTML = '';
    tables.forEach((t) => {
      const order = openOrders.find((o) => o.tableId === t.id);
      const tile = document.createElement('button');
      tile.className = 'card table-tile' + (order ? ' occupied' : '');
      tile.innerHTML = `<div>${t.name}</div><div class="status">${order ? money(order.total) : 'свободен'}</div>`;
      tile.addEventListener('click', () => openTable(t));
      grid.appendChild(tile);
    });
  }

  async function openTable(table) {
    currentTable = table;
    currentOrder = openOrders.find((o) => o.tableId === table.id) || null;
    cart = [];
    menu = await Api.get('/api/menu');
    activeCategoryId = menu.categories[0] ? menu.categories[0].id : null;
    document.getElementById('orderTableTitle').textContent = table.name;
    document.getElementById('orderWaiterSub').textContent = 'Официант: ' + waiter.name;
    renderCategoryTabs();
    renderMenuGrid();
    renderCart();
    renderSubmitted();
    showView('order');
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshCurrentOrder, 4000);
  }

  document.getElementById('btnBackToTables').addEventListener('click', async () => {
    if (pollTimer) clearInterval(pollTimer);
    showView('tables');
    await loadTables();
  });

  // ---------- МЕНЮ / КОРЗИНА ----------
  function renderCategoryTabs() {
    const wrap = document.getElementById('categoryTabs');
    wrap.innerHTML = '';
    menu.categories
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((c) => {
        const tab = document.createElement('button');
        tab.className = 'category-tab' + (c.id === activeCategoryId ? ' active' : '');
        tab.textContent = c.name;
        tab.addEventListener('click', () => {
          activeCategoryId = c.id;
          renderCategoryTabs();
          renderMenuGrid();
        });
        wrap.appendChild(tab);
      });
  }

  function renderMenuGrid() {
    const grid = document.getElementById('menuGrid');
    grid.innerHTML = '';
    menu.menuItems
      .filter((mi) => mi.categoryId === activeCategoryId)
      .forEach((mi) => {
        const btn = document.createElement('button');
        btn.className = 'card menu-item';
        btn.disabled = !mi.available;
        btn.innerHTML = `<span class="name">${mi.name}</span><span class="price">${money(mi.price)}</span>`;
        btn.addEventListener('click', () => addToCart(mi));
        grid.appendChild(btn);
      });
    if (!menu.menuItems.some((mi) => mi.categoryId === activeCategoryId)) {
      grid.innerHTML = '<div class="empty-state">В этой категории пока пусто</div>';
    }
  }

  function addToCart(menuItem) {
    const line = cart.find((c) => c.menuItemId === menuItem.id);
    if (line) line.qty += 1;
    else cart.push({ menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, qty: 1 });
    renderCart();
  }

  function changeQty(menuItemId, delta) {
    const line = cart.find((c) => c.menuItemId === menuItemId);
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) cart = cart.filter((c) => c.menuItemId !== menuItemId);
    renderCart();
  }

  function renderCart() {
    const wrap = document.getElementById('cartLines');
    wrap.innerHTML = '';
    let total = 0;
    cart.forEach((c) => {
      total += c.price * c.qty;
      const row = document.createElement('div');
      row.className = 'order-line';
      row.innerHTML = `
        <span>${c.name}</span>
        <span class="qty-controls">
          <button class="qty-btn" data-a="-1">−</button>
          <span>${c.qty}</span>
          <button class="qty-btn" data-a="1">+</button>
        </span>`;
      row.querySelectorAll('.qty-btn').forEach((b) =>
        b.addEventListener('click', () => changeQty(c.menuItemId, parseInt(b.dataset.a, 10)))
      );
      wrap.appendChild(row);
    });
    document.getElementById('cartTotal').textContent = money(total);
    document.getElementById('btnSubmitCart').disabled = cart.length === 0;
  }

  document.getElementById('btnSubmitCart').addEventListener('click', async () => {
    if (cart.length === 0) return;
    const btn = document.getElementById('btnSubmitCart');
    btn.disabled = true;
    try {
      const order = await Api.post('/api/orders', {
        waiterId: waiter.id,
        waiterName: waiter.name,
        tableId: currentTable.id,
        items: cart.map((c) => ({ menuItemId: c.menuItemId, qty: c.qty }))
      });
      currentOrder = order;
      cart = [];
      renderCart();
      renderSubmitted();
    } catch (e) {
      alert('Не удалось отправить заказ: ' + e.message);
      btn.disabled = false;
    }
  });

  function renderSubmitted() {
    const block = document.getElementById('submittedBlock');
    const list = document.getElementById('submittedList');
    const closeBtn = document.getElementById('btnCloseOrder');
    if (!currentOrder || currentOrder.items.length === 0) {
      block.hidden = true;
      return;
    }

    const allReady = currentOrder.items.every((it) => it.status === 'ready');
    block.hidden = false;
    closeBtn.hidden = !allReady;
    list.innerHTML = '';
    currentOrder.items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'row';
      const badge = it.status === 'ready'
        ? '<span class="badge badge-ok">готово к выдаче</span>'
        : '<span class="badge badge-warn">готовится</span>';
      row.innerHTML = `<span>${it.name} × ${it.qty}</span>${badge}`;
      list.appendChild(row);
    });
  }

  async function refreshCurrentOrder() {
    if (!currentOrder) return;
    try {
      currentOrder = await Api.get('/api/orders/' + currentOrder.id);
      renderSubmitted();
    } catch (e) {
      // заказ мог быть закрыт с другого устройства — просто игнорируем тик
    }
  }

  document.getElementById('btnCloseOrder').addEventListener('click', async () => {
    if (!currentOrder) return;
    if (!confirm('Закрыть заказ и пробить чек на ' + money(currentOrder.total) + '?')) return;
    const closed = await Api.post('/api/orders/' + currentOrder.id + '/close');
    if (pollTimer) clearInterval(pollTimer);
    showReceipt(closed);
  });

  // ---------- ЧЕК ----------
  function showReceipt(order) {
    const body = document.getElementById('receiptBody');
    const rows = order.items
      .map((it) => `<div class="line"><span>${it.name} × ${it.qty}</span><span>${money(it.price * it.qty)}</span></div>`)
      .join('');
    body.innerHTML = `
      <h2>☕ Cafe POS</h2>
      <div class="line"><span>Стол</span><span>${order.tableName}</span></div>
      <div class="line"><span>Официант</span><span>${order.waiterName}</span></div>
      <div class="line"><span>Дата</span><span>${new Date(order.closedAt).toLocaleString('ru-RU')}</span></div>
      <hr/>
      ${rows}
      <hr/>
      <div class="line total-line"><span>ИТОГО</span><span>${money(order.total)}</span></div>
    `;
    showView('receipt');
  }

  document.getElementById('btnPrint').addEventListener('click', () => window.print());
  document.getElementById('btnReceiptBack').addEventListener('click', async () => {
    showView('tables');
    await loadTables();
  });

  // ---------- СТАРТ ----------
  renderPinDots();
  if (waiter) enterTablesView();
  else showView('login');
})();
