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
    this.renderUserHeader();
    this.renderStorefront();
    this.setupModals();

    // Применение локализации интерфейса
    if (window.i18n) window.i18n.applyTranslations();

    // Проверка видимости админ-панели для роли
    this.handleRoleVisibility(window.auth.getRole());

    // Слушатель смены роли / пользователя
    window.auth.onChange((role, user) => {
      this.renderUserHeader();
      this.renderStorefront();
      this.handleRoleVisibility(role);
    });

    // Инициализация сервисов
    if (window.admin) window.admin.init();

    // Проверка хэша URL для роутинга и сброса пароля
    if (window.location.hash.includes('type=recovery')) {
      setTimeout(() => this.showNewPasswordModal(), 400);
    }
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

  async handleLogout() {
    await window.auth.logout();
    this.showToast('Вы вышли из системы', 'info');
    this.switchTab('storefront');
    this.renderUserHeader();
    this.renderStorefront();
  }

  /**
   * Шапка пользователя (баланс Орбов, аватар/вход, история и выход)
   */
  renderUserHeader() {
    const balancePill = document.getElementById('header-balance-pill');
    const userAuthBlock = document.getElementById('header-user-block');
    const isGuest = window.auth.isGuest();
    const user = window.auth.getUser();
    const isAdmin = window.auth.isAdmin();

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
          <button class="btn btn-secondary btn-small" onclick="window.app.showAuthModal('login')">${loginText}</button>
        `;
      } else {
        const displayName = isAdmin ? 'GraveAdmin' : (user.name || user.email.split('@')[0]);
        userAuthBlock.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="user-badge" title="${user.email || 'Пользователь'}">
              <div class="user-avatar" style="${isAdmin ? 'background: var(--gold-gradient); color: #000; font-size: 0.9rem;' : ''}">
                ${isAdmin ? '👑' : (displayName || 'U')[0].toUpperCase()}
              </div>
              <span class="user-name">${displayName.split(' ')[0]}</span>
              ${isAdmin ? '<span class="badge badge-gold" style="font-size: 0.65rem; padding: 2px 6px;">Admin</span>' : ''}
            </div>
            <button class="btn btn-secondary btn-small" onclick="window.app.showDepositHistoryModal()" title="История пополнений баланса">
              📜 История
            </button>
            <button class="btn btn-secondary btn-small" onclick="window.app.handleLogout()" title="Выйти из аккаунта">
              🚪 Выйти
            </button>
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
   * Рендер раздела «Мои покупки и история»
   */
  async renderPurchases() {
    const container = document.getElementById('purchases-grid');
    const worksBadge = document.getElementById('purchases-count-badge');
    if (!container) return;

    const isGuest = window.auth.isGuest();
    if (isGuest) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 4rem 1rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🔒</div>
          <h3>Войдите в аккаунт</h3>
          <p style="color: var(--text-muted); margin-bottom: 1.25rem;">Чтобы просматривать купленные работы и историю пополнений, выполните вход.</p>
          <button class="btn btn-accent btn-large" onclick="window.app.showAuthModal('login')">🔑 Войти / Зарегистрироваться</button>
        </div>
      `;
      return;
    }

    const allWorks = window.store.getWorks();
    const purchased = allWorks.filter(w => window.store.hasPurchased(w.id));
    if (worksBadge) worksBadge.textContent = purchased.length;

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
    } else {
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

    // Подгружаем историю пополнений
    this.renderDepositHistory();
  }

  async renderDepositHistory() {
    const tbody = document.getElementById('deposits-history-table-body');
    const badge = document.getElementById('deposits-count-badge');
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">
          ⏳ Загрузка истории транзакций...
        </td>
      </tr>
    `;

    try {
      const history = await this.store.getDepositHistory();
      if (badge) badge.textContent = history.length;

      if (history.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted);">
              🪙 История пополнений пока пуста. Пополните баланс через кнопку «+» возле баланса.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = history.map(item => {
        const dateFormatted = item.date ? new Date(item.date).toLocaleString() : '—';
        const isBtc = (item.network || '').includes('BTC');
        const networkBadgeClass = isBtc ? 'badge-gold' : (item.network || '').includes('Polygon') ? 'badge-accent' : 'badge-info';

        let txHashCell = '<span style="color: var(--text-muted);">—</span>';
        if (item.txHash) {
          const shortHash = item.txHash.length > 16 ? `${item.txHash.slice(0, 8)}...${item.txHash.slice(-6)}` : item.txHash;
          if (item.explorerUrl) {
            txHashCell = `<a href="${item.explorerUrl}" target="_blank" rel="noopener noreferrer" style="color: #60a5fa; text-decoration: none; font-family: monospace; display: inline-flex; align-items: center; gap: 4px;" title="Открыть в блокчейн-эксплорере">
              ${shortHash} ↗
            </a>`;
          } else {
            txHashCell = `<span style="font-family: monospace; color: var(--text-secondary);">${shortHash}</span>`;
          }
        }

        const isCompleted = item.status === 'completed';
        const statusBadge = isCompleted
          ? `<span class="badge badge-success">✅ Завершено</span>`
          : `<span class="badge badge-warning">⏳ Ожидание</span>`;

        return `
          <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s ease;">
            <td style="padding: 0.85rem 1rem; color: var(--text-secondary);">${dateFormatted}</td>
            <td style="padding: 0.85rem 1rem; font-weight: 600; font-family: monospace; color: #fff;">${item.id || '—'}</td>
            <td style="padding: 0.85rem 1rem;"><span class="badge ${networkBadgeClass}">${item.network || 'USDT'}</span></td>
            <td style="padding: 0.85rem 1rem; font-weight: 600;">${item.amountUsdt} ${isBtc ? 'BTC' : 'USDT'}</td>
            <td style="padding: 0.85rem 1rem; color: #fbbf24; font-weight: 700;">+${item.orbs.toFixed(2)} 🪙</td>
            <td style="padding: 0.85rem 1rem;">${txHashCell}</td>
            <td style="padding: 0.85rem 1rem;">${statusBadge}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.warn('Ошибка рендера истории пополнений:', err);
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="padding: 1.5rem; text-align: center; color: var(--accent-danger);">
            Не удалось загрузить историю транзакций
          </td>
        </tr>
      `;
    }
  }

  switchPurchasesSubtab(tab) {
    const worksView = document.getElementById('purchases-works-view');
    const depositsView = document.getElementById('purchases-deposits-view');
    const btnWorks = document.getElementById('subtab-btn-works');
    const btnDeposits = document.getElementById('subtab-btn-deposits');

    if (tab === 'deposits') {
      if (worksView) worksView.style.display = 'none';
      if (depositsView) depositsView.style.display = 'block';
      if (btnWorks) btnWorks.classList.remove('active');
      if (btnDeposits) btnDeposits.classList.add('active');
      this.renderDepositHistory();
    } else {
      if (worksView) worksView.style.display = 'block';
      if (depositsView) depositsView.style.display = 'none';
      if (btnWorks) btnWorks.classList.add('active');
      if (btnDeposits) btnDeposits.classList.remove('active');
    }
  }

  showDepositHistoryModal() {
    this.switchTab('purchases');
    this.switchPurchasesSubtab('deposits');
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
      
      const orderIdEl = document.getElementById('invoice-order-id');
      const amountUsdtEl = document.getElementById('invoice-amount-usdt');
      const amountOrbsEl = document.getElementById('invoice-amount-orbs');
      const networkEl = document.getElementById('invoice-network');
      const addressEl = document.getElementById('invoice-address');
      const pathEl = document.getElementById('invoice-derivation-path');

      if (orderIdEl) orderIdEl.textContent = invoice.orderId;
      if (amountUsdtEl) amountUsdtEl.textContent = invoice.formattedAmount || `${invoice.usdtAmount} USDT`;
      if (amountOrbsEl) amountOrbsEl.textContent = `${invoice.orbsAmount} Орб`;
      if (networkEl) networkEl.textContent = invoice.networkBadge || invoice.network;
      if (addressEl) addressEl.value = invoice.address;
      if (pathEl) pathEl.textContent = invoice.derivationPath;

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


  checkPaymentInBlockchain() {
    if (window.cryptoPay) {
      window.cryptoPay.checkBlockchainPayment(true);
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
   * Модальное окно авторизации / регистрации
   */
  showAuthModal(tab = 'login') {
    const modal = document.getElementById('generic-modal');
    const modalTitle = document.getElementById('generic-modal-title');
    const modalBody = document.getElementById('generic-modal-body');

    modalTitle.textContent = tab === 'login' ? '🔑 Вход в аккаунт' : '✨ Регистрация аккаунта';

    const isLogin = tab === 'login';
    modalBody.innerHTML = `
      <div style="display: flex; gap: 8px; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem;">
        <button type="button" class="btn ${isLogin ? 'btn-accent' : 'btn-secondary'} btn-small" style="flex: 1;" onclick="window.app.showAuthModal('login')">
          🔑 Вход
        </button>
        <button type="button" class="btn ${!isLogin ? 'btn-accent' : 'btn-secondary'} btn-small" style="flex: 1;" onclick="window.app.showAuthModal('register')">
          ✨ Регистрация
        </button>
      </div>

      <form onsubmit="event.preventDefault(); window.app.handleAuthSubmit(event, '${tab}')">
        ${!isLogin ? `
          <div class="form-group" style="margin-bottom: 0.85rem;">
            <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Ваше имя / Никнейм</label>
            <input type="text" id="auth-name-input" class="input-styled" required placeholder="Например: Иван">
          </div>
        ` : ''}
        <div class="form-group" style="margin-bottom: 0.85rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Email</label>
          <input type="email" id="auth-email-input" class="input-styled" required placeholder="name@example.com" value="${isLogin ? 'ismayilovelchin1984@gmail.com' : ''}">
        </div>
        <div class="form-group" style="margin-bottom: 0.5rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Пароль</label>
          <input type="password" id="auth-password-input" class="input-styled" required minlength="6" placeholder="Минимум 6 символов" value="${isLogin ? 'ZlY263ws31Th5FMZ' : ''}">
        </div>
        ${isLogin ? `
          <div style="display: flex; justify-content: flex-end; margin-bottom: 1.25rem;">
            <a href="#" onclick="event.preventDefault(); window.app.showForgotPasswordModal()" style="font-size: 0.8rem; color: var(--accent-secondary); text-decoration: none; cursor: pointer;">
              ❓ Забыли пароль?
            </a>
          </div>
        ` : `<div style="margin-bottom: 1.25rem;"></div>`}
        <div style="display: flex; gap: 8px; flex-direction: column;">
          <button type="submit" class="btn btn-accent btn-large" style="width: 100%;" id="auth-submit-btn">
            ${isLogin ? '⚡ Войти в аккаунт' : '✨ Зарегистрироваться'}
          </button>
          <button type="button" class="btn btn-secondary" style="width: 100%; opacity: 0.8;" onclick="window.app.closeAllModals()">
            ✕ Отмена
          </button>
        </div>
      </form>
    `;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  async handleAuthSubmit(e, mode = 'login') {
    const email = document.getElementById('auth-email-input')?.value.trim();
    const password = document.getElementById('auth-password-input')?.value;
    const nameInput = document.getElementById('auth-name-input');
    const name = nameInput ? nameInput.value.trim() : '';
    const submitBtn = document.getElementById('auth-submit-btn');

    if (!email || !password) {
      this.showToast('Заполните все обязательные поля', 'warning');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Авторизация в Supabase...';
    }

    try {
      if (mode === 'login') {
        await window.auth.signInSupabase(email, password);
        const isAdmin = window.auth.isAdmin();
        const user = window.auth.getUser();
        this.showToast(`С возвращением, ${user.name || email}! ${isAdmin ? '👑 (Режим Администратора)' : ''}`, 'success');
      } else {
        await window.auth.signUpSupabase(email, password, name);
        this.showToast(`Регистрация успешна! Добро пожаловать, ${name || email}!`, 'success');
      }
      this.closeAllModals();
      this.renderUserHeader();
      this.renderStorefront();
      this.handleRoleVisibility(window.auth.getRole());
    } catch (err) {
      console.warn('Ошибка авторизации:', err);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'login' ? '⚡ Войти в аккаунт' : '✨ Зарегистрироваться';
      }
      const msg = err.message || '';
      if (msg.includes('Invalid login credentials')) {
        this.showToast('Неверный email или пароль', 'error');
      } else if (msg.includes('User already registered')) {
        this.showToast('Пользователь с таким email уже зарегистрирован. Переключитесь на вкладку «Вход».', 'warning');
        this.showAuthModal('login');
      } else {
        this.showToast(msg || 'Ошибка авторизации', 'error');
      }
    }
  }

  /**
   * Модальное окно запроса ссылки для сброса пароля
   */
  showForgotPasswordModal() {
    const modal = document.getElementById('generic-modal');
    const modalTitle = document.getElementById('generic-modal-title');
    const modalBody = document.getElementById('generic-modal-body');

    modalTitle.textContent = '🔑 Восстановление пароля';
    modalBody.innerHTML = `
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.25rem; line-height: 1.5;">
        Введите адрес электронной почты, указанный при регистрации. Мы отправим вам официальное письмо со ссылкой для сброса и установки нового пароля.
      </p>
      <form onsubmit="event.preventDefault(); window.app.handleForgotPasswordSubmit(event)">
        <div class="form-group" style="margin-bottom: 1.25rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Ваш Email</label>
          <input type="email" id="forgot-email-input" class="input-styled" required placeholder="name@example.com">
        </div>
        <div style="display: flex; gap: 8px; flex-direction: column;">
          <button type="submit" class="btn btn-accent btn-large" style="width: 100%;" id="forgot-submit-btn">
            📨 Отправить ссылку для сброса
          </button>
          <button type="button" class="btn btn-secondary" style="width: 100%;" onclick="window.app.showAuthModal('login')">
            ← Вернуться ко входу
          </button>
        </div>
      </form>
    `;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  async handleForgotPasswordSubmit(e) {
    const emailInput = document.getElementById('forgot-email-input');
    const email = emailInput ? emailInput.value.trim() : '';
    const submitBtn = document.getElementById('forgot-submit-btn');

    if (!email) {
      this.showToast('Укажите ваш email', 'warning');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Отправка запроса...';
    }

    try {
      await window.auth.resetPassword(email);
      const modalBody = document.getElementById('generic-modal-body');
      if (modalBody) {
        modalBody.innerHTML = `
          <div style="text-align: center; padding: 1.5rem 0;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">📬</div>
            <h3 style="margin-bottom: 0.5rem; color: #fff;">Письмо успешно отправлено!</h3>
            <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem; line-height: 1.5;">
              Мы отправили инструкцию по восстановлению на <strong>${email}</strong>.<br>
              Проверьте входящие (и папку «Спам») и перейдите по ссылке из письма для ввода нового пароля.
            </p>
            <button type="button" class="btn btn-secondary" style="width: 100%;" onclick="window.app.closeAllModals()">
              Понятно
            </button>
          </div>
        `;
      }
      this.showToast('Письмо со ссылкой для восстановления отправлено!', 'success');
    } catch (err) {
      console.warn('Ошибка сброса пароля:', err);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '📨 Отправить ссылку для сброса';
      }
      this.showToast(err.message || 'Не удалось отправить письмо для сброса', 'error');
    }
  }

  /**
   * Модальное окно установки нового пароля (после перехода по ссылке)
   */
  showNewPasswordModal() {
    const modal = document.getElementById('generic-modal');
    const modalTitle = document.getElementById('generic-modal-title');
    const modalBody = document.getElementById('generic-modal-body');

    modalTitle.textContent = '🔒 Установка нового пароля';
    modalBody.innerHTML = `
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem; line-height: 1.5;">
        Вы успешно подтвердили доступ к аккаунту. Придумайте новый надёжный пароль:
      </p>
      <form onsubmit="event.preventDefault(); window.app.handleNewPasswordSubmit(event)">
        <div class="form-group" style="margin-bottom: 0.85rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Новый пароль</label>
          <input type="password" id="new-password-input" class="input-styled" required minlength="6" placeholder="Минимум 6 символов">
        </div>
        <div class="form-group" style="margin-bottom: 1.25rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Повторите новый пароль</label>
          <input type="password" id="new-password-confirm-input" class="input-styled" required minlength="6" placeholder="Повторите пароль">
        </div>
        <div style="display: flex; gap: 8px; flex-direction: column;">
          <button type="submit" class="btn btn-accent btn-large" style="width: 100%;" id="new-password-submit-btn">
            💾 Сохранить новый пароль
          </button>
          <button type="button" class="btn btn-secondary" style="width: 100%; opacity: 0.8;" onclick="window.app.closeAllModals()">
            ✕ Отмена
          </button>
        </div>
      </form>
    `;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  async handleNewPasswordSubmit(e) {
    const pass = document.getElementById('new-password-input')?.value;
    const confirmPass = document.getElementById('new-password-confirm-input')?.value;
    const submitBtn = document.getElementById('new-password-submit-btn');

    if (!pass || pass.length < 6) {
      this.showToast('Пароль должен содержать минимум 6 символов', 'warning');
      return;
    }

    if (pass !== confirmPass) {
      this.showToast('Пароли не совпадают', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Сохранение нового пароля...';
    }

    try {
      await window.auth.updateUserPassword(pass);
      this.showToast('🎉 Пароль успешно изменён! Вы вошли в аккаунт.', 'success');
      this.closeAllModals();
      this.renderUserHeader();
      this.renderStorefront();
      this.handleRoleVisibility(window.auth.getRole());
    } catch (err) {
      console.warn('Ошибка смены пароля:', err);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Сохранить новый пароль';
      }
      this.showToast(err.message || 'Ошибка обновления пароля', 'error');
    }
  }

  setupModals() {
    // Кнопки крестика закрывают окно
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeAllModals();
      });
    });

    // Защита от случайного закрытия модальных окон при клике по фону
    // Окна ввода данных (регистрация/вход, пополнение счета, загрузка) защищены от случайных кликов
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      let mouseDownTarget = null;
      backdrop.addEventListener('mousedown', (e) => {
        mouseDownTarget = e.target;
      });

      backdrop.addEventListener('click', (e) => {
        // Проверяем, что клик пришелся именно на пустой фон снаружи карточки
        if (e.target === backdrop && mouseDownTarget === backdrop) {
          // Для формы регистрации/входа, оплаты и загрузки НЕ закрываем окно случайно,
          // а плавно покачиваем карточку (эффект static backdrop)
          if (backdrop.id === 'generic-modal' || backdrop.id === 'topup-modal' || backdrop.id === 'archive-upload-modal') {
            const card = backdrop.querySelector('.modal-card');
            if (card) {
              card.classList.remove('modal-shake');
              void card.offsetWidth; // перезапуск анимации
              card.classList.add('modal-shake');
            }
            return;
          }
          this.closeAllModals();
        }
      });
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
