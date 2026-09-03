/**
 * App — Главный контроллер интерфейса и навигации платформы
 */
class App {
  constructor() {
    this.currentTab = 'storefront';
  }

  init() {
    this.bindGlobalEvents();
    this.renderRoleSwitcher();
    this.renderUserHeader();
    this.renderStorefront();
    this.setupModals();

    // Слушатель смены роли
    window.auth.onChange((role, user) => {
      this.renderRoleSwitcher();
      this.renderUserHeader();
      this.renderStorefront();
      this.handleRoleVisibility(role);
    });

    // Инициализация сервисов
    if (window.admin) window.admin.init();

    // Проверка хэша URL для роутинга
    this.handleRouting();
    window.addEventListener('hashchange', () => this.handleRouting());
  }

  bindGlobalEvents() {
    // Табы навигации в шапке
    document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = link.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // Кнопка пополнения Орбов в шапке
    const topupBtn = document.getElementById('header-topup-btn');
    if (topupBtn) {
      topupBtn.addEventListener('click', () => this.showTopupModal());
    }

    // Клавиша Escape закрывает модальные окна
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAllModals();
        if (window.reader) window.reader.closeReader();
      }
    });
  }

  handleRouting() {
    const hash = window.location.hash.replace('#', '');
    if (['storefront', 'purchases', 'admin'].includes(hash)) {
      if (hash === 'admin' && !window.auth.isAdmin()) {
        this.switchTab('storefront');
        this.showToast('Вкладка доступна только в роли Администратора', 'warning');
      } else {
        this.switchTab(hash);
      }
    }
  }

  switchTab(tabName) {
    if (tabName === 'admin' && !window.auth.isAdmin()) {
      this.showToast('Панель администратора доступна только Администраторам', 'error');
      return;
    }

    this.currentTab = tabName;
    window.location.hash = tabName;

    // Обновление активных классов на ссылках
    document.querySelectorAll('.nav-link[data-tab]').forEach(l => {
      l.classList.toggle('active', l.getAttribute('data-tab') === tabName);
    });

    // Скрытие/показ секций
    document.querySelectorAll('.app-section').forEach(sec => {
      sec.style.display = 'none';
    });

    const activeSec = document.getElementById(`section-${tabName}`);
    if (activeSec) {
      activeSec.style.display = 'block';
    }

    if (tabName === 'purchases') {
      this.renderPurchases();
    } else if (tabName === 'admin') {
      if (window.admin) window.admin.renderWorksTable();
    } else {
      this.renderStorefront();
    }
  }

  handleRoleVisibility(role) {
    const adminNavLink = document.getElementById('nav-admin-link');
    if (adminNavLink) {
      adminNavLink.style.display = role === 'admin' ? 'flex' : 'none';
    }

    if (this.currentTab === 'admin' && role !== 'admin') {
      this.switchTab('storefront');
    }
  }

  /**
   * Рендер переключателя ролей для удобного тестирования
   */
  renderRoleSwitcher() {
    const container = document.getElementById('role-switcher-container');
    if (!container) return;

    const currentRole = window.auth.getRole();
    container.innerHTML = `
      <div class="role-pill-group" title="Переключение режима для тестирования сценариев прототипа">
        <button class="role-btn ${currentRole === 'guest' ? 'active' : ''}" onclick="window.app.switchRole('guest')">
          👤 Гость
        </button>
        <button class="role-btn ${currentRole === 'user' ? 'active' : ''}" onclick="window.app.switchRole('user')">
          🛡️ Пользователь
        </button>
        <button class="role-btn ${currentRole === 'admin' ? 'active' : ''}" onclick="window.app.switchRole('admin')">
          👑 Админ
        </button>
      </div>
    `;
  }

  switchRole(role) {
    window.auth.setRole(role);
    this.showToast(`Режим переключен: ${role === 'guest' ? 'Гость' : role === 'user' ? 'Зарегистрированный пользователь' : 'Администратор'}`, 'info');
  }

  /**
   * Шапка пользователя (баланс Орбов, аватар/вход)
   */
  renderUserHeader() {
    const balancePill = document.getElementById('header-balance-pill');
    const userAuthBlock = document.getElementById('header-user-block');
    const isGuest = window.auth.isGuest();
    const user = window.auth.getUser();

    if (balancePill) {
      if (isGuest) {
        balancePill.style.display = 'none';
      } else {
        balancePill.style.display = 'flex';
        const orbVal = document.getElementById('header-orbs-count');
        if (orbVal) {
          orbVal.textContent = (user.orbs || 0).toFixed(2);
        }
      }
    }

    if (userAuthBlock) {
      if (isGuest) {
        userAuthBlock.innerHTML = `
          <button class="btn btn-secondary btn-small" onclick="window.app.showAuthModal()">🔑 Войти</button>
        `;
      } else {
        userAuthBlock.innerHTML = `
          <div class="user-badge" title="${user.email}">
            <div class="user-avatar">${(user.name || 'U')[0].toUpperCase()}</div>
            <span class="user-name">${user.name.split(' ')[0]}</span>
          </div>
        `;
      }
    }
  }

  /**
   * Рендер каталога на главной витрине
   */
  renderStorefront() {
    const container = document.getElementById('storefront-grid');
    if (!container) return;

    const works = window.store.getWorks();
    const isGuest = window.auth.isGuest();

    if (works.length === 0) {
      container.innerHTML = `<div class="empty-state"><h3>Каталог пуст</h3><p>Администратор еще не добавил ни одной работы.</p></div>`;
      return;
    }

    container.innerHTML = works.map(work => {
      const isPurchased = window.store.hasPurchased(work.id);

      return `
        <article class="work-card">
          <div class="work-card-media">
            <img src="${work.coverUrl}" alt="${work.title}" class="work-cover-img" onerror="this.src='assets/demo/cover-1.svg'">
            <div class="work-badge-overlay">
              <span class="badge badge-accent">💎 ${work.price} Орб ($${work.price})</span>
              <span class="badge badge-glass">👁️ ${work.previewPagesCount} стр. бесплатно</span>
            </div>
          </div>
          <div class="work-card-body">
            <div class="work-tags">
              ${(work.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('')}
            </div>
            <h3 class="work-title" title="${work.title}">${work.title}</h3>
            ${work.originalTitle ? `<div class="work-subtitle">${work.originalTitle}</div>` : ''}
            <p class="work-desc">${work.description || 'Описание отсутствует'}</p>
            <div class="work-meta-row">
              <span>✍️ ${work.author}</span>
              <span>📄 Всего: ${work.totalPages} стр.</span>
            </div>
          </div>
          <div class="work-card-footer">
            <button class="btn btn-secondary" onclick="window.reader.openPreview('${work.id}')" title="Посмотреть первые ${work.previewPagesCount} стр. бесплатно">
              👁️ Превью
            </button>
            ${isPurchased ? `
              <button class="btn btn-success" onclick="window.reader.openFullTranslationModal('${work.id}')">
                📖 Читать перевод
              </button>
            ` : isGuest ? `
              <button class="btn btn-accent" onclick="window.app.showAuthModal()">
                ⚡ Купить за ${work.price} Орб
              </button>
            ` : `
              <button class="btn btn-accent" onclick="window.app.handlePurchaseWork('${work.id}')">
                ⚡ Купить за ${work.price} Орб
              </button>
            `}
          </div>
        </article>
      `;
    }).join('');
  }

  /**
   * Рендер раздела «Мои покупки»
   */
  renderPurchases() {
    const container = document.getElementById('purchases-grid');
    if (!container) return;

    const allWorks = window.store.getWorks();
    const purchased = allWorks.filter(w => window.store.hasPurchased(w.id));

    if (purchased.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 4rem 1rem;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📚</div>
          <h3>У вас пока нет купленных переводов</h3>
          <p>Перейдите в каталог, чтобы ознакомиться с доступными работами и бесплатными превью.</p>
          <button class="btn btn-accent" onclick="window.app.switchTab('storefront')" style="margin-top: 1rem;">Перейти в каталог</button>
        </div>
      `;
      return;
    }

    container.innerHTML = purchased.map(work => `
      <article class="work-card">
        <div class="work-card-media">
          <img src="${work.coverUrl}" alt="${work.title}" class="work-cover-img" onerror="this.src='assets/demo/cover-1.svg'">
          <div class="work-badge-overlay">
            <span class="badge badge-success">✓ Доступ открыт</span>
          </div>
        </div>
        <div class="work-card-body">
          <h3 class="work-title">${work.title}</h3>
          <p class="work-desc">${work.description}</p>
        </div>
        <div class="work-card-footer">
          <button class="btn btn-secondary" onclick="window.reader.openPreview('${work.id}')">👁️ Превью</button>
          <button class="btn btn-accent" onclick="window.reader.openFullTranslationModal('${work.id}')">📖 Читать перевод</button>
        </div>
      </article>
    `).join('');
  }

  /**
   * Обработка покупки работы
   */
  handlePurchaseWork(workId) {
    if (window.auth.isGuest()) {
      this.showAuthModal();
      return;
    }

    const work = window.store.getWorkById(workId);
    if (!work) return;

    const result = window.store.purchaseWork(workId);

    if (result.success) {
      this.showToast(`Успешно! Вы приобрели перевод "${work.title}"`, 'success');
      this.renderUserHeader();
      this.renderStorefront();
      // Сразу предлагаем открыть читалку
      window.reader.openFullTranslationModal(workId);
    } else {
      // Недостаточно Орбов
      this.showInsufficientOrbsModal(work, result.needOrbs);
    }
  }

  showInsufficientOrbsModal(work, needOrbs) {
    const modal = document.getElementById('generic-modal');
    const modalTitle = document.getElementById('generic-modal-title');
    const modalBody = document.getElementById('generic-modal-body');

    modalTitle.textContent = 'Недостаточно Орбов';
    modalBody.innerHTML = `
      <div style="text-align: center; padding: 1rem 0;">
        <div style="font-size: 3rem; margin-bottom: 0.5rem;">🪙</div>
        <p>Для покупки перевода <strong>"${work.title}"</strong> необходимо <strong>${work.price} Орб</strong>.</p>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem;">
          Вам не хватает: <span style="color: var(--accent-gold); font-weight: 700;">${needOrbs} Орб (${needOrbs} USDT)</span>
        </p>
        <div style="margin-top: 1.5rem; display: flex; gap: 8px; justify-content: center;">
          <button class="btn btn-secondary" onclick="window.app.closeAllModals()">Отмена</button>
          <button class="btn btn-accent" onclick="window.app.closeAllModals(); window.app.showTopupModal(${needOrbs})">
            ➕ Пополнить баланс
          </button>
        </div>
      </div>
    `;
    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  /**
   * Модальное окно пополнения через xPub USDT
   */
  showTopupModal(defaultAmount = 5) {
    const modal = document.getElementById('topup-modal');
    if (!modal) return;

    const amountInput = document.getElementById('topup-amount-input');
    if (amountInput) amountInput.value = Math.max(1, defaultAmount);

    this.renderTopupInvoice();
    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  renderTopupInvoice() {
    const amountInput = document.getElementById('topup-amount-input');
    const networkSelect = document.getElementById('topup-network-select');
    const orbsAmount = Number(amountInput ? amountInput.value : 5) || 5;
    const network = networkSelect ? networkSelect.value : 'USDT (TRC-20)';

    try {
      const invoice = window.cryptoPay.createInvoice(orbsAmount, network);
      
      document.getElementById('invoice-order-id').textContent = invoice.orderId;
      document.getElementById('invoice-amount-usdt').textContent = `${invoice.usdtAmount} USDT`;
      document.getElementById('invoice-amount-orbs').textContent = `${invoice.orbsAmount} Орб`;
      document.getElementById('invoice-network').textContent = invoice.network;
      document.getElementById('invoice-address').value = invoice.address;
      document.getElementById('invoice-derivation-path').textContent = invoice.derivationPath;

      // Рендер QR-кода на canvas
      const canvas = document.getElementById('invoice-qr-canvas');
      if (canvas) {
        window.cryptoPay.renderQRCodeToCanvas(canvas, invoice.address);
      }
    } catch (e) {
      this.showToast(e.message, 'error');
    }
  }

  copyInvoiceAddress() {
    const addressInput = document.getElementById('invoice-address');
    if (addressInput) {
      navigator.clipboard.writeText(addressInput.value);
      this.showToast('Адрес кошелька скопирован в буфер обмена', 'success');
    }
  }

  confirmPaymentTest() {
    const result = window.cryptoPay.confirmPaymentSimulation();
    if (result.success) {
      this.showToast(`🎉 Получено ${result.amount} USDT! Баланс: ${result.newBalance} Орб`, 'success');
      this.closeAllModals();
      this.renderUserHeader();
      this.renderStorefront();
    } else {
      this.showToast(result.message, 'error');
    }
  }

  /**
   * Модальное окно загрузки архива (.zip) для купленного перевода
   */
  showArchiveUploadModal(work) {
    const modal = document.getElementById('archive-upload-modal');
    if (!modal) return;

    document.getElementById('archive-work-title').textContent = work.title;
    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  /**
   * Модальное окно выбора языка из скрипта
   */
  showLanguageSelectModal(languages, onSelectCallback) {
    this.closeAllModals();
    const modal = document.getElementById('generic-modal');
    const modalTitle = document.getElementById('generic-modal-title');
    const modalBody = document.getElementById('generic-modal-body');

    modalTitle.textContent = '🌐 Выберите язык перевода';
    modalBody.innerHTML = `
      <p style="margin-bottom: 1rem; color: var(--text-secondary);">
        В скрипте перевода обнаружено несколько доступных языковых локализаций. Выберите желаемый язык для чтения:
      </p>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${languages.map(lang => `
          <button class="btn btn-secondary btn-large" style="justify-content: flex-start; text-align: left;" onclick="window.app.selectLanguageAndClose('${lang}')">
            🗣️ <strong>${lang}</strong>
          </button>
        `).join('')}
      </div>
    `;

    window.app._onLangSelect = onSelectCallback;
    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  selectLanguageAndClose(lang) {
    this.closeAllModals();
    if (window.app._onLangSelect) {
      window.app._onLangSelect(lang);
    }
  }

  /**
   * Модальное окно быстрой регистрации / входа
   */
  showAuthModal() {
    const modal = document.getElementById('generic-modal');
    const modalTitle = document.getElementById('generic-modal-title');
    const modalBody = document.getElementById('generic-modal-body');

    modalTitle.textContent = '🔑 Вход / Регистрация';
    modalBody.innerHTML = `
      <form onsubmit="event.preventDefault(); window.app.handleAuthSubmit(event)">
        <div class="form-group" style="margin-bottom: 1rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Ваше имя / Никнейм</label>
          <input type="text" id="auth-name-input" class="input-styled" required placeholder="Например: Иван" value="Александр">
        </div>
        <div class="form-group" style="margin-bottom: 1.5rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Email</label>
          <input type="email" id="auth-email-input" class="input-styled" required placeholder="reader@example.com" value="reader@example.com">
        </div>
        <button type="submit" class="btn btn-accent btn-large" style="width: 100%;">
          Продолжить как Пользователь
        </button>
      </form>
    `;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  handleAuthSubmit(e) {
    const name = document.getElementById('auth-name-input').value;
    const email = document.getElementById('auth-email-input').value;
    window.auth.registerDemoUser(name, email);
    this.closeAllModals();
    this.showToast(`Добро пожаловать, ${name}!`, 'success');
  }

  setupModals() {
    // Клики по фону модалок закрывают их
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          this.closeAllModals();
        }
      });
    });

    // Кнопки крестика
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => this.closeAllModals());
    });

    // Drag & drop для архива
    const dropZone = document.getElementById('archive-dropzone');
    const fileInput = document.getElementById('archive-file-input');

    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
          this.handleArchiveFile(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.handleArchiveFile(e.target.files[0]);
        }
      });
    }
  }

  async handleArchiveFile(file) {
    try {
      this.showToast('Распаковка и чтение архива...', 'info');
      await window.reader.loadUserZipFile(file);
      this.closeAllModals();
    } catch (err) {
      this.showToast(err.message || 'Ошибка чтения архива', 'error');
    }
  }

  useDemoArchive() {
    this.closeAllModals();
    this.showToast('Загружены демонстрационные сцены', 'info');
    window.reader.loadDemoImages();
  }

  closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
    document.body.classList.remove('modal-open');
  }

  /**
   * Тост-уведомления
   */
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-text">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

window.app = new App();
document.addEventListener('DOMContentLoaded', () => window.app.init());
