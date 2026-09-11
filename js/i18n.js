/**
 * i18n — Система интернационализации (RU / EN)
 * Управляет языком интерфейса и переводами статических элементов и карточек.
 * По умолчанию для гостей и новых пользователей язык — English ('en').
 */
class I18nManager {
  constructor(store) {
    this.store = store;

    // Определение языка по умолчанию:
    // 1. Сохранённый ручной выбор в localStorage ('orb_preferred_lang')
    // 2. Если пользователь гость или нет явного выбора — строго 'en'
    // 3. Для авторизованных пользователей — сохранённый siteLang или 'en'
    const savedManual = localStorage.getItem('orb_preferred_lang');
    if (savedManual && ['ru', 'en'].includes(savedManual)) {
      this.currentLang = savedManual;
    } else {
      const isGuest = !this.store.data || !this.store.data.currentUser || this.store.data.currentUser.id === 'guest';
      this.currentLang = isGuest ? 'en' : (this.store.data.siteLang || 'en');
    }

    if (this.store.data) {
      this.store.data.siteLang = this.currentLang;
    }

    this.translations = {
      ru: {
        // Navigation & Header
        nav_catalog: '🛒 Каталог',
        nav_purchases: '📚 Мои покупки',
        nav_admin: '👑 Админ-панель',
        role_guest: '👤 Гость',
        role_user: '🛡️ Пользователь',
        role_admin: '👑 Админ',
        btn_login: '🔑 Войти',
        btn_logout: '🚪 Выйти',
        btn_history: '📜 История',
        btn_topup: '➕ Пополнить',
        btn_cancel: '✕ Отмена',
        btn_save: '💾 Сохранить',
        btn_close: '✕ Закрыть',
        header_history_btn: '📜 История',
        header_history_title: 'История пополнений баланса',
        header_logout_btn: '🚪 Выйти',
        header_logout_title: 'Выйти из аккаунта',
        header_lang_switch_title: 'Выбор языка интерфейса / Select site language',
        header_balance_title: 'Баланс Орбов (1 Орб = 1 USDT)',
        header_topup_title: 'Пополнить Орбы через USDT / BTC',
        header_user_title: 'Пользователь',

        // Hero Banner
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

        // Catalog Section
        section_catalog_title: '🔥 Доступные переводы',
        section_catalog_sub: 'Каждая работа содержит бесплатные страницы превью и адаптированный скрипт перевода',
        card_preview_free: 'стр. бесплатно',
        card_btn_preview: '👁️ Превью',
        card_btn_buy: '⚡ Купить за',
        card_btn_read: '📖 Читать перевод',
        card_btn_login_to_buy: '🔑 Войти для покупки',
        card_access_granted: '✓ Доступ открыт',
        card_total_pages: 'Всего:',
        card_author: 'Автор:',
        currency_orb: 'Орб',

        // Purchases Section & Tabs
        section_purchases_title: '📚 Мои переводы и финансы',
        section_purchases_sub: 'Купленные скрипты новелл и история криптовалютных пополнений баланса',
        purchases_subtab_works: '📚 Приобретённые переводы',
        purchases_subtab_deposits: '🪙 История пополнений счёта',
        purchases_guest_title: 'Войдите в аккаунт',
        purchases_guest_desc: 'Чтобы просматривать купленные работы и историю пополнений, выполните вход.',
        purchases_guest_btn: '🔑 Войти / Зарегистрироваться',
        purchases_empty_title: 'У вас пока нет купленных переводов',
        purchases_empty_desc: 'Перейдите в каталог, чтобы ознакомиться с доступными работами и бесплатными превью.',
        purchases_go_catalog: 'Перейти в каталог',

        // Deposits History Table
        deposits_table_title: '🪙 История крипто-пополнений (USDT / BTC)',
        deposits_refresh_btn: '🔄 Обновить историю',
        deposits_th_date: 'Дата',
        deposits_th_order: 'ID Заказа',
        deposits_th_network: 'Сеть / Валюта',
        deposits_th_amount: 'Сумма перевода',
        deposits_th_orbs: 'Зачислено Орбов',
        deposits_th_tx: 'Транзакция в блокчейне',
        deposits_th_status: 'Статус',
        deposits_loading: '⏳ Загрузка истории транзакций...',
        deposits_empty: '🪙 История пополнений пока пуста. Пополните баланс через кнопку «+» возле баланса.',
        deposits_status_completed: '✅ Завершено',
        deposits_status_pending: '⏳ Ожидание',
        deposits_error: 'Не удалось загрузить историю транзакций',
        deposits_explorer_tooltip: 'Открыть в блокчейн-эксплорере',

        // Topup Modal
        modal_topup_title: '🪙 Пополнение баланса Орбов',
        modal_topup_desc: '1 Орб = 1 USDT. Оплата происходит прямым переводом на уникальный адрес кошелька выбранной сети.',
        modal_topup_step1_badge: 'Шаг 1 из 2: Настройка платежа',
        modal_topup_step2_badge: 'Шаг 2 из 2: Оплата и реквизиты',
        modal_topup_step1_desc: 'Выберите количество Орбов и сеть для оплаты. Курс будет зафиксирован ровно на 30 минут после перехода к оплате.',
        modal_topup_preset_label: 'Быстрый выбор количества:',
        modal_topup_calc_receive: 'Будет начислено:',
        modal_topup_calc_rate: 'Текущий курс обмена:',
        modal_topup_calc_approx: 'К оплате (расчёт):',
        modal_topup_calc_lock_notice: '🔒 Точный курс и уникальная сумма будут зафиксированы на 30 минут на следующем шаге.',
        modal_topup_btn_proceed: 'Перейти к оплате →',
        modal_topup_btn_cancel_step: '✕ Отменить заказ и вернуться',
        modal_topup_rate_locked_badge: '🔒 Курс зафиксирован на 30 мин',
        modal_topup_timer_label: '⏱️ Окно оплаты:',
        modal_topup_timer_notice: 'Отправьте перевод или отмените заказ до истечения 30 минут.',
        modal_topup_expired_alert: '⚠️ Время бронирования курса (30 мин) истекло. Вернитесь на Шаг 1 для перерасчёта по актуальному курсу.',
        modal_topup_amount: 'Количество Орбов',
        modal_topup_network: 'Способ оплаты / Валюта',
        modal_topup_order: 'Заказ:',
        modal_topup_to_pay: 'К оплате:',
        modal_topup_address: 'Адрес для перевода',
        modal_topup_copy: '📋 Копия',
        modal_topup_derivation: 'Сеть / Метод:',
        modal_topup_time: '⏱️ Время на оплату:',
        modal_topup_qr_hint: '📷 Отсканируйте в кошельке (TronLink / Trust Wallet / Binance)',
        modal_topup_tracking_text: '📡 Сканирование блокчейна каждые 12 сек...',
        modal_topup_check_btn: '🔄 Проверить поступление в блокчейне',
        modal_topup_history_btn: '📜 Посмотреть историю моих пополнений',
        modal_topup_copy_success: 'Адрес кошелька скопирован в буфер обмена',
        modal_topup_exact_hint: '⚠️ Переведите точную сумму с копейками выше — это позволяет системе автоматически определить ваш платёж среди других.',
        modal_topup_txid_label: 'Уже отправили перевод? Проверьте по хэшу транзакции (TxID):',
        modal_topup_txid_btn: '⚡ Проверить TxID',
        modal_topup_txid_placeholder: 'Вставьте хэш транзакции (TxID)...',
        txid_already_used: 'Эта транзакция уже была зачислена ранее.',
        txid_invalid: 'Транзакция не найдена в сети или отправлена на другой адрес.',

        // Insufficient Orbs Modal
        insufficient_orbs_title: 'Недостаточно Орбов',
        insufficient_orbs_msg: 'Для покупки перевода необходимо',
        insufficient_orbs_missing: 'Вам не хватает:',
        btn_topup_balance: '➕ Пополнить баланс',

        // Archive Upload Modal
        modal_archive_title: '📖 Открытие перевода:',
        modal_archive_preview_title: '👁️ Бесплатное превью:',
        modal_archive_desc: 'Вы приобрели доступ к скрипту перевода этой работы. Чтобы начать чтение, загрузите официальный архив (.zip) или папку с оригинальными изображениями. Читалка распакует их в браузере и наложит перевод.',
        modal_archive_drop: 'Перетащите сюда ZIP-архив или папку с графикой',
        modal_archive_sub: 'Поддерживаются архивы (.zip, .cbz) или папки с оригинальными файлами изображений',
        modal_archive_pick_zip: '📦 Выбрать ZIP-архив (.zip)',
        modal_archive_pick_folder: '📂 Выбрать папку с графикой',
        modal_archive_no_file: 'Нет под рукой оригинального архива?',
        modal_archive_demo_btn: '💡 Использовать демо-сцены',

        // Reader
        reader_btn_close: '✕ Закрыть',
        reader_mode_full: '✨ Полный перевод',
        reader_mode_preview: '👁️ Бесплатное превью',
        reader_btn_single: '📄 1 страница',
        reader_btn_spread: '📖 2 разворота',
        reader_screen_1: '📖 1 экран',
        reader_screen_2: '📖 2 экрана',
        reader_lock_title: 'Бесплатное превью завершено',
        reader_lock_desc: 'Вы просмотрели доступные страницы превью. Чтобы продолжить чтение всей новеллы с наложением перевода, приобретите работу.',
        reader_lock_cost: 'Стоимость:',
        reader_lock_login_btn: '🔑 Войти / Зарегистрироваться',
        reader_lock_buy_btn: '⚡ Купить перевод за',

        // Auth & Passwords
        auth_tab_login: '🔑 Вход',
        auth_tab_register: '✨ Регистрация',
        auth_title_login: '🔑 Вход в аккаунт',
        auth_title_register: '✨ Регистрация аккаунта',
        auth_name_label: 'Ваше имя / Никнейм',
        auth_name_placeholder: 'Например: Иван',
        auth_email_label: 'Электронная почта (Email)',
        auth_password_label: 'Пароль',
        auth_password_placeholder: 'Минимум 6 символов',
        auth_confirm_password_label: 'Повторите пароль',
        auth_confirm_password_placeholder: 'Повторите пароль',
        auth_forgot_password: '❓ Забыли пароль?',
        auth_btn_login: '⚡ Войти в аккаунт',
        auth_btn_register: '✨ Зарегистрироваться',
        auth_loading: '⏳ Авторизация в Supabase...',
        auth_recovery_title: '🔑 Восстановление пароля',
        auth_recovery_desc: 'Введите адрес электронной почты, указанный при регистрации. Мы отправим вам официальное письмо со ссылкой для сброса и установки нового пароля.',
        auth_recovery_btn: '📨 Отправить ссылку для сброса',
        auth_recovery_back: '← Вернуться ко входу',
        auth_recovery_sent_title: 'Письмо успешно отправлено!',
        auth_recovery_sent_desc: 'Мы отправили инструкцию по восстановлению на ваш email. Проверьте папку «Входящие» (и «Спам») и перейдите по ссылке из письма.',
        auth_recovery_got_it: 'Понятно',
        auth_new_pass_title: '🔒 Установка нового пароля',
        auth_new_pass_desc: 'Вы успешно подтвердили доступ к аккаунту. Придумайте новый надёжный пароль:',
        auth_new_pass_btn: '💾 Сохранить новый пароль',

        // Admin Panel
        section_admin_title: '👑 Панель администратора',
        section_admin_sub: 'Управление каталогом работ, ценами в Орбах, страницами превью и xPub кошельком',
        admin_add_title: '➕ Регистрация новой работы',
        admin_edit_title: '✏️ Редактирование работы',
        admin_title_ru: '🇷🇺 Название работы (русское) *',
        admin_title_en: '🇬🇧 Title (English) *',
        admin_author: 'Автор перевода / Команда',
        admin_price: 'Стоимость покупки в Орбах (1 Орб = 1 USDT) *',
        admin_total_pages: '📄 Всего страниц в работе',
        admin_pages_calc: '(вычисляется из скрипта)',
        admin_pages_detected: 'страниц определено',
        admin_badge_auto: 'Авто',
        admin_preview_pages: 'Страниц в бесплатном превью:',
        admin_tags: 'Теги / Жанры (через запятую)',
        admin_cover_label: '🖼️ Ссылка на обложку работы (URL картинки для превью на витрине)',
        admin_cover_hint: 'Прямая ссылка или выбор файла',
        admin_cover_pick_btn: '📁 Выбрать файл',
        admin_cover_preview_title: 'Предпросмотр обложки:',
        admin_cover_desc_hint: 'Эта иллюстрация отображается на карточке работы в каталоге и в списке покупок.',
        admin_cover_reset_btn: '✕ Сбросить',
        admin_desc_ru: '🇷🇺 Описание работы (русское)',
        admin_desc_en: '🇬🇧 Description (English)',
        admin_script_label: '📄 Скрипт перевода (.txt)',
        admin_script_pick: '📁 Выбрать .txt файл скрипта',
        admin_script_hint: 'Формат с разметкой 【LANG】 и 【OVERLAY_DATA】',
        admin_script_placeholder: 'Или вставьте текст скрипта перевода напрямую сюда...',
        admin_btn_save: '✨ Зарегистрировать работу на сайте',
        admin_btn_update: '💾 Сохранить изменения работы',
        admin_btn_cancel: '✕ Отмена редактирования',
        admin_table_title: '📋 Зарегистрированные работы',
        admin_th_id: 'ID',
        admin_th_title: 'Название (RU / EN)',
        admin_th_price: 'Цена',
        admin_th_preview: 'Превью',
        admin_th_status: 'Статус',
        admin_th_actions: 'Действия',
        admin_xpub_title: '🔐 Настройки кошельков для приёма платежей (USDT TRC-20 / POL / BTC)',
        admin_wallets_desc: 'Укажите адреса кошельков для приёма оплаты. Система автоматически подставляет нужный адрес и генерирует валидный QR-код при выборе валюты покупателем.',
        admin_default_network: 'Основная сеть по умолчанию',
        admin_order_counter: 'Текущий счётчик заказов',
        admin_wallets_save_btn: '💾 Сохранить адреса кошельков',
        admin_status_default: 'По умолчанию',
        admin_status_active: 'Ссылка активна',
        admin_status_local: 'Локальный файл',
        admin_status_error: 'Ошибка загрузки',
        admin_btn_edit: '✏️ Правка',
        admin_btn_delete: '🗑️',

        // Footer
        footer_desc: 'Orb Translations — децентрализованный коммерческий маркетплейс адаптаций и переводов визуальных новелл. Все права на оригинальные графические материалы принадлежат их законным правообладателям.',
        footer_right: 'Powered by GitHub Pages & HD-Wallet xPub Architecture'
      },
      en: {
        // Navigation & Header
        nav_catalog: '🛒 Catalog',
        nav_purchases: '📚 My Purchases',
        nav_admin: '👑 Admin Panel',
        role_guest: '👤 Guest',
        role_user: '🛡️ User',
        role_admin: '👑 Admin',
        btn_login: '🔑 Sign In',
        btn_logout: '🚪 Sign Out',
        btn_history: '📜 History',
        btn_topup: '➕ Deposit',
        btn_cancel: '✕ Cancel',
        btn_save: '💾 Save',
        btn_close: '✕ Close',
        header_history_btn: '📜 History',
        header_history_title: 'Deposit and transaction history',
        header_logout_btn: '🚪 Sign Out',
        header_logout_title: 'Sign out of your account',
        header_lang_switch_title: 'Select site language / Выбор языка интерфейса',
        header_balance_title: 'Orbs Balance (1 Orb = 1 USDT)',
        header_topup_title: 'Deposit Orbs via USDT / BTC',
        header_user_title: 'User',

        // Hero Banner
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

        // Catalog Section
        section_catalog_title: '🔥 Available Translations',
        section_catalog_sub: 'Each release includes free preview pages and adapted translation overlay scripts',
        card_preview_free: 'pages free',
        card_btn_preview: '👁️ Preview',
        card_btn_buy: '⚡ Buy for',
        card_btn_read: '📖 Read Translation',
        card_btn_login_to_buy: '🔑 Sign In to Buy',
        card_access_granted: '✓ Unlocked',
        card_total_pages: 'Total:',
        card_author: 'Author:',
        currency_orb: 'Orbs',

        // Purchases Section & Tabs
        section_purchases_title: '📚 My Translations & Finances',
        section_purchases_sub: 'Purchased novel scripts and cryptocurrency deposit history',
        purchases_subtab_works: '📚 Purchased Translations',
        purchases_subtab_deposits: '🪙 Deposit History',
        purchases_guest_title: 'Sign In to Your Account',
        purchases_guest_desc: 'Please sign in to view your purchased scripts and deposit history.',
        purchases_guest_btn: '🔑 Sign In / Register',
        purchases_empty_title: 'You have no unlocked translations yet',
        purchases_empty_desc: 'Explore the catalog to read free previews and unlock full adaptations.',
        purchases_go_catalog: 'Go to Catalog',

        // Deposits History Table
        deposits_table_title: '🪙 Crypto Deposit History (USDT / BTC)',
        deposits_refresh_btn: '🔄 Refresh History',
        deposits_th_date: 'Date',
        deposits_th_order: 'Order ID',
        deposits_th_network: 'Network / Currency',
        deposits_th_amount: 'Amount',
        deposits_th_orbs: 'Orbs Credited',
        deposits_th_tx: 'Blockchain Transaction',
        deposits_th_status: 'Status',
        deposits_loading: '⏳ Loading transaction history...',
        deposits_empty: '🪙 Deposit history is currently empty. Top up your balance using the "+" button next to your balance.',
        deposits_status_completed: '✅ Completed',
        deposits_status_pending: '⏳ Pending',
        deposits_error: 'Failed to load transaction history',
        deposits_explorer_tooltip: 'View in blockchain explorer',

        // Topup Modal
        modal_topup_title: '🪙 Deposit Orbs Balance',
        modal_topup_desc: '1 Orb = 1 USDT. Payments are made via direct transfer to the unique address of the selected blockchain network.',
        modal_topup_step1_badge: 'Step 1 of 2: Configure Deposit',
        modal_topup_step2_badge: 'Step 2 of 2: Payment & Invoice',
        modal_topup_step1_desc: 'Select the amount of Orbs and payment network. The exchange rate will be locked for exactly 30 minutes once you proceed.',
        modal_topup_preset_label: 'Quick amount select:',
        modal_topup_calc_receive: 'You will receive:',
        modal_topup_calc_rate: 'Current Exchange Rate:',
        modal_topup_calc_approx: 'Estimated Payment:',
        modal_topup_calc_lock_notice: '🔒 Exact rate and unique payment amount will be locked for 30 minutes on the next step.',
        modal_topup_btn_proceed: 'Proceed to Payment →',
        modal_topup_btn_cancel_step: '✕ Cancel Order & Go Back',
        modal_topup_rate_locked_badge: '🔒 Rate Locked for 30 min',
        modal_topup_timer_label: '⏱️ Payment Window:',
        modal_topup_timer_notice: 'Complete your transfer or cancel order before the 30-minute timer expires.',
        modal_topup_expired_alert: '⚠️ Payment window (30 min) has expired. Return to Step 1 to refresh with the current live rate.',
        modal_topup_amount: 'Orbs Amount',
        modal_topup_network: 'Payment Method / Currency',
        modal_topup_order: 'Order:',
        modal_topup_to_pay: 'To Pay:',
        modal_topup_address: 'Deposit Address',
        modal_topup_copy: '📋 Copy',
        modal_topup_derivation: 'Network / Method:',
        modal_topup_time: '⏱️ Payment Window:',
        modal_topup_qr_hint: '📷 Scan in wallet app (TronLink / Trust Wallet / Binance)',
        modal_topup_tracking_text: '📡 Scanning blockchain every 12s...',
        modal_topup_check_btn: '🔄 Check Blockchain for Payment',
        modal_topup_history_btn: '📜 View Deposit History',
        modal_topup_copy_success: 'Wallet address copied to clipboard',
        modal_topup_exact_hint: '⚠️ Please transfer the exact amount shown above so our system automatically identifies your order.',
        modal_topup_txid_label: 'Already sent transfer? Verify instantly by Transaction Hash (TxID):',
        modal_topup_txid_btn: '⚡ Check TxID',
        modal_topup_txid_placeholder: 'Paste transaction hash (TxID)...',
        txid_already_used: 'This transaction has already been credited.',
        txid_invalid: 'Transaction not found or recipient address does not match.',

        // Insufficient Orbs Modal
        insufficient_orbs_title: 'Insufficient Orbs',
        insufficient_orbs_msg: 'To purchase this translation, you need',
        insufficient_orbs_missing: 'Missing balance:',
        btn_topup_balance: '➕ Deposit Balance',

        // Archive Upload Modal
        modal_archive_title: '📖 Launch Translation:',
        modal_archive_preview_title: '👁️ Free Preview:',
        modal_archive_desc: 'You own access to this translation script. To begin reading, please upload your official archive (.zip) or graphics folder. The reader will extract images in-memory and apply the translation overlay.',
        modal_archive_drop: 'Drop your ZIP archive or graphics folder here',
        modal_archive_sub: 'Supported archives (.zip, .cbz) or folders with original image files',
        modal_archive_pick_zip: '📦 Select ZIP Archive (.zip)',
        modal_archive_pick_folder: '📂 Select Graphics Folder',
        modal_archive_no_file: 'Do not have the original archive handy?',
        modal_archive_demo_btn: '💡 Use Built-in Demo Scenes',

        // Reader
        reader_btn_close: '✕ Close',
        reader_mode_full: '✨ Full Translation',
        reader_mode_preview: '👁️ Free Preview',
        reader_btn_single: '📄 1 Page',
        reader_btn_spread: '📖 2 Pages',
        reader_screen_1: '📖 1 Screen',
        reader_screen_2: '📖 2 Screens',
        reader_lock_title: 'Free Preview Concluded',
        reader_lock_desc: 'You have viewed all available free preview pages. To continue reading with full translation overlays, please purchase this release.',
        reader_lock_cost: 'Price:',
        reader_lock_login_btn: '🔑 Sign In / Register',
        reader_lock_buy_btn: '⚡ Buy Translation for',

        // Auth & Passwords
        auth_tab_login: '🔑 Sign In',
        auth_tab_register: '✨ Register',
        auth_title_login: '🔑 Sign In to Account',
        auth_title_register: '✨ Create an Account',
        auth_name_label: 'Your Name / Nickname',
        auth_name_placeholder: 'e.g. John',
        auth_email_label: 'Email Address',
        auth_password_label: 'Password',
        auth_password_placeholder: 'At least 6 characters',
        auth_confirm_password_label: 'Confirm Password',
        auth_confirm_password_placeholder: 'Confirm password',
        auth_forgot_password: '❓ Forgot Password?',
        auth_btn_login: '⚡ Sign In',
        auth_btn_register: '✨ Create Account',
        auth_loading: '⏳ Authenticating with Supabase...',
        auth_recovery_title: '🔑 Password Recovery',
        auth_recovery_desc: 'Enter your registered email address. We will send you an official secure link to reset and set a new password.',
        auth_recovery_btn: '📨 Send Reset Link',
        auth_recovery_back: '← Back to Sign In',
        auth_recovery_sent_title: 'Reset Link Sent!',
        auth_recovery_sent_desc: 'We have sent recovery instructions to your email. Check your inbox (and spam folder) and click the link to set your new password.',
        auth_recovery_got_it: 'Got it',
        auth_new_pass_title: '🔒 Set New Password',
        auth_new_pass_desc: 'You have successfully verified your account access. Please enter a new secure password:',
        auth_new_pass_btn: '💾 Save New Password',

        // Admin Panel
        section_admin_title: '👑 Administrator Dashboard',
        section_admin_sub: 'Manage releases, Orb pricing, preview page allowances, and xPub settings',
        admin_add_title: '➕ Register New Translation',
        admin_edit_title: '✏️ Edit Translation',
        admin_title_ru: '🇷🇺 Title (Russian) *',
        admin_title_en: '🇬🇧 Title (English) *',
        admin_author: 'Translator / Team',
        admin_price: 'Price in Orbs (1 Orb = 1 USDT) *',
        admin_total_pages: '📄 Total Pages in Release',
        admin_pages_calc: '(calculated from script)',
        admin_pages_detected: 'pages detected',
        admin_badge_auto: 'Auto',
        admin_preview_pages: 'Free Preview Pages:',
        admin_tags: 'Tags / Genres (comma-separated)',
        admin_cover_label: '🖼️ Cover Image Link (preview URL)',
        admin_cover_hint: 'Direct URL or select file',
        admin_cover_pick_btn: '📁 Select File',
        admin_cover_preview_title: 'Cover Preview:',
        admin_cover_desc_hint: 'This image is displayed on the work card in the catalog and purchases list.',
        admin_cover_reset_btn: '✕ Reset',
        admin_desc_ru: '🇷🇺 Description (Russian)',
        admin_desc_en: '🇬🇧 Description (English)',
        admin_script_label: '📄 Translation Script (.txt)',
        admin_script_pick: '📁 Select .txt Script File',
        admin_script_hint: 'Format with 【LANG】 and 【OVERLAY_DATA】 markers',
        admin_script_placeholder: 'Or paste translation script text directly here...',
        admin_btn_save: '✨ Register Work on Site',
        admin_btn_update: '💾 Save Work Changes',
        admin_btn_cancel: '✕ Cancel Editing',
        admin_table_title: '📋 Registered Releases',
        admin_th_id: 'ID',
        admin_th_title: 'Title (RU / EN)',
        admin_th_price: 'Price',
        admin_th_preview: 'Preview',
        admin_th_status: 'Status',
        admin_th_actions: 'Actions',
        admin_xpub_title: '🔐 Wallet Settings for Receiving Payments (USDT TRC-20 / POL / BTC)',
        admin_wallets_desc: 'Specify wallet addresses for receiving payments. The system automatically selects the address and generates a valid QR code based on user selection.',
        admin_default_network: 'Default Network',
        admin_order_counter: 'Current Order Counter',
        admin_wallets_save_btn: '💾 Save Wallet Addresses',
        admin_status_default: 'Default',
        admin_status_active: 'Link active',
        admin_status_local: 'Local file',
        admin_status_error: 'Load error',
        admin_btn_edit: '✏️ Edit',
        admin_btn_delete: '🗑️',

        // Footer
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
    localStorage.setItem('orb_preferred_lang', lang);
    if (this.store.data) {
      this.store.data.siteLang = lang;
      this.store.saveToStorage();
    }
    this.applyTranslations();
    if (window.app) {
      window.app.renderStorefront();
      window.app.renderUserHeader();
      window.app.renderPurchases();
      if (window.app.onTopupConfigChange) window.app.onTopupConfigChange();
      if (window.admin) window.admin.renderWorksTable();
    }
    if (window.reader && window.reader.isOpen) {
      window.reader.updateReaderDisplay();
    }
  }

  t(key) {
    const dict = this.translations[this.currentLang] || this.translations['en'];
    return dict[key] || (this.translations['ru'] && this.translations['ru'][key]) || key;
  }

  /**
   * Возвращает локализованное название работы
   */
  getWorkTitle(work) {
    if (!work) return '';
    if (typeof work.title === 'object') {
      return (this.currentLang === 'en' && work.title.en) ? work.title.en : (work.title.ru || work.title.en || '');
    }
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
   * Обновление всех элементов data-i18n на странице
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

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const text = this.t(key);
      if (text) {
        el.title = text;
      }
    });

    // Обновление кнопок переключения языка
    const langBtnRu = document.getElementById('lang-btn-ru');
    const langBtnEn = document.getElementById('lang-btn-en');
    if (langBtnRu && langBtnEn) {
      langBtnRu.classList.toggle('active', this.currentLang === 'ru');
      langBtnEn.classList.toggle('active', this.currentLang === 'en');
    }
  }
}

window.i18n = new I18nManager(window.store);
