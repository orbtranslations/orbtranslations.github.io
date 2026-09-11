/**
 * i18n — Система интернационализации (RU / EN)
 * Управляет языком интерфейса и переводами статических элементов и карточек.
 */
class I18nManager {
  constructor(store) {
    this.store = store;
    this.currentLang = this.store.data.siteLang || 'ru';
    this.translations = {
      ru: {
        nav_catalog: '🛒 Каталог',
        nav_purchases: '📚 Мои покупки',
        nav_admin: '👑 Админ-панель',
        role_guest: '👤 Гость',
        role_user: '🛡️ Пользователь',
        role_admin: '👑 Админ',
        btn_login: '🔑 Войти',
        btn_topup: '➕ Пополнить',
        hero_badge: '💎 Платформа коммерческих переводов нового поколения',
        hero_title_1: 'Читайте любимые новеллы на ',
        hero_title_accent: 'родном языке',
        hero_desc: 'Художественные переводы визуальных новелл и манги. Покупайте доступ за Орбы (1 Орб = 1 USDT) через безопасный HD-кошелек, открывайте бесплатные превью и читайте наложение текста прямо в браузере.',
        hero_stat_rate: '1 Орб = 1 USDT',
        hero_stat_rate_lbl: 'Курс валюты',
        hero_stat_xpub: 'xPub HD-Wallet',
        hero_stat_xpub_lbl: 'Индивидуальный адрес заказа',
        hero_stat_engine: 'Клиентский движок',
        hero_stat_engine_lbl: 'Защита авторских прав',
        section_catalog_title: '🔥 Доступные переводы',
        section_catalog_sub: 'Каждая работа содержит бесплатные страницы превью и адаптированный скрипт перевода',
        section_purchases_title: '📚 Мои приобретенные переводы',
        section_purchases_sub: 'Все купленные скрипты с неограниченным доступом к чтению',
        section_admin_title: '👑 Панель администратора',
        section_admin_sub: 'Управление каталогом работ, ценами в Орбах, страницами превью и xPub кошельком',
        admin_add_title: '➕ Регистрация новой работы',
        admin_edit_title: '✏️ Редактирование работы',
        admin_title_ru: 'Название (русское) *',
        admin_title_en: 'Title (English) *',
        admin_author: 'Автор перевода / Команда',
        admin_price: 'Стоимость в Орбах (1 Орб = 1 USDT) *',
        admin_total_pages: 'Всего страниц в работе',
        admin_preview_pages: 'Страниц в бесплатном превью:',
        admin_tags: 'Теги / Жанры (через запятую)',
        admin_desc_ru: 'Описание (русское)',
        admin_desc_en: 'Description (English)',
        admin_script_label: '📄 Скрипт перевода (.txt)',
        admin_script_pick: '📁 Выбрать .txt файл скрипта',
        admin_script_hint: 'Формат с разметкой 【LANG】 и 【OVERLAY_DATA】',
        admin_script_placeholder: 'Или вставьте текст скрипта перевода напрямую сюда...',
        admin_btn_save: '✨ Зарегистрировать работу на сайте',
        admin_btn_update: '💾 Сохранить изменения работы',
        admin_btn_cancel: '✕ Отмена редактирования',
        admin_table_title: '📋 Зарегистрированные работы',
        admin_xpub_title: '🔐 Настройки кошельков (USDT TRC-20 / POL / BTC)',
        card_preview_free: 'стр. бесплатно',
        card_btn_preview: '👁️ Превью',
        card_btn_buy: '⚡ Купить за',
        card_btn_read: '📖 Читать перевод',
        card_btn_login_to_buy: '🔑 Войти для покупки',
        card_access_granted: '✓ Доступ открыт',
        card_total_pages: 'Всего:',
        card_author: 'Автор:',
        modal_topup_title: '🪙 Пополнение баланса Орбов',
        modal_topup_desc: '1 Орб = 1 USDT. Оплата принимается прямым переводом на кошельки USDT (TRC-20), USDT (POL) или Bitcoin (BTC).',
        modal_topup_amount: 'Количество Орбов',
        modal_topup_network: 'Способ оплаты / Валюта',
        modal_topup_order: 'Заказ:',
        modal_topup_to_pay: 'К оплате:',
        modal_topup_address: 'Адрес для перевода',
        modal_topup_copy: '📋 Копия',
        modal_topup_derivation: 'Сеть / Метод:',
        modal_topup_time: '⏱️ Время на оплату:',
        modal_topup_sim_btn: '⚡ Симуляция: Подтвердить получение средств',
        modal_topup_sim_hint: 'В прототипе кнопка выше эмулирует проверку блокчейна и моментально зачисляет средства на баланс.',
        modal_archive_title: '📖 Открытие перевода:',
        modal_archive_desc: 'Вы приобрели доступ к скрипту перевода этой работы. Чтобы начать чтение, загрузите официальный архив (.zip) или папку с оригинальными изображениями. Читалка распакует их в браузере и наложит перевод.',
        modal_archive_drop: 'Перетащите сюда ZIP-архив с изображениями',
        modal_archive_sub: 'или нажмите для выбора файла на вашем компьютере (.zip, .cbz)',
        modal_archive_pick_btn: 'Выбрать файл архива',
        modal_archive_no_file: 'Нет под рукой оригинального архива?',
        modal_archive_demo_btn: '💡 Использовать демо-сцены',
        reader_btn_close: '✕ Закрыть',
        reader_mode_full: '✨ Полный перевод',
        reader_mode_preview: '👁️ Превью',
        reader_btn_single: '📄 1 страница',
        reader_btn_spread: '📖 2 разворота',
        reader_lock_title: 'Бесплатное превью завершено',
        reader_lock_desc: 'Вы просмотрели доступные страницы превью. Чтобы продолжить чтение с полным наложением перевода, приобретите работу.',
        reader_lock_cost: 'Стоимость:',
        reader_lock_login_btn: '🔑 Войти / Зарегистрироваться',
        reader_lock_buy_btn: '⚡ Купить перевод за',
        footer_desc: 'Orb Translations — децентрализованный коммерческий маркетплейс адаптаций и переводов визуальных новелл. Все права на оригинальные графические материалы принадлежат их законным правообладателям.',
        footer_right: 'Powered by GitHub Pages & HD-Wallet xPub Architecture'
      },
      en: {
        nav_catalog: '🛒 Catalog',
        nav_purchases: '📚 My Purchases',
        nav_admin: '👑 Admin Panel',
        role_guest: '👤 Guest',
        role_user: '🛡️ User',
        role_admin: '👑 Admin',
        btn_login: '🔑 Sign In',
        btn_topup: '➕ Deposit',
        hero_badge: '💎 Next-Generation Commercial Translation Platform',
        hero_title_1: 'Read your favorite visual novels in ',
        hero_title_accent: 'your language',
        hero_desc: 'High quality fan translations of visual novels and manga. Purchase access using Orbs (1 Orb = 1 USDT) via secure HD-wallet, explore free previews, and enjoy live text overlay reading directly in your browser.',
        hero_stat_rate: '1 Orb = 1 USDT',
        hero_stat_rate_lbl: 'Exchange Rate',
        hero_stat_xpub: 'xPub HD-Wallet',
        hero_stat_xpub_lbl: 'Unique Order Address',
        hero_stat_engine: 'Client-side Engine',
        hero_stat_engine_lbl: 'Copyright Compliant',
        section_catalog_title: '🔥 Available Translations',
        section_catalog_sub: 'Each release includes free preview pages and adapted translation overlay scripts',
        section_purchases_title: '📚 My Purchased Translations',
        section_purchases_sub: 'All your unlocked scripts with unlimited reading access',
        section_admin_title: '👑 Administrator Dashboard',
        section_admin_sub: 'Manage releases, Orb pricing, preview page allowances, and xPub settings',
        admin_add_title: '➕ Register New Translation',
        admin_edit_title: '✏️ Edit Translation',
        admin_title_ru: 'Title (Russian) *',
        admin_title_en: 'Title (English) *',
        admin_author: 'Translator / Team',
        admin_price: 'Price in Orbs (1 Orb = 1 USDT) *',
        admin_total_pages: 'Total Pages in Work',
        admin_preview_pages: 'Free Preview Pages:',
        admin_tags: 'Tags / Genres (comma-separated)',
        admin_desc_ru: 'Description (Russian)',
        admin_desc_en: 'Description (English)',
        admin_script_label: '📄 Translation Script (.txt)',
        admin_script_pick: '📁 Select .txt Script File',
        admin_script_hint: 'Format with 【LANG】 and 【OVERLAY_DATA】 markers',
        admin_script_placeholder: 'Or paste translation script text directly here...',
        admin_btn_save: '✨ Register Work on Site',
        admin_btn_update: '💾 Save Work Changes',
        admin_btn_cancel: '✕ Cancel Editing',
        admin_table_title: '📋 Registered Releases',
        admin_xpub_title: '🔐 Wallet Settings (USDT TRC-20 / POL / BTC)',
        card_preview_free: 'pages free',
        card_btn_preview: '👁️ Preview',
        card_btn_buy: '⚡ Buy for',
        card_btn_read: '📖 Read Translation',
        card_btn_login_to_buy: '🔑 Sign In to Buy',
        card_access_granted: '✓ Unlocked',
        card_total_pages: 'Total:',
        card_author: 'Author:',
        modal_topup_title: '🪙 Deposit Orbs Balance',
        modal_topup_desc: '1 Orb = 1 USDT. Payments are accepted via direct transfer to USDT (TRC-20), USDT (POL), or Bitcoin (BTC) wallets.',
        modal_topup_amount: 'Orbs Amount',
        modal_topup_network: 'Payment Method / Currency',
        modal_topup_order: 'Order:',
        modal_topup_to_pay: 'To Pay:',
        modal_topup_address: 'Deposit Address',
        modal_topup_copy: '📋 Copy',
        modal_topup_derivation: 'Network / Method:',
        modal_topup_time: '⏱️ Payment Window:',
        modal_topup_sim_btn: '⚡ Simulation: Confirm Receipt of Funds',
        modal_topup_sim_hint: 'In this prototype, the button above simulates blockchain confirmation and credits your balance immediately.',
        modal_archive_title: '📖 Launch Translation:',
        modal_archive_desc: 'You own access to this translation script. To begin reading, please upload your official archive (.zip) or graphics folder. The reader will extract images in-memory and apply the translation overlay.',
        modal_archive_drop: 'Drop your ZIP archive here',
        modal_archive_sub: 'or click to browse from your computer (.zip, .cbz)',
        modal_archive_pick_btn: 'Select Archive File',
        modal_archive_no_file: 'Do not have the original archive handy?',
        modal_archive_demo_btn: '💡 Use Built-in Demo Scenes',
        reader_btn_close: '✕ Close',
        reader_mode_full: '✨ Full Translation',
        reader_mode_preview: '👁️ Preview',
        reader_btn_single: '📄 1 Page',
        reader_btn_spread: '📖 2-Page Spread',
        reader_lock_title: 'Free Preview Concluded',
        reader_lock_desc: 'You have viewed all available free preview pages. To continue reading with full translation overlays, please purchase this release.',
        reader_lock_cost: 'Price:',
        reader_lock_login_btn: '🔑 Sign In / Register',
        reader_lock_buy_btn: '⚡ Buy Translation for',
        footer_desc: 'Orb Translations — decentralized commercial marketplace for visual novel adaptations. All rights to original graphics and assets belong to their respective copyright holders.',
        footer_right: 'Powered by GitHub Pages & HD-Wallet xPub Architecture'
      }
    };
  }

