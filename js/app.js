/**
 * App — Главный контроллер интерфейса и навигации платформы
 * Полная поддержка мультиязычности (RU / EN) и взаимодействия с i18n
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

    // Применение локализации интерфейса
    if (window.i18n) window.i18n.applyTranslations();

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

    // Переключатели языка сайта (RU / EN)
    const btnRu = document.getElementById('lang-btn-ru');
    const btnEn = document.getElementById('lang-btn-en');
    if (btnRu) {
      btnRu.addEventListener('click', () => {
        if (window.i18n) window.i18n.setLang('ru');
      });
    }
    if (btnEn) {
      btnEn.addEventListener('click', () => {
        if (window.i18n) window.i18n.setLang('en');
      });
    }

    // Клавиатурная навигация в читалке и закрытие окон по Escape
    document.addEventListener('keydown', (e) => {
      const readerModal = document.getElementById('reader-modal');
      if (readerModal && readerModal.classList.contains('active')) {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter' || e.key === 'PageDown') {
          e.preventDefault();
          window.reader.nextPage();
          return;
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
          e.preventDefault();
          window.reader.prevPage();
          return;
        }
      }

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
        this.showToast(window.i18n ? window.i18n.t('section_admin_sub') : 'Доступно только в роли Администратора', 'warning');
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
    const guestLbl = window.i18n ? window.i18n.t('role_guest') : '👤 Гость';
    const userLbl = window.i18n ? window.i18n.t('role_user') : '🛡️ Пользователь';
    const adminLbl = window.i18n ? window.i18n.t('role_admin') : '👑 Админ';

    container.innerHTML = `
      <div class="role-pill-group" title="Переключение режима для тестирования сценариев прототипа">
        <button class="role-btn ${currentRole === 'guest' ? 'active' : ''}" onclick="window.app.switchRole('guest')">
          ${guestLbl}
        </button>
        <button class="role-btn ${currentRole === 'user' ? 'active' : ''}" onclick="window.app.switchRole('user')">
          ${userLbl}
        </button>
        <button class="role-btn ${currentRole === 'admin' ? 'active' : ''}" onclick="window.app.switchRole('admin')">
          ${adminLbl}
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
        const loginText = window.i18n ? window.i18n.t('btn_login') : '🔑 Войти';
        userAuthBlock.innerHTML = `
          <button class="btn btn-secondary btn-small" onclick="window.app.showAuthModal()">${loginText}</button>
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
   * Рендер каталога на главной витрине (с учетом выбранного языка RU / EN)
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
      const title = window.i18n ? window.i18n.getWorkTitle(work) : (work.title.ru || work.title);
      const desc = window.i18n ? window.i18n.getWorkDesc(work) : (work.description.ru || work.description);

      const previewBtnTxt = window.i18n ? window.i18n.t('card_btn_preview') : '👁️ Превью';
      const readBtnTxt = window.i18n ? window.i18n.t('card_btn_read') : '📖 Читать перевод';
      const buyBtnTxt = window.i18n ? `${window.i18n.t('card_btn_buy')} ${work.price} Орб` : `⚡ Купить за ${work.price} Орб`;
      const loginBuyTxt = window.i18n ? window.i18n.t('card_btn_login_to_buy') : '🔑 Войти для покупки';
      const freePagesTxt = window.i18n ? `${work.previewPagesCount} ${window.i18n.t('card_preview_free')}` : `${work.previewPagesCount} стр. бесплатно`;
      const totalTxt = window.i18n ? `${window.i18n.t('card_total_pages')} ${work.totalPages}` : `Всего: ${work.totalPages} стр.`;

      return `
        <article class="work-card">
          <div class="work-card-media">
            <div class="work-cover-backdrop" style="background-image: url('${work.coverUrl || 'assets/demo/cover-1.svg'}');"></div>
            <img src="${work.coverUrl || 'assets/demo/cover-1.svg'}" alt="${title}" class="work-cover-img" onerror="this.src='assets/demo/cover-1.svg'; if(this.previousElementSibling) this.previousElementSibling.style.backgroundImage='url(assets/demo/cover-1.svg)';">
            <div class="work-badge-overlay">
              <span class="badge badge-accent">💎 ${work.price} Орб ($${work.price})</span>
              <span class="badge badge-glass">👁️ ${freePagesTxt}</span>
            </div>
          </div>
          <div class="work-card-body">
            <div class="work-tags">
              ${(work.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('')}
            </div>
            <h3 class="work-title" title="${title}">${title}</h3>
            <p class="work-desc">${desc || ''}</p>
            <div class="work-meta-row">
              <span>✍️ ${work.author}</span>
              <span>📄 ${totalTxt}</span>
            </div>
          </div>
          <div class="work-card-footer">
            <button class="btn btn-secondary" onclick="window.reader.openPreview('${work.id}')" title="${previewBtnTxt}">
              ${previewBtnTxt}
            </button>
            ${isPurchased ? `
              <button class="btn btn-success" onclick="window.reader.openFullTranslationModal('${work.id}')">
                ${readBtnTxt}
              </button>
            ` : isGuest ? `
              <button class="btn btn-accent" onclick="window.app.showAuthModal()">
                ${loginBuyTxt}
              </button>
            ` : `
              <button class="btn btn-accent" onclick="window.app.handlePurchaseWork('${work.id}')">
                ${buyBtnTxt}
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
        <div class="empty-state" style="grid-column: 1 / -1; padding: 4rem 1rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📚</div>
          <h3>${window.i18n && window.i18n.getLang() === 'en' ? 'You have no unlocked translations yet' : 'У вас пока нет купленных переводов'}</h3>
          <p style="color: var(--text-muted);">${window.i18n && window.i18n.getLang() === 'en' ? 'Explore the catalog to read free previews and unlock full adaptations.' : 'Перейдите в каталог, чтобы ознакомиться с доступными работами и бесплатными превью.'}</p>
          <button class="btn btn-accent" onclick="window.app.switchTab('storefront')" style="margin-top: 1rem;">
            ${window.i18n && window.i18n.getLang() === 'en' ? 'Go to Catalog' : 'Перейти в каталог'}
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = purchased.map(work => {
      const title = window.i18n ? window.i18n.getWorkTitle(work) : (work.title.ru || work.title);
      const desc = window.i18n ? window.i18n.getWorkDesc(work) : (work.description.ru || work.description);
      const previewBtnTxt = window.i18n ? window.i18n.t('card_btn_preview') : '👁️ Превью';
      const readBtnTxt = window.i18n ? window.i18n.t('card_btn_read') : '📖 Читать перевод';
      const accessTxt = window.i18n ? window.i18n.t('card_access_granted') : '✓ Доступ открыт';

      return `
        <article class="work-card">
          <div class="work-card-media">
            <div class="work-cover-backdrop" style="background-image: url('${work.coverUrl || 'assets/demo/cover-1.svg'}');"></div>
            <img src="${work.coverUrl || 'assets/demo/cover-1.svg'}" alt="${title}" class="work-cover-img" onerror="this.src='assets/demo/cover-1.svg'; if(this.previousElementSibling) this.previousElementSibling.style.backgroundImage='url(assets/demo/cover-1.svg)';">
            <div class="work-badge-overlay">
              <span class="badge badge-success">${accessTxt}</span>
            </div>
          </div>
          <div class="work-card-body">
            <h3 class="work-title">${title}</h3>
            <p class="work-desc">${desc}</p>
          </div>
          <div class="work-card-footer">
            <button class="btn btn-secondary" onclick="window.reader.openPreview('${work.id}')">${previewBtnTxt}</button>
            <button class="btn btn-accent" onclick="window.reader.openFullTranslationModal('${work.id}')">${readBtnTxt}</button>
          </div>
        </article>
      `;
    }).join('');
  }

  /**
   * Обработка покупки работы
   */
  handlePurchaseWork(workId, fromInsideReader = false) {
    if (window.auth.isGuest()) {
      this.showAuthModal();
      return;
    }

    const work = window.store.getWorkById(workId);
    if (!work) return;

    const result = window.store.purchaseWork(workId);
    const title = window.i18n ? window.i18n.getWorkTitle(work) : work.title;

    if (result.success) {
      this.showToast(`Успешно! Вы приобрели перевод "${title}"`, 'success');
      this.renderUserHeader();
      this.renderStorefront();

      if (fromInsideReader && window.reader) {
        window.reader.unlockFullReading();
      } else {
        window.reader.openFullTranslationModal(workId);
      }
    } else {
      // Недостаточно Орбов
      this.showInsufficientOrbsModal(work, result.needOrbs);
    }
  }

  showInsufficientOrbsModal(work, needOrbs) {
    const modal = document.getElementById('generic-modal');
    const modalTitle = document.getElementById('generic-modal-title');
    const modalBody = document.getElementById('generic-modal-body');
    const title = window.i18n ? window.i18n.getWorkTitle(work) : work.title;

    modalTitle.textContent = window.i18n && window.i18n.getLang() === 'en' ? 'Insufficient Orbs' : 'Недостаточно Орбов';
    modalBody.innerHTML = `
      <div style="text-align: center; padding: 1rem 0;">
        <div style="font-size: 3rem; margin-bottom: 0.5rem;">🪙</div>
        <p>${window.i18n && window.i18n.getLang() === 'en' ? `To purchase translation <strong>"${title}"</strong>, you need <strong>${work.price} Orb</strong>.` : `Для покупки перевода <strong>"${title}"</strong> необходимо <strong>${work.price} Орб</strong>.`}</p>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem;">
          ${window.i18n && window.i18n.getLang() === 'en' ? 'Missing balance:' : 'Вам не хватает:'} <span style="color: var(--accent-gold); font-weight: 700;">${needOrbs} Орб (${needOrbs} USDT)</span>
        </p>
        <div style="margin-top: 1.5rem; display: flex; gap: 8px; justify-content: center;">
          <button class="btn btn-secondary" onclick="window.app.closeAllModals()">${window.i18n && window.i18n.getLang() === 'en' ? 'Cancel' : 'Отмена'}</button>
          <button class="btn btn-accent" onclick="window.app.closeAllModals(); window.app.showTopupModal(${needOrbs})">
            ${window.i18n && window.i18n.getLang() === 'en' ? '➕ Deposit Balance' : '➕ Пополнить баланс'}
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
      this.showToast(window.i18n && window.i18n.getLang() === 'en' ? 'Wallet address copied to clipboard' : 'Адрес кошелька скопирован в буфер обмена', 'success');
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
   * Модальное окно загрузки архива (.zip) или папки с графикой
   * Поддерживает режимы: preview (бесплатный предпросмотр N страниц) и full (полное чтение)
   */
  showArchiveUploadModal(work, mode = 'preview') {
    const modal = document.getElementById('archive-upload-modal');
    if (!modal) return;

    const title = window.i18n ? window.i18n.getWorkTitle(work) : work.title;
    const prefixEl = document.getElementById('archive-modal-title-prefix');
    const descEl = document.getElementById('archive-modal-desc');
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    document.getElementById('archive-work-title').textContent = title;

    if (mode === 'preview') {
      if (prefixEl) prefixEl.textContent = isEn ? '👁️ Free Preview:' : '👁️ Бесплатное превью:';
      if (descEl) descEl.textContent = isEn
        ? `To preview the first ${work.previewPagesCount || 3} pages with live translation overlay, select your official archive (.zip) or graphics folder. The reader will apply translations directly in your browser.`
        : `Для просмотра первых ${work.previewPagesCount || 3} страниц с наложением перевода выберите официальный архив (.zip) или папку с графикой. Читалка наложит адаптированный текст поверх оригинальных иллюстраций прямо в браузере.`;
    } else {
      if (prefixEl) prefixEl.textContent = isEn ? '📖 Launch Translation:' : '📖 Открытие перевода:';
      if (descEl) descEl.textContent = isEn
        ? `You own this translation script. To begin reading with full text overlays, select your official archive (.zip) or graphics folder.`
        : `Вы приобрели доступ к переводу. Чтобы начать чтение новеллы с полным наложением текста, выберите официальный архив (.zip) или папку с графикой.`;
    }

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

    // Drag & drop для архива и папок
    const dropZone = document.getElementById('archive-dropzone');
    const fileInput = document.getElementById('archive-file-input');
    const folderInput = document.getElementById('archive-folder-input');

    if (dropZone) {
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
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const files = e.dataTransfer.files;
          if (files.length === 1 && (files[0].name.toLowerCase().endsWith('.zip') || files[0].name.toLowerCase().endsWith('.cbz'))) {
            this.handleArchiveFile(files[0]);
          } else {
            this.handleArchiveFolder(files);
          }
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handleArchiveFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    if (folderInput) {
      folderInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handleArchiveFolder(e.target.files);
          e.target.value = '';
        }
      });
    }
  }

  async handleArchiveFile(file) {
    try {
      this.showToast('Индексация архива...', 'info');
      await window.reader.loadUserZipFile(file);
      this.closeAllModals();
    } catch (err) {
      this.showToast(err.message || 'Ошибка чтения архива', 'error');
    }
  }

  async handleArchiveFolder(files) {
    try {
      this.showToast('Чтение папки с изображениями...', 'info');
      await window.reader.loadUserFolder(files);
      this.closeAllModals();
    } catch (err) {
      this.showToast(err.message || 'Ошибка чтения папки', 'error');
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
