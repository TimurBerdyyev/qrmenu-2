// Гостевое QR-меню: только просмотр, без заказов.
(function () {
  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  const ICONS = {
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    insta: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M4 5.5C4 4.7 4.7 4 5.5 4h2.3l1.5 4-2 1.3a11 11 0 0 0 7.4 7.4l1.3-2 4 1.5v2.3c0 .8-.7 1.5-1.5 1.5A16 16 0 0 1 4 5.5z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'
  };

  let currency = '';
  const price = (p) => Number(p).toLocaleString('ru-RU') + (currency ? ' ' + currency : '');

  function instagramLink(value) {
    if (/^https?:\/\//i.test(value)) return value;
    return 'https://instagram.com/' + encodeURIComponent(value.replace(/^@/, ''));
  }

  // ---------- Тема ----------
  function currentTheme() {
    const forced = document.documentElement.dataset.theme;
    if (forced) return forced;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function syncThemeColor() {
    document.querySelector('meta[name="theme-color"]').content = currentTheme() === 'dark' ? '#141715' : '#f2f3f1';
  }
  $('themeToggle').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('guestmenu_theme', next); } catch (e) {}
    syncThemeColor();
  });
  syncThemeColor();

  // ---------- Отрисовка ----------
  function renderHeader(s) {
    document.title = s.name ? s.name + ' — меню' : 'Меню';
    $('brand').innerHTML = s.logo
      ? `<img src="${esc(s.logo)}" alt="${esc(s.name)}" />`
      : `<span class="wordmark">${esc(s.name)}</span>` + (s.tagline ? `<span class="tagline">${esc(s.tagline)}</span>` : '');
  }

  function contactsHtml(s) {
    const parts = [];
    if (s.instagram) {
      parts.push(`<a href="${esc(instagramLink(s.instagram))}" target="_blank" rel="noopener">${ICONS.insta}${esc(s.instagram)}</a>`);
    }
    if (s.phone) {
      parts.push(`<a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${ICONS.phone}${esc(s.phone)}</a>`);
    }
    if (s.address) parts.push(`<span>${ICONS.pin}${esc(s.address)}</span>`);
    return parts.length ? `<div class="contacts">${parts.join('')}</div>` : '';
  }

  function renderHero(s, hasMenu) {
    $('hero').innerHTML = `
      ${s.badge ? `<span class="pill">${ICONS.clock}${esc(s.badge)}</span>` : ''}
      ${s.logo
        ? `<img class="hero-logo" src="${esc(s.logo)}" alt="${esc(s.name)}" />`
        : `<h1 class="hero-title">${esc(s.name)}</h1>`}
      ${s.welcome ? `<p class="hero-text">${esc(s.welcome)}</p>` : ''}
      <div class="hero-actions">
        ${hasMenu ? '<a class="btn-main" href="#menu">Открыть меню</a>' : ''}
        ${s.phone ? `<a class="btn-link" href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">Позвонить</a>` : ''}
      </div>
      ${contactsHtml(s)}
      ${s.heroImage ? `<div class="hero-photo"><img src="${esc(s.heroImage)}" alt="" /></div>` : ''}
    `;
  }

  function renderMenu(categories) {
    const nav = $('catNav');
    const menu = $('menu');
    if (categories.length === 0) {
      menu.innerHTML = '<div class="empty">Меню скоро появится</div>';
      return;
    }

    nav.innerHTML = categories
      .map((c) => `<a class="chip" href="#cat-${esc(c.id)}" data-cat="${esc(c.id)}">${esc(c.name)}<span class="count">${c.items.length}</span></a>`)
      .join('');

    let num = 0;
    menu.innerHTML = categories
      .map((c, i) => {
        const cards = c.items
          .map((it) => {
            num += 1;
            return `
              <button class="card${it.image ? '' : ' no-photo'}" data-item="${esc(it.id)}">
                ${it.image ? `<div class="card-photo"><img src="${esc(it.image)}" alt="${esc(it.name)}" loading="lazy" /></div>` : ''}
                <div class="card-body">
                  <span class="card-num">${num}</span>
                  <h3 class="card-name">${esc(it.name)}</h3>
                  ${it.description ? `<p class="card-desc clamp">${esc(it.description)}</p>` : ''}
                  <div class="card-price">${price(it.price)}</div>
                </div>
              </button>`;
          })
          .join('');
        const n = c.items.length;
        return `
          <section class="section" id="cat-${esc(c.id)}" data-cat="${esc(c.id)}">
            <div class="section-head">
              <span class="section-num">${pad2(i + 1)}</span>
              <h2 class="section-title">${esc(c.name)}</h2>
              <span class="section-count">${n} ${plural(n, 'позиция', 'позиции', 'позиций')}</span>
            </div>
            <div class="grid">${cards}</div>
          </section>`;
      })
      .join('');

    const items = {};
    categories.forEach((c) => c.items.forEach((it) => (items[it.id] = it)));
    menu.querySelectorAll('[data-item]').forEach((el) =>
      el.addEventListener('click', () => openSheet(items[el.dataset.item]))
    );

    watchActiveCategory(nav, menu);
  }

  // Подсвечиваем категорию, которую гость сейчас листает
  function watchActiveCategory(nav, menu) {
    if (!('IntersectionObserver' in window)) return;
    const chips = {};
    nav.querySelectorAll('.chip').forEach((ch) => (chips[ch.dataset.cat] = ch));
    let active = null;
    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
        const sections = [...visible].sort((a, b) => a.offsetTop - b.offsetTop);
        const id = sections.length ? sections[0].dataset.cat : null;
        if (id === active) return;
        if (active && chips[active]) chips[active].classList.remove('active');
        active = id;
        const chip = chips[id];
        if (chip) {
          chip.classList.add('active');
          nav.scrollTo({ left: chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2, behavior: 'smooth' });
        }
      },
      { rootMargin: '-80px 0px -55% 0px' }
    );
    menu.querySelectorAll('.section').forEach((s) => observer.observe(s));
  }

  // ---------- Карточка блюда ----------
  function openSheet(it) {
    $('sheetBody').innerHTML = `
      ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.name)}" />` : ''}
      <div class="sheet-body">
        <h3>${esc(it.name)}</h3>
        ${it.description ? `<p>${esc(it.description)}</p>` : ''}
        <div class="price">${price(it.price)}</div>
      </div>`;
    $('sheet').hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeSheet() {
    $('sheet').hidden = true;
    document.body.classList.remove('no-scroll');
  }
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', (e) => {
    if (e.target === $('sheet')) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  function renderFooter(s) {
    const left = esc(s.name);
    const right = [s.address, s.phone].filter(Boolean).map(esc).join(' · ');
    $('footer').innerHTML = `<span>${left}</span><span>${right}</span>`;
  }

  // ---------- Старт ----------
  fetch('/api/guest-menu')
    .then((r) => {
      if (!r.ok) throw new Error('load_failed');
      return r.json();
    })
    .then(({ settings, categories }) => {
      currency = settings.currency || '';
      renderHeader(settings);
      renderHero(settings, categories.length > 0);
      renderMenu(categories);
      renderFooter(settings);
      $('loading').remove();
    })
    .catch(() => {
      $('loading').textContent = 'Не удалось загрузить меню. Проверьте подключение к Wi‑Fi заведения и обновите страницу.';
    });
})();
