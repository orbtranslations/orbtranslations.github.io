/**
 * App — Главный контроллер интерфейса и навигации платформы
 * Полная поддержка мультиязычности (RU / EN) и взаимодействия с i18n
 */
class App {
  constructor() {
    this.currentTab = 'storefront';
    this.store = (typeof window !== 'undefined' && window.store) ? window.store : null;
    this.openedFromHistory = false;
  }

  init() {
    if (!this.store && typeof window !== 'undefined') {
      this.store = window.store;
    }
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
      topupBtn.addEventListener('click', (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        this.showTopupModal();
      });
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
        const topupModal = document.getElementById('topup-modal');
        if (topupModal && topupModal.classList.contains('active') && this.openedFromHistory) {
          this.openedFromHistory = false;
          this.closeAllModals();
          this.showDepositHistoryModal();
          return;
        }
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
        const isEn = window.i18n && window.i18n.getLang() === 'en';
        this.showToast(isEn ? 'Admin panel is available for Administrators only' : 'Панель администратора доступна только Администраторам', 'warning');
      } else {
        this.switchTab(hash);
      }
    }
  }

  switchTab(tabName) {
    if (tabName === 'admin' && !window.auth.isAdmin()) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      this.showToast(isEn ? 'Admin panel is available for Administrators only' : 'Панель администратора доступна только Администраторам', 'error');
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
      if (window.admin) {
        window.admin.renderWorksTable();
        window.admin.renderUsersTable();
      }
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
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    this.showToast(isEn ? 'Signed out successfully' : 'Вы вышли из системы', 'info');
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
      const userOrbs = (user && typeof user.orbs === 'number') ? user.orbs : 0;
      if (isGuest && userOrbs <= 0) {
        balancePill.style.display = 'none';
      } else {
        balancePill.style.display = 'flex';
        balancePill.style.cursor = 'pointer';
        balancePill.onclick = (e) => {
          if (e) {
            e.preventDefault();
          }
          this.showTopupModal();
        };
        const orbVal = document.getElementById('header-orbs-count');
        if (orbVal) {
          orbVal.textContent = Math.floor(userOrbs);
        }
      }
    }

    if (userAuthBlock) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      const historyText = window.i18n ? window.i18n.t('header_history_btn') : (isEn ? '📜 History' : '📜 История');
      const historyTitle = window.i18n ? window.i18n.t('header_history_title') : (isEn ? 'Deposit and transaction history' : 'История пополнений баланса');

      if (isGuest) {
        const loginText = window.i18n ? window.i18n.t('btn_login') : (isEn ? '🔑 Sign In' : '🔑 Войти');
        userAuthBlock.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn-secondary btn-small" onclick="window.app.showDepositHistoryModal()" title="${historyTitle}">
              ${historyText}
            </button>
            <button class="btn btn-primary btn-small" onclick="window.app.showAuthModal('login')">${loginText}</button>
          </div>
        `;
      } else {
        const displayName = isAdmin ? 'GraveAdmin' : (user.name || user.email.split('@')[0]);
        const logoutText = window.i18n ? window.i18n.t('header_logout_btn') : (isEn ? '🚪 Sign Out' : '🚪 Выйти');
        const logoutTitle = window.i18n ? window.i18n.t('header_logout_title') : (isEn ? 'Sign out of your account' : 'Выйти из аккаунта');
        const userTitle = user.email || (isEn ? 'User' : 'Пользователь');

        userAuthBlock.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="user-badge" title="${userTitle}">
              <div class="user-avatar" style="${isAdmin ? 'background: var(--gold-gradient); color: #000; font-size: 0.9rem;' : ''}">
                ${isAdmin ? '👑' : (displayName || 'U')[0].toUpperCase()}
              </div>
              <span class="user-name">${displayName.split(' ')[0]}</span>
              ${isAdmin ? '<span class="badge badge-gold" style="font-size: 0.65rem; padding: 2px 6px;">Admin</span>' : ''}
            </div>
            <button class="btn btn-secondary btn-small" onclick="window.app.showDepositHistoryModal()" title="${historyTitle}">
              ${historyText}
            </button>
            <button class="btn btn-secondary btn-small" onclick="window.app.handleLogout()" title="${logoutTitle}">
              ${logoutText}
            </button>
          </div>
        `;
      }
    }
  }

  /**
   * Переключение развернутого/свернутого состояния описания карточки
   */
  toggleDesc(workId, prefix = '') {
    const descEl = document.getElementById(`${prefix}desc-${workId}`);
    const btnEl = document.getElementById(`${prefix}desc-btn-${workId}`);
    if (!descEl) return;

    const isExpanded = descEl.classList.toggle('is-expanded');
    if (btnEl) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      const moreTxt = window.i18n ? window.i18n.t('card_desc_more') : (isEn ? 'Show full description ▾' : 'Развернуть описание ▾');
      const lessTxt = window.i18n ? window.i18n.t('card_desc_less') : (isEn ? 'Collapse ▴' : 'Свернуть ▴');
      btnEl.textContent = isExpanded ? lessTxt : moreTxt;
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
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (works.length === 0) {
      container.innerHTML = `<div class="empty-state"><h3>${isEn ? 'Catalog is empty' : 'Каталог пуст'}</h3><p>${isEn ? 'The administrator has not added any works yet.' : 'Администратор еще не добавил ни одной работы.'}</p></div>`;
      return;
    }

    container.innerHTML = works.map(work => {
      const isPurchased = window.store.hasPurchased(work.id);
      const title = window.i18n ? window.i18n.getWorkTitle(work) : (work.title.ru || work.title);
      const desc = window.i18n ? window.i18n.getWorkDesc(work) : (work.description.ru || work.description);

      const orbTxt = isEn ? 'Orbs' : 'Орб';
      const previewBtnTxt = window.i18n ? window.i18n.t('card_btn_preview') : (isEn ? '👁️ Preview' : '👁️ Превью');
      const readBtnTxt = window.i18n ? window.i18n.t('card_btn_read') : (isEn ? '📖 Read Translation' : '📖 Читать перевод');
      const buyBtnTxt = window.i18n ? `${window.i18n.t('card_btn_buy')} ${work.price} ${orbTxt}` : `⚡ ${isEn ? 'Buy for' : 'Купить за'} ${work.price} ${orbTxt}`;
      const loginBuyTxt = window.i18n ? window.i18n.t('card_btn_login_to_buy') : (isEn ? '🔑 Sign In to Buy' : '🔑 Войти для покупки');
      const freePagesTxt = window.i18n ? `${work.previewPagesCount} ${window.i18n.t('card_preview_free')}` : `${work.previewPagesCount} ${isEn ? 'pages free' : 'стр. бесплатно'}`;
      const totalTxt = window.i18n ? `${window.i18n.t('card_total_pages')} ${work.totalPages}` : `${isEn ? 'Total:' : 'Всего:'} ${work.totalPages} ${isEn ? 'pages' : 'стр.'}`;

      const isLongDesc = Boolean(desc && desc.length > 80);
      const moreTxt = window.i18n ? window.i18n.t('card_desc_more') : (isEn ? 'Show full description ▾' : 'Развернуть описание ▾');

      return `
        <article class="work-card">
          <div class="work-card-media">
            <div class="work-cover-backdrop" style="background-image: url('${work.coverUrl || 'assets/demo/cover-1.svg'}');"></div>
            <img src="${work.coverUrl || 'assets/demo/cover-1.svg'}" alt="${title}" class="work-cover-img" onerror="this.src='assets/demo/cover-1.svg'; if(this.previousElementSibling) this.previousElementSibling.style.backgroundImage='url(assets/demo/cover-1.svg)';">
            <div class="work-badge-overlay">
              <span class="badge badge-accent">💎 ${work.price} ${orbTxt} ($${work.price})</span>
              <span class="badge badge-glass">👁️ ${freePagesTxt}</span>
            </div>
          </div>
          <div class="work-card-body">
            <div class="work-tags">
              ${(work.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('')}
            </div>
            <h3 class="work-title" title="${title}">${title}</h3>
            <div class="work-desc-container">
              <p class="work-desc ${isLongDesc ? 'has-expand' : ''}" id="desc-${work.id}" ${isLongDesc ? `onclick="window.app.toggleDesc('${work.id}')"` : ''}>${desc || ''}</p>
              ${isLongDesc ? `
                <button type="button" class="work-desc-toggle" id="desc-btn-${work.id}" onclick="window.app.toggleDesc('${work.id}')">
                  ${moreTxt}
                </button>
              ` : ''}
            </div>
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

    // Всегда загружаем и обновляем историю транзакций
    this.renderDepositHistory();

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const isGuest = window.auth.isGuest();
    if (isGuest) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 4rem 1rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🔒</div>
          <h3>${isEn ? 'Sign In to Your Account' : 'Войдите в аккаунт'}</h3>
          <p style="color: var(--text-muted); margin-bottom: 1.25rem;">${isEn ? 'Please sign in to view your unlocked translations.' : 'Чтобы просматривать купленные работы, выполните вход.'}</p>
          <button class="btn btn-accent btn-large" onclick="window.app.showAuthModal('login')">${isEn ? '🔑 Sign In / Register' : '🔑 Войти / Зарегистрироваться'}</button>
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

        const isLongDesc = Boolean(desc && desc.length > 80);
        const moreTxt = window.i18n ? window.i18n.t('card_desc_more') : (isEn ? 'Show full description ▾' : 'Развернуть описание ▾');

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
              <div class="work-desc-container">
                <p class="work-desc ${isLongDesc ? 'has-expand' : ''}" id="p-desc-${work.id}" ${isLongDesc ? `onclick="window.app.toggleDesc('${work.id}', 'p-')"` : ''}>${desc || ''}</p>
                ${isLongDesc ? `
                  <button type="button" class="work-desc-toggle" id="p-desc-btn-${work.id}" onclick="window.app.toggleDesc('${work.id}', 'p-')">
                    ${moreTxt}
                  </button>
                ` : ''}
              </div>
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
    const tbodyPurchases = document.getElementById('deposits-history-table-body');
    const tbodyModal = document.getElementById('modal-deposits-history-table-body');
    const badge = document.getElementById('deposits-count-badge');
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    const loadingHtml = `
      <tr>
        <td colspan="8" style="padding: 2rem; text-align: center; color: var(--text-muted);">
          ${isEn ? '⏳ Loading transaction history...' : '⏳ Загрузка истории транзакций...'}
        </td>
      </tr>
    `;

    const hasExistingRows = (tbodyPurchases && tbodyPurchases.children && tbodyPurchases.children.length > 0) || 
                            (tbodyModal && tbodyModal.children && tbodyModal.children.length > 0);
    if (!hasExistingRows) {
      if (tbodyPurchases) tbodyPurchases.innerHTML = loadingHtml;
      if (tbodyModal) tbodyModal.innerHTML = loadingHtml;
    }

    try {
      const store = this.store || (typeof window !== 'undefined' ? window.store : null);
      if (!store) {
        console.warn('Store is not available for renderDepositHistory');
        return;
      }
      const history = await store.getDepositHistory();
      if (badge) badge.textContent = history.length;

      if (history.length === 0) {
        const emptyHtml = `
          <tr>
            <td colspan="8" style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted);">
              ${isEn ? '🪙 Deposit history is currently empty. Top up your balance using the "+" button next to your balance.' : '🪙 История пополнений пока пуста. Пополните баланс через кнопку «+» возле баланса.'}
            </td>
          </tr>
        `;
        if (tbodyPurchases) tbodyPurchases.innerHTML = emptyHtml;
        if (tbodyModal) tbodyModal.innerHTML = emptyHtml;
        return;
      }

      const rowsHtml = history.map(item => {
        const locale = isEn ? 'en-US' : 'ru-RU';
        const dateFormatted = item.date ? new Date(item.date).toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
        const isBtc = (item.network || '').includes('BTC');
        const networkBadgeClass = isBtc ? 'badge-gold' : (item.network || '').includes('Polygon') ? 'badge-accent' : 'badge-info';

        const isCancelled = item.status === 'cancelled';
        const isCompleted = item.status === 'completed';
        const isAwaiting = item.status === 'awaiting_confirmations';
        const isPending = item.status === 'pending';

        // В отличие от завершенных сделок, в отмененных не сохраняются подробности
        let txHashCell = '<span style="color: var(--text-muted);">—</span>';
        if (!isCancelled && item.txHash) {
          const shortHash = item.txHash.length > 16 ? `${item.txHash.slice(0, 8)}...${item.txHash.slice(-6)}` : item.txHash;
          const expTitle = isEn ? 'Open in blockchain explorer' : 'Открыть в блокчейн-эксплорере';
          if (item.explorerUrl) {
            txHashCell = `<a href="${item.explorerUrl}" target="_blank" rel="noopener noreferrer" style="color: #60a5fa; text-decoration: none; font-family: monospace; display: inline-flex; align-items: center; gap: 4px;" title="${expTitle}">
              ${shortHash} ↗
            </a>`;
          } else {
            txHashCell = `<span style="font-family: monospace; color: var(--text-secondary);">${shortHash}</span>`;
          }
        }

        // Статус
        let statusBadge = '';
        if (isCompleted) {
          statusBadge = `<span class="badge badge-success">${isEn ? '✅ Completed' : '✅ Завершено'}</span>`;
        } else if (isAwaiting) {
          const reqConfs = item.requiredConfirmations || (window.cryptoPay ? window.cryptoPay.getRequiredConfirmations(item.orbs) : 3);
          statusBadge = `<span class="badge badge-info" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4);">${isEn ? '⛓️ Confirming' : '⛓️ Подтверждения'} (${item.confirmations || 0}/${reqConfs})</span>`;
        } else if (isCancelled) {
          statusBadge = `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3);">${isEn ? '✕ Cancelled' : '✕ Отменена'}</span>`;
        } else {
          statusBadge = `<span class="badge badge-warning">${isEn ? '⏳ Pending' : '⏳ Ожидание'}</span>`;
        }

        const orbsVal = Number(item.orbs || 0);
        const amountVal = Number(item.amountUsdt || 0);

        // Кнопка действия (открытие активной/ожидающей сделки)
        let actionCell = '<span style="color: var(--text-muted); font-size: 0.75rem;">—</span>';
        if (item.canResume) {
          actionCell = `
            <button type="button" class="btn btn-resume-deal" onclick="window.app.resumeTopupSession('${item.id}')" title="${isEn ? 'Open active deal' : 'Открыть сделку'}">
              👁️ ${isEn ? 'Open' : 'Открыть'}
            </button>
          `;
        }

        return `
          <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s ease;">
            <td style="padding: 0.65rem 0.6rem; white-space: nowrap; color: var(--text-secondary); font-size: 0.82rem;">${dateFormatted}</td>
            <td style="padding: 0.65rem 0.6rem; white-space: nowrap; font-weight: 600; font-family: monospace; color: #fff; font-size: 0.82rem;">${item.id || '—'}</td>
            <td style="padding: 0.65rem 0.6rem; white-space: nowrap;"><span class="badge ${networkBadgeClass}" style="font-size: 0.72rem; padding: 2px 7px;">${item.network || 'USDT'}</span></td>
            <td style="padding: 0.65rem 0.6rem; white-space: nowrap; font-weight: 600; font-size: 0.82rem; ${isCancelled ? 'color: var(--text-muted);' : ''}">${amountVal} ${isBtc ? 'BTC' : 'USDT'}</td>
            <td style="padding: 0.65rem 0.6rem; white-space: nowrap; font-size: 0.82rem; ${isCancelled ? 'color: var(--text-muted);' : 'color: #fbbf24; font-weight: 700;'}">+${Math.floor(orbsVal)} 🪙</td>
            <td style="padding: 0.65rem 0.6rem; white-space: nowrap; font-size: 0.82rem;">${txHashCell}</td>
            <td style="padding: 0.65rem 0.6rem; white-space: nowrap;"><span style="font-size: 0.76rem;">${statusBadge}</span></td>
            <td style="padding: 0.65rem 0.6rem; white-space: nowrap; text-align: center;">${actionCell}</td>
          </tr>
        `;
      }).join('');

      if (tbodyPurchases) tbodyPurchases.innerHTML = rowsHtml;
      if (tbodyModal) tbodyModal.innerHTML = rowsHtml;
    } catch (err) {
      console.warn('Ошибка рендера истории пополнений:', err);
      const errHtml = `
        <tr>
          <td colspan="8" style="padding: 1.5rem; text-align: center; color: var(--accent-danger);">
            ${isEn ? 'Failed to load transaction history' : 'Не удалось загрузить историю транзакций'}
          </td>
        </tr>
      `;
      if (tbodyPurchases) tbodyPurchases.innerHTML = errHtml;
      if (tbodyModal) tbodyModal.innerHTML = errHtml;
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

  async showDepositHistoryModal() {
    const modal = document.getElementById('deposits-history-modal');
    if (modal) {
      modal.classList.add('active');
      document.body.classList.add('modal-open');
    } else {
      this.switchTab('purchases');
      this.switchPurchasesSubtab('deposits');
    }
    return await this.renderDepositHistory();
  }

  /**
   * Открытие активной сделки из истории пополнений
   */
  resumeTopupSession(orderId) {
    if (!window.cryptoPay) return;
    const session = window.cryptoPay.resumeSession(orderId);
    if (!session) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      this.showToast(
        isEn
          ? 'This transaction has expired or was already finished.'
          : 'Время ожидания оплаты этой сделки истекло или сделка уже завершена.',
        'warning'
      );
      this.renderDepositHistory();
      return;
    }

    this.openedFromHistory = true;
    this.closeAllModals();
    this.populateTopupStep2(session);
    this.switchToTopupStep(2);
    const modal = document.getElementById('topup-modal');
    if (modal) {
      modal.classList.add('active');
      document.body.classList.add('modal-open');
    }

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    this.showToast(
      isEn
        ? `👁️ Opened active transaction ${orderId}`
        : `👁️ Открыта активная сделка ${orderId}`,
      'info'
    );
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
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      this.showToast(isEn ? `Success! You unlocked "${title}"` : `Успешно! Вы приобрели перевод "${title}"`, 'success');
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

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    modalTitle.textContent = isEn ? 'Insufficient Orbs' : 'Недостаточно Орбов';
    modalBody.innerHTML = `
      <div style="text-align: center; padding: 1rem 0;">
        <div style="font-size: 3rem; margin-bottom: 0.5rem;">🪙</div>
        <p>${isEn ? `To purchase translation <strong>"${title}"</strong>, you need <strong>${work.price} Orbs</strong>.` : `Для покупки перевода <strong>"${title}"</strong> необходимо <strong>${work.price} Орб</strong>.`}</p>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem;">
          ${isEn ? 'Missing balance:' : 'Вам не хватает:'} <span style="color: var(--accent-gold); font-weight: 700;">${needOrbs} ${isEn ? 'Orbs' : 'Орб'} (${needOrbs} USDT)</span>
        </p>
        <div style="margin-top: 1.5rem; display: flex; gap: 8px; justify-content: center;">
          <button class="btn btn-secondary" onclick="window.app.closeAllModals()">${isEn ? 'Cancel' : 'Отмена'}</button>
          <button class="btn btn-accent" onclick="window.app.closeAllModals(); window.app.showTopupModal(${needOrbs})">
            ${isEn ? '➕ Deposit Balance' : '➕ Пополнить баланс'}
          </button>
        </div>
      </div>
    `;
    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  /**
   * Модальное окно пополнения баланса (2-шаговый интерфейс)
   */
  showTopupModal(defaultAmount = 5) {
    this.openedFromHistory = false;
    const modal = document.getElementById('topup-modal');
    if (!modal) return;

    // Проверяем, есть ли уже активная незавершённая сессия
    const activeSession = window.cryptoPay ? window.cryptoPay.getActiveSession() : null;
    if (activeSession && (
      activeSession.status === 'awaiting_confirmations' || 
      (activeSession.status === 'pending' && activeSession.expiresAt && activeSession.expiresAt > Date.now())
    )) {
      this.populateTopupStep2(activeSession);
      this.switchToTopupStep(2);
    } else {
      const amountInput = document.getElementById('topup-amount-input');
      if (amountInput) amountInput.value = Math.floor(Math.max(1, defaultAmount));
      this.switchToTopupStep(1);
      this.onTopupConfigChange();
    }

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  /**
   * Переключение между Шагом 1 (настройка) и Шагом 2 (оплата)
   */
  switchToTopupStep(stepNumber) {
    const step1 = document.getElementById('topup-step-1');
    const step2 = document.getElementById('topup-step-2');
    const expiredAlert = document.getElementById('topup-expired-alert');

    if (expiredAlert) expiredAlert.style.display = 'none';

    if (stepNumber === 1) {
      if (step1) step1.style.display = 'block';
      if (step2) step2.style.display = 'none';
    } else {
      if (step1) step1.style.display = 'none';
      if (step2) step2.style.display = 'block';
    }
  }

  /**
   * Быстрый выбор количества Орбов через чипсы (+1, +5, +10, ...)
   */
  setTopupAmount(amount) {
    const input = document.getElementById('topup-amount-input');
    if (input) {
      input.value = Math.floor(Math.max(1, Number(amount) || 1));
      this.onTopupConfigChange();
    }
  }

  /**
   * Обновление расчёта стоимости и живого курса BTC на Шаге 1
   */
  async onTopupConfigChange() {
    const amountInput = document.getElementById('topup-amount-input');
    const networkSelect = document.getElementById('topup-network-select');
    const previewOrbs = document.getElementById('topup-preview-orbs');
    const previewRate = document.getElementById('topup-preview-rate');
    const previewPayable = document.getElementById('topup-preview-payable');

    const orbsAmount = Math.floor(Math.max(1, Number(amountInput ? amountInput.value : 5) || 5));
    if (amountInput) amountInput.value = orbsAmount;
    const network = networkSelect ? networkSelect.value : 'USDT (TRC-20)';
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (previewOrbs) {
      previewOrbs.textContent = `${orbsAmount} ${isEn ? 'Orbs' : 'Орб'}`;
    }

    if (network.includes('BTC') || network.includes('Bitcoin')) {
      if (previewRate) previewRate.textContent = isEn ? '⏳ Fetching live BTC rate...' : '⏳ Загрузка живого курса BTC...';
      try {
        const rate = await window.cryptoPay.fetchLiveBtcRate();
        const estBtc = (orbsAmount / rate).toFixed(8);
        if (previewRate) {
          previewRate.textContent = `1 BTC ≈ $${Math.round(rate).toLocaleString()} USD (${isEn ? 'Live' : 'Биржа'})`;
        }
        if (previewPayable) {
          previewPayable.textContent = `~${estBtc} BTC (~$${Math.floor(orbsAmount)})`;
        }
      } catch (e) {
        if (previewRate) previewRate.textContent = '1 BTC ≈ $65,000 USD (est.)';
        if (previewPayable) previewPayable.textContent = `~${(orbsAmount / 65000).toFixed(8)} BTC`;
      }
    } else {
      if (previewRate) {
        previewRate.textContent = '1 USDT = $1.00 USD';
      }
      if (previewPayable) {
        previewPayable.textContent = `${Math.floor(orbsAmount)} USDT`;
      }
    }
  }

  /**
   * Переход с Шага 1 на Шаг 2: создание заказа с фиксацией курса на 30 минут
   */
  async goToTopupStep2(bypassConflict = false) {
    const amountInput = document.getElementById('topup-amount-input');
    const networkSelect = document.getElementById('topup-network-select');
    const proceedBtn = document.getElementById('topup-proceed-btn');
    const orbsAmount = Math.floor(Math.max(1, Number(amountInput ? amountInput.value : 5) || 5));
    if (amountInput) amountInput.value = orbsAmount;
    const network = networkSelect ? networkSelect.value : 'USDT (TRC-20)';
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    // Защита от спама: если уже есть активная сделка (pending или awaiting_confirmations), требуем разрешения конфликта
    if (!bypassConflict) {
      const activeSession = window.cryptoPay ? window.cryptoPay.getActiveSession() : null;
      if (activeSession && (activeSession.status === 'pending' || activeSession.status === 'awaiting_confirmations')) {
        this.showActiveDealConflictModal(activeSession, orbsAmount, network);
        return;
      }
    }

    if (proceedBtn) {
      proceedBtn.disabled = true;
      proceedBtn.textContent = isEn ? '⏳ Locking rate & creating order...' : '⏳ Фиксация курса и создание заказа...';
    }

    try {
      const invoice = await window.cryptoPay.createInvoice(orbsAmount, network);
      this.populateTopupStep2(invoice);
      this.switchToTopupStep(2);
      this.showToast(isEn ? '🔒 Exchange rate locked for 30 minutes!' : '🔒 Курс обмена зафиксирован на 30 минут!', 'info');
      this.renderDepositHistory();
    } catch (e) {
      this.showToast(e.message || (isEn ? 'Failed to create invoice' : 'Ошибка создания счёта'), 'error');
    } finally {
      if (proceedBtn) {
        proceedBtn.disabled = false;
        proceedBtn.textContent = isEn ? 'Proceed to Payment →' : 'Перейти к оплате →';
      }
    }
  }

  /**
   * Модальное окно разрешения конфликта при попытке открыть вторую параллельную сделку
   */
  showActiveDealConflictModal(activeSession, newAmount, newNetwork) {
    this.closeAllModals();
    const modal = document.getElementById('generic-modal');
    const modalTitle = document.getElementById('generic-modal-title');
    const modalBody = document.getElementById('generic-modal-body');
    if (!modal || !modalTitle || !modalBody) return;

    this._pendingDealConflict = {
      activeSession,
      newAmount,
      newNetwork
    };

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const t = (k, fallback) => (window.i18n ? window.i18n.t(k) : fallback);

    modalTitle.textContent = t('deal_conflict_title', isEn ? '⚠️ Active Transaction Detected' : '⚠️ Обнаружена незавершённая сделка');

    const statusText = activeSession.status === 'awaiting_confirmations'
      ? t('deal_conflict_status_awaiting', isEn ? '⛓️ Awaiting blockchain confirmations (up to 3 hours)' : '⛓️ Ожидает подтверждений в блокчейне (до 3 часов)')
      : t('deal_conflict_status_pending', isEn ? '⏱️ Awaiting payment (30 min window)' : '⏱️ Ожидает оплаты (окно 30 мин)');

    const currentFormatted = activeSession.formattedAmount || `${activeSession.expectedAmount || activeSession.orbsAmount} ${activeSession.networkBadge || activeSession.network}`;

    modalBody.innerHTML = `
      <p style="margin-bottom: 1rem; color: var(--text-secondary); line-height: 1.5; font-size: 0.9rem;">
        ${t('deal_conflict_desc', isEn 
          ? 'You already have an active pending transaction. To prevent spam and payment confusion, only one active transaction is allowed at a time.' 
          : 'У вас уже есть открытая активная сделка. Для защиты от спама и путаницы в платежах разрешена только одна активная сделка одновременно.')}
      </p>

      <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 1.25rem;">
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 4px;">
          ${t('deal_conflict_current_label', isEn ? 'Current transaction:' : 'Текущая сделка:')}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 4px;">
          <strong style="color: var(--accent-gold); font-family: monospace; font-size: 1rem;">${activeSession.orderId}</strong>
          <span class="badge badge-gold" style="font-size: 0.8rem;">${currentFormatted}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted);">
          <span>${activeSession.networkBadge || activeSession.network} (+${activeSession.orbsAmount} ${isEn ? 'Orbs' : 'Орб'})</span>
          <span style="color: #38bdf8;">${statusText}</span>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <button type="button" class="btn btn-accent btn-large" style="justify-content: center; font-weight: 600;" onclick="window.app.resolveDealConflict('resume')">
          ${t('deal_conflict_btn_resume', isEn ? '👁️ Open Active Deal' : '👁️ Открыть текущую сделку')} (${activeSession.orderId})
        </button>
        <button type="button" class="btn btn-secondary btn-large" style="justify-content: center; border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;" onclick="window.app.resolveDealConflict('replace')">
          ${t('deal_conflict_btn_replace', isEn ? '✕ Cancel Old & Create New' : '✕ Отменить старую и создать новую')}
        </button>
      </div>
    `;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  /**
   * Разрешение конфликта сделок (открыть существующую или заменить)
   */
  resolveDealConflict(action) {
    const conflict = this._pendingDealConflict;
    this._pendingDealConflict = null;
    this.closeAllModals();

    if (!conflict || !conflict.activeSession) return;

    if (action === 'resume') {
      this.resumeTopupSession(conflict.activeSession.orderId);
      return;
    }

    if (action === 'replace') {
      this.confirmReplaceActiveDeal(conflict.activeSession.orderId, conflict.newAmount, conflict.newNetwork);
    }
  }

  /**
   * Замена старой незавершенной сделки на новую
   */
  confirmReplaceActiveDeal(oldOrderId, newAmount, newNetwork) {
    if (window.cryptoPay) {
      window.cryptoPay.cancelSession('user_replaced', oldOrderId);
    }
    this.closeAllModals();

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const t = (k, fallback) => (window.i18n ? window.i18n.t(k) : fallback);
    this.showToast(t('deal_replaced_toast', isEn ? 'Previous transaction cancelled. New invoice created.' : 'Старая сделка отменена. Сформирован новый счёт.'), 'info');

    const amountInput = document.getElementById('topup-amount-input');
    const networkSelect = document.getElementById('topup-network-select');
    if (amountInput) amountInput.value = newAmount;
    if (networkSelect) networkSelect.value = newNetwork;

    const modal = document.getElementById('topup-modal');
    if (modal) {
      modal.classList.add('active');
      document.body.classList.add('modal-open');
    }

    // Создаем новый заказ в обход проверки конфликтов (старый уже отменен)
    this.goToTopupStep2(true);
  }

  /**
   * Заполнение реквизитов, QR-кода и статуса на Шаге 2
   */
  populateTopupStep2(invoice) {
    if (!invoice) return;

    const orderIdEl = document.getElementById('invoice-order-id');
    const amountUsdtEl = document.getElementById('invoice-amount-usdt');
    const networkEl = document.getElementById('invoice-network');
    const addressEl = document.getElementById('invoice-address');
    const pathEl = document.getElementById('invoice-derivation-path');
    const orbsInfoEl = document.getElementById('invoice-amount-orbs-info');
    const timerBanner = document.getElementById('invoice-timer-banner');
    const markPaidBtn = document.getElementById('invoice-mark-paid-btn');
    const confBox = document.getElementById('invoice-confirmations-box');
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (orderIdEl) orderIdEl.textContent = invoice.orderId;
    if (amountUsdtEl) amountUsdtEl.textContent = invoice.formattedAmount || `${invoice.usdtAmount} USDT`;
    if (networkEl) networkEl.textContent = invoice.networkBadge || invoice.network;
    if (addressEl) addressEl.value = invoice.address;
    if (pathEl) pathEl.textContent = invoice.derivationPath;
    if (orbsInfoEl) orbsInfoEl.textContent = `+${invoice.orbsAmount} ${isEn ? 'Orbs' : 'Орб'}`;

    // Рендер высокоточного ISO QR-кода на canvas
    const canvas = document.getElementById('invoice-qr-canvas');
    if (canvas && window.cryptoPay) {
      window.cryptoPay.renderQRCodeToCanvas(canvas, invoice.address);
    }

    // Состояние: ожидание первого перевода (pending) vs ожидание подтверждений в сети (awaiting_confirmations)
    const cancelBtn = document.getElementById('topup-cancel-order-btn');
    const cancelWarningBanner = document.getElementById('topup-cancel-warning-banner');
    const cancelWarningText = document.getElementById('topup-cancel-warning-text');
    const reqConfs = invoice.requiredConfirmations || (window.cryptoPay ? window.cryptoPay.getRequiredConfirmations(invoice.orbsAmount) : 3);

    if (invoice.status === 'awaiting_confirmations') {
      if (timerBanner) timerBanner.style.display = 'none';
      if (markPaidBtn) markPaidBtn.style.display = 'none';
      if (confBox) confBox.style.display = 'flex';
      this.updateConfirmationsUI(invoice.confirmations || 0, reqConfs, invoice.txHash);
    } else {
      if (timerBanner) timerBanner.style.display = 'block';
      if (markPaidBtn) {
        markPaidBtn.style.display = 'flex';
        markPaidBtn.disabled = false;
        markPaidBtn.textContent = isEn ? '✅ I Have Paid' : '✅ Я оплатил';
      }
      if (confBox) confBox.style.display = 'none';
      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.style.opacity = '1';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.pointerEvents = 'auto';
        cancelBtn.title = '';
      }
      if (cancelWarningBanner) {
        cancelWarningBanner.style.background = 'rgba(245, 158, 11, 0.08)';
        cancelWarningBanner.style.borderColor = 'rgba(245, 158, 11, 0.25)';
        cancelWarningBanner.style.color = '#fbbf24';
      }
      if (cancelWarningText) {
        cancelWarningText.textContent = isEn
          ? '⚠️ The deal can only be cancelled before the first confirmation on the network.'
          : '⚠️ Сделку можно отменить только до первого подтверждения в сети.';
      }
    }
  }

  /**
   * Пользователь нажал кнопку "Оплачено" — убираем таймер, переводим сделку в ожидание подтверждений
   */
  handleMarkAsPaid() {
    if (!window.cryptoPay) return;
    const session = window.cryptoPay.markSessionAsPaid();
    if (!session) return;

    const timerBanner = document.getElementById('invoice-timer-banner');
    const markPaidBtn = document.getElementById('invoice-mark-paid-btn');
    const confBox = document.getElementById('invoice-confirmations-box');

    if (timerBanner) timerBanner.style.display = 'none';
    if (markPaidBtn) markPaidBtn.style.display = 'none';
    if (confBox) confBox.style.display = 'flex';

    const req = session.requiredConfirmations || (window.cryptoPay ? window.cryptoPay.getRequiredConfirmations(session.orbsAmount) : 3);
    this.updateConfirmationsUI(session.confirmations || 0, req, session.txHash);

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    this.showToast(
      isEn
        ? `✅ Marked as paid! Tracking blockchain confirmations (0/${req})...`
        : `✅ Сделка переведена в режим ожидания подтверждений в сети (0/${req})...`,
      'info'
    );
    this.renderDepositHistory();
  }

  /**
   * Обновление визуального счётчика подтверждений и прогресс-бара
   */
  updateConfirmationsUI(conf, total = 3, txHash = '') {
    const box = document.getElementById('invoice-confirmations-box');
    const badge = document.getElementById('confirmations-counter-badge');
    const fill = document.getElementById('confirmations-bar-fill');
    const note = document.getElementById('confirmations-status-note');
    const stepsRow = document.getElementById('confirmations-steps-row');
    const step1 = document.getElementById('conf-step-1');
    const step2 = document.getElementById('conf-step-2');
    const step3 = document.getElementById('conf-step-3');
    const step1Text = document.getElementById('conf-step-1-text');
    const step2Text = document.getElementById('conf-step-2-text');
    const step3Text = document.getElementById('conf-step-3-text');
    const cancelBtn = document.getElementById('topup-cancel-order-btn');
    const cancelWarningBanner = document.getElementById('topup-cancel-warning-banner');
    const cancelWarningText = document.getElementById('topup-cancel-warning-text');
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (box) box.style.display = 'flex';
    if (badge) badge.textContent = `${Math.min(conf, total)} / ${total}`;

    // Процент заполнения шкалы
    const pct = conf <= 0 ? 12 : Math.min(100, Math.round((conf / total) * 100));
    if (fill) fill.style.width = `${pct}%`;

    // Динамическая сетка колонок в зависимости от требуемых подтверждений (1, 2 или 3)
    if (stepsRow) {
      stepsRow.style.gridTemplateColumns = total === 1 ? '1fr' : total === 2 ? '1fr 1fr' : '1fr 1fr 1fr';
    }

    // Настройка шага 1
    if (step1) {
      step1.style.display = 'flex';
      if (step1Text) {
        step1Text.textContent = total === 1
          ? (isEn ? '1st conf. (Credited)' : '1-е подтв. (Зачисление)')
          : (isEn ? '1st conf.' : '1-е подтв.');
      }
    }

    // Настройка шага 2
    if (step2) {
      if (total >= 2) {
        step2.style.display = 'flex';
        if (step2Text) {
          step2Text.textContent = total === 2
            ? (isEn ? '2nd conf. (Credited)' : '2-е подтв. (Зачисление)')
            : (isEn ? '2nd conf.' : '2-е подтв.');
        }
      } else {
        step2.style.display = 'none';
      }
    }

    // Настройка шага 3
    if (step3) {
      if (total >= 3) {
        step3.style.display = 'flex';
        if (step3Text) {
          step3Text.textContent = isEn ? '3rd conf. (Credited)' : '3-е подтв. (Зачисление)';
        }
      } else {
        step3.style.display = 'none';
      }
    }

    // Подсветка активных / завершенных шагов
    const updateStep = (el, stepNum) => {
      if (!el || el.style.display === 'none') return;
      el.classList.remove('active', 'completed');
      const numSpan = el.querySelector('.conf-step-num');
      if (conf >= stepNum) {
        el.classList.add('completed');
        if (numSpan) numSpan.textContent = '✓';
      } else if (conf === stepNum - 1) {
        el.classList.add('active');
        if (numSpan) numSpan.textContent = String(stepNum);
      } else {
        if (numSpan) numSpan.textContent = String(stepNum);
      }
    };

    updateStep(step1, 1);
    updateStep(step2, 2);
    updateStep(step3, 3);

    // Статусная строка
    if (note) {
      if (conf === 0) {
        note.textContent = isEn
          ? '📡 Transfer detected or awaiting first block confirmation...'
          : '📡 Перевод обнаружен или ожидается первое включение в блок...';
        note.style.borderLeftColor = '#38bdf8';
      } else if (conf >= total) {
        note.textContent = isEn
          ? `🎉 All ${total} confirmation${total > 1 ? 's' : ''} received! Deal completed, Orbs credited!`
          : (total === 1
              ? '🎉 1 подтверждение получено! Сделка завершена, Орбы зачислены!'
              : `🎉 Все ${total} подтверждения получены! Сделка завершена, Орбы зачислены!`);
        note.style.borderLeftColor = '#10b981';
      } else {
        const remaining = total - conf;
        note.textContent = isEn
          ? `⛓️ ${conf} of ${total} confirmation${total > 1 ? 's' : ''} received (${remaining} remaining)...`
          : `⛓️ Получено ${conf}-е подтверждение из ${total} (осталось ${remaining})...`;
        note.style.borderLeftColor = '#38bdf8';
      }
    }

    // Политика отмены: блокировка кнопки отмены после первого подтверждения в сети
    if (conf >= 1) {
      if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.style.opacity = '0.45';
        cancelBtn.style.cursor = 'not-allowed';
        cancelBtn.style.pointerEvents = 'none';
        cancelBtn.title = isEn
          ? 'Deal cannot be cancelled after the first network confirmation'
          : 'Сделку нельзя отменить после первого подтверждения в сети';
      }
      if (cancelWarningBanner) {
        cancelWarningBanner.style.background = 'rgba(239, 68, 68, 0.12)';
        cancelWarningBanner.style.borderColor = 'rgba(239, 68, 68, 0.35)';
        cancelWarningBanner.style.color = '#fca5a5';
      }
      if (cancelWarningText) {
        cancelWarningText.textContent = isEn
          ? '🔒 First network confirmation received. This transaction cannot be cancelled.'
          : '🔒 Получено первое подтверждение в сети. Отмена сделки невозможна.';
      }
    } else {
      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.style.opacity = '1';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.pointerEvents = 'auto';
        cancelBtn.title = '';
      }
      if (cancelWarningBanner) {
        cancelWarningBanner.style.background = 'rgba(245, 158, 11, 0.08)';
        cancelWarningBanner.style.borderColor = 'rgba(245, 158, 11, 0.25)';
        cancelWarningBanner.style.color = '#fbbf24';
      }
      if (cancelWarningText) {
        cancelWarningText.textContent = isEn
          ? '⚠️ The deal can only be cancelled before the first confirmation on the network.'
          : '⚠️ Сделку можно отменить только до первого подтверждения в сети.';
      }
    }
  }

  /**
   * Отмена текущего заказа и возврат на Шаг 1 (только при явном клике пользователем)
   * Разрешена ТОЛЬКО до первого подтверждения в сети блокчейн.
   */
  handleCancelTopup() {
    const session = window.cryptoPay ? (window.cryptoPay.activeSession || window.store.getActiveCryptoSession()) : null;
    if (session && typeof session.confirmations === 'number' && session.confirmations >= 1) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      this.showToast(
        isEn
          ? '⚠️ Cannot cancel order: first network confirmation already received.'
          : '⚠️ Нельзя отменить сделку: первое подтверждение в сети уже получено.',
        'warning'
      );
      return;
    }

    if (window.cryptoPay) {
      window.cryptoPay.cancelSession('user_cancelled');
    }
    const wasFromHistory = this.openedFromHistory;
    this.openedFromHistory = false;
    this.switchToTopupStep(1);
    this.onTopupConfigChange();
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    this.showToast(isEn ? 'Payment deal cancelled' : 'Сделка отменена и перемещена в историю', 'info');
    this.renderDepositHistory();
    if (wasFromHistory) {
      this.closeAllModals();
      this.showDepositHistoryModal();
    }
  }

  /**
   * Обновление отображения таймера 30 минут
   */
  updateTopupTimerUI(formatted, totalSec) {
    const timerDisplay = document.getElementById('invoice-timer-display');
    if (timerDisplay) {
      timerDisplay.textContent = formatted;
      if (totalSec <= 300) {
        timerDisplay.style.color = '#ef4444'; // Красный в последние 5 минут
        timerDisplay.style.borderColor = 'rgba(239, 68, 68, 0.5)';
      } else {
        timerDisplay.style.color = '#fbbf24';
        timerDisplay.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      }
    }
  }

  /**
   * Обработка истечения 30-минутного окна фиксации курса
   */
  handleTopupExpired() {
    const timerDisplay = document.getElementById('invoice-timer-display');
    const expiredAlert = document.getElementById('topup-expired-alert');
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (timerDisplay) {
      timerDisplay.textContent = '00:00';
      timerDisplay.style.color = '#ef4444';
    }

    if (expiredAlert) {
      expiredAlert.style.display = 'block';
    }

    this.showToast(isEn ? '⚠️ Payment window expired. Please refresh the rate.' : '⚠️ Время фиксации курса истекло. Пожалуйста, обновите курс.', 'warning');
    this.renderDepositHistory();
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

  async verifyManualTxId() {
    const input = document.getElementById('invoice-txid-input');
    const btn = document.getElementById('verify-txid-btn');
    const txHash = (input ? input.value : '').trim();
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (!txHash) {
      this.showToast(isEn ? 'Please enter a valid Transaction Hash (TxID)' : 'Введите хэш транзакции (TxID)', 'warning');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ ...';
    }

    try {
      const result = await window.cryptoPay.verifyTxId(txHash);
      if (result.success) {
        if (result.completed) {
          this.showToast(isEn ? `🎉 Payment confirmed (3/3)! +${result.amount} Orbs credited.` : `🎉 Платёж подтверждён (3/3)! Зачислено +${result.amount} Орбов.`, 'success');
          this.closeAllModals();
          this.renderUserHeader();
          this.renderPurchases();
        } else {
          this.showToast(
            isEn
              ? `📡 Transaction detected (${result.confirmations || 0}/3 confirmations). Awaiting remaining blocks...`
              : `📡 Транзакция найдена в сети (${result.confirmations || 0}/3 подтверждений). Ожидаем оставшиеся блоки...`,
            'info'
          );
          this.updateConfirmationsUI(result.confirmations || 0, 3, txHash);
          const timerBanner = document.getElementById('invoice-timer-banner');
          const markPaidBtn = document.getElementById('invoice-mark-paid-btn');
          if (timerBanner) timerBanner.style.display = 'none';
          if (markPaidBtn) markPaidBtn.style.display = 'none';
        }
      } else {
        this.showToast(result.message, 'error');
      }
    } catch (e) {
      this.showToast(e.message || (isEn ? 'Verification error' : 'Ошибка верификации'), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = isEn ? '⚡ Check TxID' : '⚡ Проверить TxID';
      }
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
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    modalTitle.textContent = isEn ? '🌐 Select Translation Language' : '🌐 Выберите язык перевода';
    modalBody.innerHTML = `
      <p style="margin-bottom: 1rem; color: var(--text-secondary);">
        ${isEn ? 'Multiple translation languages found in this script. Choose your preferred language to read:' : 'В скрипте перевода обнаружено несколько доступных языковых локализаций. Выберите желаемый язык для чтения:'}
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
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    const isLogin = tab === 'login';
    modalTitle.textContent = isLogin 
      ? (isEn ? '🔑 Sign In to Account' : '🔑 Вход в аккаунт') 
      : (isEn ? '✨ Create an Account' : '✨ Регистрация аккаунта');

    modalBody.innerHTML = `
      <div style="display: flex; gap: 8px; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem;">
        <button type="button" class="btn ${isLogin ? 'btn-accent' : 'btn-secondary'} btn-small" style="flex: 1;" onclick="window.app.showAuthModal('login')">
          ${isEn ? '🔑 Sign In' : '🔑 Вход'}
        </button>
        <button type="button" class="btn ${!isLogin ? 'btn-accent' : 'btn-secondary'} btn-small" style="flex: 1;" onclick="window.app.showAuthModal('register')">
          ${isEn ? '✨ Register' : '✨ Регистрация'}
        </button>
      </div>

      <form onsubmit="event.preventDefault(); window.app.handleAuthSubmit(event, '${tab}')">
        ${!isLogin ? `
          <div class="form-group" style="margin-bottom: 0.85rem;">
            <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">${isEn ? 'Your Name / Nickname' : 'Ваше имя / Никнейм'}</label>
            <input type="text" id="auth-name-input" class="input-styled" required placeholder="${isEn ? 'e.g. John' : 'Например: Иван'}">
          </div>
        ` : ''}
        <div class="form-group" style="margin-bottom: 0.85rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Email</label>
          <input type="email" id="auth-email-input" class="input-styled" required placeholder="name@example.com" value="${isLogin ? 'ismayilovelchin1984@gmail.com' : ''}">
        </div>
        <div class="form-group" style="margin-bottom: 0.5rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">${isEn ? 'Password' : 'Пароль'}</label>
          <input type="password" id="auth-password-input" class="input-styled" required minlength="6" placeholder="${isEn ? 'At least 6 characters' : 'Минимум 6 символов'}" value="${isLogin ? 'ZlY263ws31Th5FMZ' : ''}">
        </div>
        ${isLogin ? `
          <div style="display: flex; justify-content: flex-end; margin-bottom: 1.25rem;">
            <a href="#" onclick="event.preventDefault(); window.app.showForgotPasswordModal()" style="font-size: 0.8rem; color: var(--accent-secondary); text-decoration: none; cursor: pointer;">
              ${isEn ? '❓ Forgot Password?' : '❓ Забыли пароль?'}
            </a>
          </div>
        ` : `<div style="margin-bottom: 1.25rem;"></div>`}
        <div style="display: flex; gap: 8px; flex-direction: column;">
          <button type="submit" class="btn btn-accent btn-large" style="width: 100%;" id="auth-submit-btn">
            ${isLogin ? (isEn ? '⚡ Sign In' : '⚡ Войти в аккаунт') : (isEn ? '✨ Register Account' : '✨ Зарегистрироваться')}
          </button>
          <button type="button" class="btn btn-secondary" style="width: 100%; opacity: 0.8;" onclick="window.app.closeAllModals()">
            ${isEn ? '✕ Cancel' : '✕ Отмена'}
          </button>
        </div>
      </form>
    `;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  async handleAuthSubmit(e, mode = 'login') {
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const email = document.getElementById('auth-email-input')?.value.trim();
    const password = document.getElementById('auth-password-input')?.value;
    const nameInput = document.getElementById('auth-name-input');
    const name = nameInput ? nameInput.value.trim() : '';
    const submitBtn = document.getElementById('auth-submit-btn');

    if (!email || !password) {
      this.showToast(isEn ? 'Please fill in all required fields' : 'Заполните все обязательные поля', 'warning');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = isEn ? '⏳ Authenticating...' : '⏳ Авторизация в Supabase...';
    }

    try {
      if (mode === 'login') {
        await window.auth.signInSupabase(email, password);
        const isAdmin = window.auth.isAdmin();
        const user = window.auth.getUser();
        this.showToast(isEn ? `Welcome back, ${user.name || email}! ${isAdmin ? '👑 (Administrator Mode)' : ''}` : `С возвращением, ${user.name || email}! ${isAdmin ? '👑 (Режим Администратора)' : ''}`, 'success');
      } else {
        await window.auth.signUpSupabase(email, password, name);
        this.showToast(isEn ? `Registration successful! Welcome, ${name || email}!` : `Регистрация успешна! Добро пожаловать, ${name || email}!`, 'success');
      }
      this.closeAllModals();
      this.renderUserHeader();
      this.renderStorefront();
      this.handleRoleVisibility(window.auth.getRole());
    } catch (err) {
      console.warn('Auth error:', err);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'login' ? (isEn ? '⚡ Sign In' : '⚡ Войти в аккаунт') : (isEn ? '✨ Register Account' : '✨ Зарегистрироваться');
      }
      const msg = err.message || '';
      if (msg.includes('Invalid login credentials')) {
        this.showToast(isEn ? 'Invalid email or password' : 'Неверный email или пароль', 'error');
      } else if (msg.includes('User already registered')) {
        this.showToast(isEn ? 'User already registered. Please sign in.' : 'Пользователь с таким email уже зарегистрирован. Переключитесь на вкладку «Вход».', 'warning');
        this.showAuthModal('login');
      } else {
        this.showToast(msg || (isEn ? 'Authentication error' : 'Ошибка авторизации'), 'error');
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
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    modalTitle.textContent = isEn ? '🔑 Password Recovery' : '🔑 Восстановление пароля';
    modalBody.innerHTML = `
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.25rem; line-height: 1.5;">
        ${isEn ? 'Enter the email address registered with your account. We will send you an official link to reset and set a new password.' : 'Введите адрес электронной почты, указанный при регистрации. Мы отправим вам официальное письмо со ссылкой для сброса и установки нового пароля.'}
      </p>
      <form onsubmit="event.preventDefault(); window.app.handleForgotPasswordSubmit(event)">
        <div class="form-group" style="margin-bottom: 1.25rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Email</label>
          <input type="email" id="forgot-email-input" class="input-styled" required placeholder="name@example.com">
        </div>
        <div style="display: flex; gap: 8px; flex-direction: column;">
          <button type="submit" class="btn btn-accent btn-large" style="width: 100%;" id="forgot-submit-btn">
            ${isEn ? '📨 Send Reset Link' : '📨 Отправить ссылку для сброса'}
          </button>
          <button type="button" class="btn btn-secondary" style="width: 100%;" onclick="window.app.showAuthModal('login')">
            ${isEn ? '← Back to Sign In' : '← Вернуться ко входу'}
          </button>
        </div>
      </form>
    `;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  async handleForgotPasswordSubmit(e) {
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const emailInput = document.getElementById('forgot-email-input');
    const email = emailInput ? emailInput.value.trim() : '';
    const submitBtn = document.getElementById('forgot-submit-btn');

    if (!email) {
      this.showToast(isEn ? 'Please enter your email' : 'Укажите ваш email', 'warning');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = isEn ? '⏳ Sending request...' : '⏳ Отправка запроса...';
    }

    try {
      await window.auth.resetPassword(email);
      const modalBody = document.getElementById('generic-modal-body');
      if (modalBody) {
        modalBody.innerHTML = `
          <div style="text-align: center; padding: 1.5rem 0;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">📬</div>
            <h3 style="margin-bottom: 0.5rem; color: #fff;">${isEn ? 'Reset Link Sent!' : 'Письмо успешно отправлено!'}</h3>
            <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem; line-height: 1.5;">
              ${isEn 
                ? `We have sent recovery instructions to <strong>${email}</strong>.<br>Please check your inbox (and spam folder) and click the link to set a new password.`
                : `Мы отправили инструкцию по восстановлению на <strong>${email}</strong>.<br>Проверьте входящие (и папку «Спам») и перейдите по ссылке из письма для ввода нового пароля.`
              }
            </p>
            <button type="button" class="btn btn-secondary" style="width: 100%;" onclick="window.app.closeAllModals()">
              ${isEn ? 'Got it' : 'Понятно'}
            </button>
          </div>
        `;
      }
      this.showToast(isEn ? 'Password recovery link has been sent!' : 'Письмо со ссылкой для восстановления отправлено!', 'success');
    } catch (err) {
      console.warn('Password reset error:', err);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEn ? '📨 Send Reset Link' : '📨 Отправить ссылку для сброса';
      }
      this.showToast(err.message || (isEn ? 'Failed to send reset link' : 'Не удалось отправить письмо для сброса'), 'error');
    }
  }

  showNewPasswordModal() {
    const modal = document.getElementById('generic-modal');
    const modalTitle = document.getElementById('generic-modal-title');
    const modalBody = document.getElementById('generic-modal-body');
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    modalTitle.textContent = isEn ? '🔒 Set New Password' : '🔒 Установка нового пароля';
    modalBody.innerHTML = `
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem; line-height: 1.5;">
        ${isEn ? 'You have successfully verified your account. Please choose a new secure password:' : 'Вы успешно подтвердили доступ к аккаунту. Придумайте новый надёжный пароль:'}
      </p>
      <form onsubmit="event.preventDefault(); window.app.handleNewPasswordSubmit(event)">
        <div class="form-group" style="margin-bottom: 0.85rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">${isEn ? 'New Password' : 'Новый пароль'}</label>
          <input type="password" id="new-password-input" class="input-styled" required minlength="6" placeholder="${isEn ? 'At least 6 characters' : 'Минимум 6 символов'}">
        </div>
        <div class="form-group" style="margin-bottom: 1.25rem;">
          <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">${isEn ? 'Confirm New Password' : 'Повторите новый пароль'}</label>
          <input type="password" id="new-password-confirm-input" class="input-styled" required minlength="6" placeholder="${isEn ? 'Confirm password' : 'Повторите пароль'}">
        </div>
        <div style="display: flex; gap: 8px; flex-direction: column;">
          <button type="submit" class="btn btn-accent btn-large" style="width: 100%;" id="new-password-submit-btn">
            ${isEn ? '💾 Save New Password' : '💾 Сохранить новый пароль'}
          </button>
          <button type="button" class="btn btn-secondary" style="width: 100%; opacity: 0.8;" onclick="window.app.closeAllModals()">
            ${isEn ? '✕ Cancel' : '✕ Отмена'}
          </button>
        </div>
      </form>
    `;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  async handleNewPasswordSubmit(e) {
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const pass = document.getElementById('new-password-input')?.value;
    const confirmPass = document.getElementById('new-password-confirm-input')?.value;
    const submitBtn = document.getElementById('new-password-submit-btn');

    if (!pass || pass.length < 6) {
      this.showToast(isEn ? 'Password must contain at least 6 characters' : 'Пароль должен содержать минимум 6 символов', 'warning');
      return;
    }

    if (pass !== confirmPass) {
      this.showToast(isEn ? 'Passwords do not match' : 'Пароли не совпадают', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = isEn ? '⏳ Saving new password...' : '⏳ Сохранение нового пароля...';
    }

    try {
      await window.auth.updateUserPassword(pass);
      this.showToast(isEn ? '🎉 Password successfully updated! You are now signed in.' : '🎉 Пароль успешно изменён! Вы вошли в аккаунт.', 'success');
      this.closeAllModals();
      this.renderUserHeader();
      this.renderStorefront();
      this.handleRoleVisibility(window.auth.getRole());
    } catch (err) {
      console.warn('Password update error:', err);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEn ? '💾 Save New Password' : '💾 Сохранить новый пароль';
      }
      this.showToast(err.message || (isEn ? 'Failed to update password' : 'Не удалось изменить пароль'), 'error');
    }
  }

  setupModals() {
    // Кнопки крестика закрывают окно
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const parentModal = btn.closest('.modal-backdrop');
        if (parentModal && parentModal.id === 'topup-modal' && this.openedFromHistory) {
          this.openedFromHistory = false;
          this.closeAllModals();
          this.showDepositHistoryModal();
          return;
        }
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