  getLang() {
    return this.currentLang;
  }

  setLang(lang) {
    if (!['ru', 'en'].includes(lang)) return;
    this.currentLang = lang;
    this.store.data.siteLang = lang;
    this.store.saveToStorage();
    this.applyTranslations();
    if (window.app) {
      window.app.renderStorefront();
      window.app.renderUserHeader();
      if (window.admin) window.admin.renderWorksTable();
    }
  }

  t(key) {
    const dict = this.translations[this.currentLang] || this.translations['ru'];
    return dict[key] || key;
  }

  /**
   * Возвращает локализованное название работы
   */
  getWorkTitle(work) {
    if (!work) return '';
    if (typeof work.title === 'object') {
      return (this.currentLang === 'en' && work.title.en) ? work.title.en : (work.title.ru || work.title.en || '');
    }
    // Если title строка
    if (this.currentLang === 'en' && work.originalTitle) {
      return work.originalTitle;
    }
    return work.title;
  }

  /**
   * Возвращает локализованное описание работы
   */
  getWorkDesc(work) {
    if (!work) return '';
    if (typeof work.description === 'object') {
      return (this.currentLang === 'en' && work.description.en) ? work.description.en : (work.description.ru || work.description.en || '');
    }
    return work.description || '';
  }

  /**
   * Обновление всех data-i18n элементов на странице
   */
  applyTranslations() {
    document.documentElement.lang = this.currentLang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const text = this.t(key);
      if (text) {
        el.textContent = text;
      }
    });

    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      const text = this.t(key);
      if (text) {
        el.innerHTML = text;
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const text = this.t(key);
      if (text) {
        el.placeholder = text;
      }
    });

    // Обновление активного состояния селектора языка
    const langBtnRu = document.getElementById('lang-btn-ru');
    const langBtnEn = document.getElementById('lang-btn-en');
    if (langBtnRu && langBtnEn) {
      langBtnRu.classList.toggle('active', this.currentLang === 'ru');
      langBtnEn.classList.toggle('active', this.currentLang === 'en');
    }
  }
}

window.i18n = new I18nManager(window.store);
