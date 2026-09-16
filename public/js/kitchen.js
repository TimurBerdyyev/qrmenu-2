(function () {
  const board = document.getElementById('kitchenBoard');
  const emptyState = document.getElementById('emptyState');

  function minutesAgo(iso) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return mins === 0 ? 'только что' : mins + ' мин назад';
  }

  async function toggleItem(orderId, item, btn) {
    btn.disabled = true;
    const newStatus = item.status === 'ready' ? 'cooking' : 'ready';
    try {
      await Api.patch(`/api/orders/${orderId}/items/${item.id}`, { status: newStatus });
      await load();
    } catch (e) {
      btn.disabled = false;
    }
  }

  function renderOrder(order) {
    const card = document.createElement('div');
    card.className = 'card kitchen-order';
    const header = document.createElement('div');
    header.innerHTML = `
      <div class="table-name">${order.tableName}</div>
      <div class="time">Официант: ${order.waiterName} · ${minutesAgo(order.createdAt)}</div>
      <hr style="border:none;border-top:1px solid var(--border);margin:10px 0;"/>
    `;
    card.appendChild(header);

    order.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'kitchen-item';
      const left = document.createElement('div');
      left.innerHTML = `<div class="name">${item.name}</div><div class="qty">× ${item.qty}</div>`;
      const btn = document.createElement('button');
      btn.className = 'ready-toggle' + (item.status === 'ready' ? ' is-ready' : '');
      btn.textContent = item.status === 'ready' ? 'Готово к выдаче' : 'В работе';
      btn.addEventListener('click', () => toggleItem(order.id, item, btn));
      row.appendChild(left);
      row.appendChild(btn);
      card.appendChild(row);
    });

    const allReady = order.items.every((item) => item.status === 'ready');
    if (allReady) {
      const readyBtn = document.createElement('button');
      readyBtn.className = 'btn btn-primary btn-block';
      readyBtn.style.marginTop = '12px';
      readyBtn.textContent = 'Заказ готов к выдаче';
      readyBtn.disabled = true;
      card.appendChild(readyBtn);
    }

    return card;
  }

  async function load() {
    try {
      const orders = await Api.get('/api/orders?status=open');
      const visibleOrders = orders
        .filter((order) => (order.items || []).some((item) => item.status !== 'ready'))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      board.innerHTML = '';
      if (visibleOrders.length === 0) {
        emptyState.hidden = false;
      } else {
        emptyState.hidden = true;
        visibleOrders.forEach((o) => board.appendChild(renderOrder(o)));
      }
    } catch (e) {
      // при обрыве связи просто попробуем на следующем тике
    }
  }

  function tickClock() {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString('ru-RU');
  }

  tickClock();
  setInterval(tickClock, 1000);
  load();
  setInterval(load, 3000);
})();
