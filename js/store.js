/**
 * IDBStorage — Легковесный адаптер IndexedDB для надежного хранения больших объемов данных
 * (включая скрипты переводов размером в мегабайты, которые не помещаются в localStorage).
 */
class IDBStorage {
  static DB_NAME = 'OrbMarketplaceDB';
  static DB_VERSION = 1;
  static STORE_NAME = 'app_state_store';

  static open() {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      try {
        const req = indexedDB.open(IDBStorage.DB_NAME, IDBStorage.DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDBStorage.STORE_NAME)) {
            db.createObjectStore(IDBStorage.STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          console.warn('IndexedDB не удалось открыть, fallback на localStorage:', req.error);
          resolve(null);
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  static async set(key, value) {
    const db = await IDBStorage.open();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDBStorage.STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDBStorage.STORE_NAME);
        store.put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  static async get(key) {
    const db = await IDBStorage.open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDBStorage.STORE_NAME, 'readonly');
        const store = tx.objectStore(IDBStorage.STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }
}

/**
 * Store — Центральное хранилище состояния платформы
 * Хранит каталог работ (с поддержкой RU/EN), баланс Орбов, историю покупок и настройки xPub кошелька.
 * Двухуровневое хранилище: IndexedDB (для больших скриптов) + безопасный кэш localStorage.
 */
class Store {
  static STORAGE_KEY = 'orb_marketplace_data_v3';

  constructor() {
    // 1. Быстрая синхронная загрузка из localStorage для мгновенной отрисовки UI
    this.data = this.loadFromStorage();
    if (!this.data || !this.data.works || this.data.works.length === 0) {
      this.data = this.getDefaultInitialData();
      this.saveToStorage();
    } else {
      this.migrateXpubSettings();
    }

    // 2. Асинхронная подгрузка из IndexedDB (восстанавливает полные тяжелые скрипты и изменения)
    this.initAsyncStorage();
  }

  migrateXpubSettings() {
    if (!this.data) return;
    if (!this.data.xpubSettings) {
      this.data.xpubSettings = {
        masterPublicKey: 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW',
        walletAddress: 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW',
        defaultNetwork: 'USDT (TRC-20)',
        nextOrderIndex: 142,
        wallets: {
          'USDT (TRC-20)': 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW',
          'USDT (Polygon)': '0x3b890765042948355e0a2b0769119d65fdba99ab',
          'BTC': '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe'
        }
      };
      this.saveToStorage();
    } else {
      if (!this.data.xpubSettings.wallets) {
        this.data.xpubSettings.wallets = {};
      }
      this.data.xpubSettings.wallets['USDT (TRC-20)'] = this.data.xpubSettings.wallets['USDT (TRC-20)'] || 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW';
      this.data.xpubSettings.wallets['USDT (Polygon)'] = '0x3b890765042948355e0a2b0769119d65fdba99ab';
      this.data.xpubSettings.wallets['BTC'] = '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe';
      delete this.data.xpubSettings.wallets['USDT (BEP-20)'];

      if (this.data.xpubSettings.defaultNetwork === 'USDT (BEP-20)') {
        this.data.xpubSettings.defaultNetwork = 'USDT (TRC-20)';
      }

      const key = this.data.xpubSettings.masterPublicKey || '';
      if (key.startsWith('xpub6CUGRUon') || !key || key === 'xpub6...') {
        this.data.xpubSettings.masterPublicKey = 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW';
        this.data.xpubSettings.walletAddress = 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW';
      }

      // Сброс старого мок-пользователя usr_77 на гостя
      if (this.data.currentUser && (this.data.currentUser.id === 'usr_77' || !this.data.currentUser.id)) {
        this.data.currentUser = {
          id: 'guest',
          name: 'Guest',
          email: '',
          orbs: 0.0,
          purchasedWorks: []
        };
        this.data.currentRole = 'guest';
      }

      // По умолчанию для гостей и при отсутствии явного выбора — английский язык
      if (!localStorage.getItem('orb_preferred_lang') && (!this.data.currentUser || this.data.currentUser.id === 'guest')) {
        this.data.siteLang = 'en';
      }

      this.saveToStorage();
    }
  }

  async initAsyncStorage() {
    try {
      const idbData = await IDBStorage.get('main_store');
      if (idbData && idbData.works && idbData.works.length > 0) {
        // Объединяем полные скрипты из IndexedDB с текущими данными в памяти
        idbData.works.forEach(idbWork => {
          const memWork = this.data.works.find(w => w.id === idbWork.id);
          if (memWork) {
            // Если в памяти был заглушечный или пустой скрипт, берем полный из IDB
            if (idbWork.sampleScriptText && (!memWork.sampleScriptText || memWork.sampleScriptText.startsWith('[STORED_IN_IDB'))) {
              memWork.sampleScriptText = idbWork.sampleScriptText;
            }
          } else {
            this.data.works.push(idbWork);
          }
        });

        // Если в IDB больше работ или свежее — синхронизируем
        if (idbData.works.length !== this.data.works.length) {
          this.data = idbData;
        }

        this.migrateXpubSettings();

        // 3. Синхронизация с облачной базой данных Supabase
        await this.syncWithSupabase();

        if (window.app) {
          window.app.renderStorefront();
          if (window.admin) window.admin.renderWorksTable();
        }
      } else {
        await this.syncWithSupabase();
      }
    } catch (e) {
      console.warn('Ошибка при инициализации IndexedDB / Supabase:', e);
    }
  }

  async syncWithSupabase() {
    if (!window.supabaseClient) return;

    try {
      // 1. Загрузка каталога работ из Supabase public.works
      const { data: dbWorks, error: worksErr } = await window.supabaseClient
        .from('works')
        .select('*')
        .order('created_at', { ascending: false });

      if (!worksErr && dbWorks && dbWorks.length > 0) {
        const mappedWorks = dbWorks.map(w => ({
          id: w.id,
          title: {
            ru: w.title_ru,
            en: w.title_en || w.title_ru
          },
          description: {
            ru: w.description_ru,
            en: w.description_en || w.description_ru
          },
          author: w.author,
          price: Number(w.price),
          totalPages: w.total_pages,
          previewPagesCount: w.preview_pages_count,
          tags: w.tags || [],
          coverUrl: w.cover_url,
          availableLanguages: w.available_languages || ['Русский', 'English'],
          scriptFileName: w.script_file_name || 'script.txt',
          sampleScriptText: w.sample_script_text || '',
          createdAt: w.created_at ? w.created_at.split('T')[0] : '2026-09-01'
        }));

        this.data.works = mappedWorks;
        this.saveToStorage();
        if (window.app) window.app.renderStorefront();
      }

      // 2. Загрузка настроек кошельков из Supabase
      const { data: ws, error: wsErr } = await window.supabaseClient
        .from('wallet_settings')
        .select('*')
        .eq('id', 1)
        .single();

      if (!wsErr && ws) {
        if (!this.data.xpubSettings.wallets) this.data.xpubSettings.wallets = {};
        if (ws.trc20_address) this.data.xpubSettings.wallets['USDT (TRC-20)'] = ws.trc20_address;
        if (ws.polygon_address) this.data.xpubSettings.wallets['USDT (Polygon)'] = ws.polygon_address;
        if (ws.btc_address) this.data.xpubSettings.wallets['BTC'] = ws.btc_address;
        if (ws.default_network) this.data.xpubSettings.defaultNetwork = ws.default_network;
        this.saveToStorage();
      }

      // 3. Загрузка покупок текущего пользователя
      const currentUserId = this.data.currentUser.id;
      if (currentUserId && !currentUserId.startsWith('usr_')) {
        const { data: userPurchases } = await window.supabaseClient
          .from('purchases')
          .select('work_id')
          .eq('user_id', currentUserId);

        if (userPurchases) {
          const ids = userPurchases.map(p => p.work_id);
          this.data.currentUser.purchasedWorks = Array.from(new Set([...this.data.currentUser.purchasedWorks, ...ids]));
          this.saveToStorage();
          if (window.app) window.app.renderStorefront();
        }
      }
    } catch (err) {
      console.warn('Синхронизация с Supabase ожидает настройки таблиц:', err);
    }
  }

  getDefaultInitialData() {
    return {
      siteLang: 'en', // 'en' | 'ru'
      currentUser: {
        id: 'guest',
        name: 'Guest',
        email: '',
        orbs: 0.0,
        purchasedWorks: []
      },
      currentRole: 'guest', // 'guest' | 'user' | 'admin'
      xpubSettings: {
        masterPublicKey: 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW',
        walletAddress: 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW',
        defaultNetwork: 'USDT (TRC-20)',
        nextOrderIndex: 142,
        wallets: {
          'USDT (TRC-20)': 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW',
          'USDT (Polygon)': '0x3b890765042948355e0a2b0769119d65fdba99ab',
          'BTC': '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe'
        }
      },
      orders: [],
      works: [
        {
          id: 'work-001',
          title: {
            ru: 'Хроники Забытого Клинка: Пролог',
            en: 'Chronicles of the Forgotten Blade: Prologue'
          },
          description: {
            ru: 'Художественный перевод пролога и первой главы визуальной новеллы. Полная адаптация диалоговых окон, кастомные рамки персонажей и наложение реплик с оригинальной стилистикой.',
            en: 'Official fan translation of the prologue and Chapter 1. Complete adaptation of dialogue frames, custom character borders, and dynamic text overlays matching original aesthetics.'
          },
          author: 'Glaive Team',
          price: 1, // 1 Орб = 1 USDT
          totalPages: 4,
          previewPagesCount: 3, // Первые 3 страницы доступны бесплатно всем!
          tags: ['Визуальная новелла', 'Фэнтези', 'Visual Novel', 'Fantasy'],
          coverUrl: 'assets/demo/cover-1.svg',
          previewImages: [
            'assets/demo/page-1.svg',
            'assets/demo/page-2.svg',
            'assets/demo/page-3.svg'
          ],
          availableLanguages: ['Русский', 'English'],
          scriptFileName: 'Chronicles_Prologue_Script.txt',
          sampleScriptText: `【Title】
# Chronicles of the Forgotten Blade - Prologue Translation Script
Image/01-01.png
Image/01-02.png
Image/01-03.png
Image/01-04.png

【Русский】
Image/01-01.png
Снег продолжал падать на руины древней крепости...
Никто не ждал, что этот день станет последним для ордена.

Image/01-02.png
Эй, ты слышишь этот странный гул из подземелья?
Кажется, печать снова начала разрушаться.

Image/01-03.png
Возьми клинок. Если мы не остановим это сейчас — завтра уже не наступит.

Image/01-04.png
Судьба королевства теперь в твоих руках.

【English】
Image/01-01.png
Snow continued to fall upon the ruins of the ancient fortress...
No one expected this day would be the order's last.

Image/01-02.png
Hey, do you hear that strange rumble from the dungeon?
It seems the seal has begun unraveling again.

Image/01-03.png
Take the blade. If we do not stop this now, tomorrow will never come.

Image/01-04.png
The fate of the kingdom is now in your hands.

【OVERLAY_DATA】
{
  "presets": [
    {
      "name": "Story Narrative",
      "fontFamily": "Georgia",
      "fontSize": 24,
      "fontWeight": "normal",
      "color": "#ffffff",
      "strokeColor": "#000000",
      "strokeWidth": 2,
      "lineHeight": 1.4,
      "textAlign": "center",
      "bgColor": "rgba(0,0,0,0.65)",
      "radius": "8px"
    }
  ],
  "entries": {
    "Image/01-01_block_0": { "x": 20, "y": 78, "w": 60, "h": 16, "preset": "Story Narrative" },
    "Image/01-02_block_0": { "x": 15, "y": 74, "w": 70, "h": 18, "borderIndex": 0, "preset": "Story Narrative" },
    "Image/01-03_block_0": { "x": 20, "y": 76, "w": 60, "h": 16, "borderIndex": 2, "preset": "Story Narrative" },
    "Image/01-04_block_0": { "x": 25, "y": 75, "w": 50, "h": 18, "preset": "Story Narrative" }
  }
}`,
          createdAt: '2026-09-01'
        }
      ]
    };
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(Store.STORAGE_KEY);
      if (raw) return JSON.parse(raw);

      // Fallback на предыдущую версию ключа, если пользователь уже заходил
      const oldRaw = localStorage.getItem('orb_marketplace_data_v2');
      if (oldRaw) return JSON.parse(oldRaw);

      return null;
    } catch (e) {
      console.error('Ошибка загрузки Store из localStorage:', e);
      return null;
    }
  }

  /**
   * Сохранение с защитой от переполнения квоты localStorage:
   * 1. Полный объект данных (любого размера) сохраняется в IndexedDB.
   * 2. В localStorage сохраняются все метаданные, а слишком большие скрипты (>30KB)
   *    урезаются до безопасной заглушки, чтобы localStorage НИКОГДА не падал с QuotaExceededError!
   */
  saveToStorage() {
    // 1. Асинхронная запись полного состояния в IndexedDB
    IDBStorage.set('main_store', this.data).catch(err => {
      console.warn('IDBStorage write warning:', err);
    });

    // 2. Подготовка безопасного для квоты слепка для localStorage
    try {
      const safeData = {
        ...this.data,
        works: (this.data.works || []).map(w => {
          const script = w.sampleScriptText || '';
          // Если скрипт тяжелее 30 КБ, сохраняем в localStorage только мета-заглушку,
          // а полный текст живет в IndexedDB и оперативной памяти this.data
          if (script.length > 30000) {
            return {
              ...w,
              sampleScriptText: `[STORED_IN_IDB:${script.length}]`
            };
          }
          return w;
        })
      };

      localStorage.setItem(Store.STORAGE_KEY, JSON.stringify(safeData));
    } catch (e) {
      console.warn('Переполнение квоты localStorage. Сохраняем компактный индекс:', e);
      try {
        // Экстренный компактный режим: убираем все скрипты из localStorage
        const ultraSafeData = {
          ...this.data,
          works: (this.data.works || []).map(w => ({ ...w, sampleScriptText: '' }))
        };
        localStorage.setItem(Store.STORAGE_KEY, JSON.stringify(ultraSafeData));
      } catch (err2) {
        console.error('Критическая ошибка сохранения в localStorage:', err2);
      }
    }
  }

  // Роли
  getRole() {
    return this.data.currentRole || 'guest';
  }

  setRole(role) {
    this.data.currentRole = role;
    this.saveToStorage();
  }

  // Пользователь и Баланс
  getCurrentUser() {
    if (!this.data.currentUser) {
      this.data.currentUser = { id: 'guest', name: 'Guest', email: '', orbs: 0.0, purchasedWorks: [] };
    }
    if (this.data.currentUser.id === 'guest') {
      const isEn = (window.i18n ? window.i18n.getLang() : (this.data.siteLang || 'en')) === 'en';
      this.data.currentUser.name = isEn ? 'Guest' : 'Гость';
    }
    return this.data.currentUser;
  }

  addOrbs(amount, txInfo = {}) {
    this.data.currentUser.orbs = Math.round((this.data.currentUser.orbs + Number(amount)) * 100) / 100;
    this.data.orders.push({
      id: 'ord_' + Date.now(),
      amount: Number(amount),
      date: new Date().toISOString(),
      type: 'topup',
      txInfo
    });
    this.saveToStorage();

    // Синхронизация баланса с профилем в Supabase
    if (window.supabaseClient && this.data.currentUser.id && !this.data.currentUser.id.startsWith('usr_')) {
      window.supabaseClient
        .from('profiles')
        .update({ orbs: this.data.currentUser.orbs, updated_at: new Date().toISOString() })
        .eq('id', this.data.currentUser.id)
        .then(() => {})
        .catch(err => console.warn('Ошибка обновления баланса в Supabase:', err));
    }

    return this.data.currentUser.orbs;
  }

  purchaseWork(workId) {
    const work = this.getWorkById(workId);
    if (!work) return { success: false, message: 'Работа не найдена' };

    if (this.hasPurchased(workId)) {
      return { success: true, message: 'Работа уже приобретена' };
    }

    if (this.data.currentUser.orbs < work.price) {
      return {
        success: false,
        needOrbs: Math.round((work.price - this.data.currentUser.orbs) * 100) / 100,
        message: 'Недостаточно Орбов для покупки'
      };
    }

    this.data.currentUser.orbs = Math.round((this.data.currentUser.orbs - work.price) * 100) / 100;
    this.data.currentUser.purchasedWorks.push(workId);
    this.data.orders.push({
      id: 'ord_' + Date.now(),
      workId,
      workTitle: typeof work.title === 'object' ? (work.title.ru || work.title.en) : work.title,
      price: work.price,
      date: new Date().toISOString(),
      type: 'purchase'
    });
    this.saveToStorage();

    // Синхронизация покупки и баланса с Supabase
    if (window.supabaseClient && this.data.currentUser.id && !this.data.currentUser.id.startsWith('usr_')) {
      window.supabaseClient
        .from('purchases')
        .insert({
          user_id: this.data.currentUser.id,
          work_id: workId,
          price_paid: work.price
        })
        .then(() => {
          return window.supabaseClient
            .from('profiles')
            .update({ orbs: this.data.currentUser.orbs, updated_at: new Date().toISOString() })
            .eq('id', this.data.currentUser.id);
        })
        .catch(err => console.warn('Ошибка сохранения покупки в Supabase:', err));
    }

    return { success: true, newBalance: this.data.currentUser.orbs };
  }

  hasPurchased(workId) {
    if (this.getRole() === 'admin') return true;
    if (this.getRole() === 'guest') return false;
    return (this.data.currentUser.purchasedWorks || []).includes(workId);
  }

  // Каталог
  getWorks() {
    return this.data.works || [];
  }

  getWorkById(id) {
    return (this.data.works || []).find(w => w.id === id);
  }

  addWork(workData) {
    const newId = 'work-' + String(Date.now()).slice(-5);
    const work = {
      id: newId,
      title: typeof workData.title === 'object' 
        ? workData.title 
        : { ru: workData.title || 'Новая работа', en: workData.titleEn || workData.title || 'New Work' },
      description: typeof workData.description === 'object' 
        ? workData.description 
        : { ru: workData.description || '', en: workData.descriptionEn || '' },
      author: workData.author || 'Автор перевода',
      price: Number(workData.price) || 1,
      totalPages: Number(workData.totalPages) || 10,
      previewPagesCount: Number(workData.previewPagesCount) || 3,
      tags: workData.tags || ['Перевод'],
      coverUrl: workData.coverUrl || 'assets/demo/cover-1.svg',
      previewImages: workData.previewImages || [
        'assets/demo/page-1.svg',
        'assets/demo/page-2.svg',
        'assets/demo/page-3.svg'
      ],
      availableLanguages: workData.availableLanguages || ['Русский', 'English'],
      scriptFileName: workData.scriptFileName || 'script.txt',
      sampleScriptText: workData.sampleScriptText || '',
      createdAt: new Date().toISOString().split('T')[0]
    };
    this.data.works.unshift(work);
    this.saveToStorage();
    return work;
  }

  updateWork(id, updatedData) {
    const index = this.data.works.findIndex(w => w.id === id);
    if (index === -1) return null;

    const current = this.data.works[index];
    this.data.works[index] = {
      ...current,
      title: typeof updatedData.title === 'object' 
        ? updatedData.title 
        : { 
            ru: updatedData.title || (current.title ? (current.title.ru || current.title) : ''), 
            en: updatedData.titleEn || (current.title ? (current.title.en || current.title) : '') 
          },
      description: typeof updatedData.description === 'object'
        ? updatedData.description
        : { 
            ru: updatedData.description || (current.description ? (current.description.ru || current.description) : ''), 
            en: updatedData.descriptionEn || (current.description ? (current.description.en || current.description) : '') 
          },
      author: updatedData.author !== undefined ? updatedData.author : current.author,
      price: updatedData.price !== undefined ? Number(updatedData.price) : current.price,
      totalPages: updatedData.totalPages !== undefined ? Number(updatedData.totalPages) : current.totalPages,
      previewPagesCount: updatedData.previewPagesCount !== undefined ? Number(updatedData.previewPagesCount) : current.previewPagesCount,
      tags: updatedData.tags !== undefined ? updatedData.tags : current.tags,
      coverUrl: updatedData.coverUrl !== undefined ? updatedData.coverUrl : (current.coverUrl || 'assets/demo/cover-1.svg'),
      sampleScriptText: updatedData.sampleScriptText !== undefined ? updatedData.sampleScriptText : current.sampleScriptText,
      updatedAt: new Date().toISOString().split('T')[0]
    };

    this.saveToStorage();
    return this.data.works[index];
  }

  deleteWork(id) {
    this.data.works = this.data.works.filter(w => w.id !== id);
    this.saveToStorage();
  }

  // Настройки кошельков и приёма платежей
  getXpubSettings() {
    if (!this.data.xpubSettings) {
      this.migrateXpubSettings();
    }
    return this.data.xpubSettings;
  }

  getWalletAddress(network = 'USDT (TRC-20)') {
    const settings = this.getXpubSettings();
    const wallets = settings.wallets || {};
    if (network.includes('Polygon') || network.includes('POL')) {
      return wallets['USDT (Polygon)'] || '0x3b890765042948355e0a2b0769119d65fdba99ab';
    }
    if (network.includes('BTC') || network.includes('Bitcoin')) {
      return wallets['BTC'] || '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe';
    }
    if (network.includes('TRC-20') || network.includes('Tron') || network.includes('TRX')) {
      return wallets['USDT (TRC-20)'] || settings.walletAddress || settings.masterPublicKey || 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW';
    }
    return wallets[network] || settings.walletAddress || settings.masterPublicKey || 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW';
  }

  updateXpubSettings(newSettings) {
    this.data.xpubSettings = { ...this.data.xpubSettings, ...newSettings };
    if (newSettings.wallets) {
      this.data.xpubSettings.wallets = { ...(this.data.xpubSettings.wallets || {}), ...newSettings.wallets };
    }
    if (newSettings.masterPublicKey) {
      this.data.xpubSettings.walletAddress = newSettings.masterPublicKey;
    }
    this.saveToStorage();
  }

  getNextOrderIndex() {
    const idx = this.data.xpubSettings.nextOrderIndex || 100;
    this.data.xpubSettings.nextOrderIndex = idx + 1;
    this.saveToStorage();
    return idx;
  }

  /**
   * Сохранение сессии крипто-заказа (pending, awaiting_confirmations, completed, cancelled)
   */
  saveCryptoSession(session) {
    if (!session || !session.orderId) return;
    if (!this.data.cryptoSessions) {
      this.data.cryptoSessions = [];
    }
    const idx = this.data.cryptoSessions.findIndex(s => s.orderId === session.orderId);
    if (idx >= 0) {
      this.data.cryptoSessions[idx] = { ...this.data.cryptoSessions[idx], ...session };
    } else {
      this.data.cryptoSessions.push({ ...session });
    }
    this.saveToStorage();

    // Синхронизация статуса с Supabase crypto_orders
    if (window.supabaseClient) {
      const user = this.getCurrentUser();
      const userId = (user.id && !user.id.startsWith('usr_') && user.id !== 'guest') ? user.id : null;
      window.supabaseClient
        .from('crypto_orders')
        .upsert({
          id: session.orderId,
          user_id: userId,
          network: session.network,
          deposit_address: session.address,
          orbs_amount: session.orbsAmount,
          expected_amount: session.expectedAmount,
          status: session.status,
          tx_hash: session.status === 'cancelled' ? null : (session.txHash || null),
          created_at: session.createdAt ? new Date(session.createdAt).toISOString() : new Date().toISOString()
        })
        .then(() => {})
        .catch(err => console.warn('Sync crypto_orders upsert:', err));
    }
  }

  getCryptoSession(orderId) {
    if (!this.data.cryptoSessions) return null;
    return this.data.cryptoSessions.find(s => s.orderId === orderId) || null;
  }

  /**
   * Список уже использованных хэшей транзакций (защита от повторного зачисления)
   */
  getUsedTxHashes() {
    if (!this.data.usedTxHashes) {
      this.data.usedTxHashes = [
        '5f65aecdec663d6dff130a930525d625cfe85b12904461ee3d2d1e824bc4270f'
      ];
      this.saveToStorage();
    }
    return new Set(this.data.usedTxHashes.map(h => (h || '').toLowerCase()));
  }

  markTxHashUsed(txHash) {
    if (!txHash) return;
    const lower = txHash.toLowerCase();
    if (!this.data.usedTxHashes) {
      this.data.usedTxHashes = [
        '5f65aecdec663d6dff130a930525d625cfe85b12904461ee3d2d1e824bc4270f'
      ];
    }
    if (!this.data.usedTxHashes.includes(lower)) {
      this.data.usedTxHashes.push(lower);
      this.saveToStorage();
    }
  }

  getActiveCryptoSession() {
    if (!this.data.cryptoSessions) return null;
    const now = Date.now();
    let changed = false;
    for (const s of this.data.cryptoSessions) {
      const createdAtMs = s.createdAt ? new Date(s.createdAt).getTime() : 0;
      const expiresAtMs = s.expiresAt || (createdAtMs ? createdAtMs + 30 * 60 * 1000 : 0);
      const awaitingExpMs = s.awaitingExpiresAt || (createdAtMs ? createdAtMs + 45 * 60 * 1000 : 0);

      if (s.status === 'awaiting_confirmations') {
        // Если прошло более 45 минут без фиксации транзакции в сети — сделка аннулируется
        if (!s.txHash && awaitingExpMs && awaitingExpMs <= now) {
          s.status = 'cancelled';
          s.cancelReason = 'unconfirmed_timeout';
          delete s.txHash;
          delete s.explorerUrl;
          changed = true;
          if (window.supabaseClient && s.orderId) {
            window.supabaseClient.from('crypto_orders').update({ status: 'cancelled' }).eq('id', s.orderId).then(() => {}).catch(() => {});
          }
          continue;
        }
        return s;
      }
      if (s.status === 'pending') {
        if (expiresAtMs && expiresAtMs > now) {
          return s;
        } else if (expiresAtMs && expiresAtMs <= now) {
          s.status = 'cancelled';
          s.cancelReason = 'expired';
          delete s.txHash;
          delete s.explorerUrl;
          changed = true;
          if (window.supabaseClient && s.orderId) {
            window.supabaseClient.from('crypto_orders').update({ status: 'cancelled' }).eq('id', s.orderId).then(() => {}).catch(() => {});
          }
        }
      }
    }
    if (changed) {
      this.saveToStorage();
    }
    return null;
  }

  /**
   * Динамический расчет требуемых подтверждений в сети блокчейн:
   * - До 100 Орбов: 1 подтверждение
   * - До 500 Орбов: 2 подтверждения
   * - Свыше 500 Орбов: 3 подтверждения
   */
  getRequiredConfirmations(orbsAmount) {
    const amount = Number(orbsAmount) || 0;
    if (amount <= 100) return 1;
    if (amount <= 500) return 2;
    return 3;
  }

  /**
   * Получение истории пополнений баланса Орбов (локальные + сессии + Supabase)
   */
  async getDepositHistory() {
    const list = [];
    const now = Date.now();
    const EXPIRY_DURATION_MS = 30 * 60 * 1000; // 30 минут
    const AWAITING_TIMEOUT_MS = 45 * 60 * 1000; // 45 минут для неподтверждённых

    // 1. Пополнения из локального хранилища store.orders
    const localTopups = (this.data.orders || [])
      .filter(o => o.type === 'topup')
      .map(o => {
        const txInfo = o.txInfo || {};
        const network = txInfo.network || 'USDT (TRC-20)';
        const txHash = txInfo.txHash || '';
        let explorerUrl = '';
        if (txHash) {
          if (network.includes('Polygon') || network.includes('POL')) {
            explorerUrl = `https://polygonscan.com/tx/${txHash}`;
          } else if (network.includes('BTC') || network.includes('Bitcoin')) {
            explorerUrl = `https://www.blockchain.com/explorer/transactions/btc/${txHash}`;
          } else {
            explorerUrl = `https://tronscan.org/#/transaction/${txHash}`;
          }
        }
        return {
          id: txInfo.orderId || o.id || 'ORD-LOCAL',
          date: o.date,
          amountUsdt: Number(txInfo.usdt || o.amount || 0),
          orbs: Number(o.amount || 0),
          network,
          txHash,
          explorerUrl,
          status: 'completed',
          canResume: false
        };
      });

    list.push(...localTopups);

    // 2. Сессии из data.cryptoSessions (включая pending, awaiting_confirmations, cancelled)
    let sessionsChanged = false;
    if (this.data.cryptoSessions && Array.isArray(this.data.cryptoSessions)) {
      this.data.cryptoSessions.forEach(s => {
        const isBtc = (s.network || '').includes('BTC');
        let explorerUrl = '';
        if (s.txHash && s.status !== 'cancelled') {
          if ((s.network || '').includes('Polygon') || (s.network || '').includes('POL')) {
            explorerUrl = `https://polygonscan.com/tx/${s.txHash}`;
          } else if (isBtc) {
            explorerUrl = `https://www.blockchain.com/explorer/transactions/btc/${s.txHash}`;
          } else {
            explorerUrl = `https://tronscan.org/#/transaction/${s.txHash}`;
          }
        }

        const createdAtMs = s.createdAt ? new Date(s.createdAt).getTime() : 0;
        const expiresAtMs = s.expiresAt || (createdAtMs ? createdAtMs + EXPIRY_DURATION_MS : 0);
        const awaitingExpMs = s.awaitingExpiresAt || (createdAtMs ? createdAtMs + AWAITING_TIMEOUT_MS : 0);

        const isUnconfirmedExpired = (s.status === 'awaiting_confirmations' && !s.txHash && awaitingExpMs && awaitingExpMs <= now);
        const isPendingExpired = (s.status === 'pending' && expiresAtMs && expiresAtMs <= now);
        if (isUnconfirmedExpired || isPendingExpired) {
          s.status = 'cancelled';
          s.cancelReason = isUnconfirmedExpired ? 'unconfirmed_timeout' : 'expired';
          delete s.txHash;
          delete s.explorerUrl;
          sessionsChanged = true;
          if (window.supabaseClient && s.orderId) {
            window.supabaseClient
              .from('crypto_orders')
              .update({ status: 'cancelled' })
              .eq('id', s.orderId)
              .then(() => {})
              .catch(() => {});
          }
        }

        const canResume = (
          (s.status === 'awaiting_confirmations' && (s.txHash || !awaitingExpMs || awaitingExpMs > now)) ||
          (s.status === 'pending' && expiresAtMs > now)
        );

        const itemObj = {
          id: s.orderId,
          date: s.completedAt || s.paidAt || (s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString()),
          amountUsdt: Number(s.expectedAmount || s.orbsAmount || 0),
          orbs: Number(s.orbsAmount || 0),
          network: s.network,
          txHash: s.status === 'cancelled' ? '' : (s.txHash || ''),
          explorerUrl: s.status === 'cancelled' ? '' : explorerUrl,
          status: s.status || 'pending',
          expiresAt: s.expiresAt || null,
          confirmations: s.confirmations || 0,
          requiredConfirmations: s.requiredConfirmations || this.getRequiredConfirmations(s.orbsAmount || s.expectedAmount),
          canResume: Boolean(canResume)
        };

        const existingIndex = list.findIndex(item => item.id === s.orderId);
        if (existingIndex === -1) {
          list.push(itemObj);
        } else {
          list[existingIndex] = { ...list[existingIndex], ...itemObj };
        }
      });
      if (sessionsChanged) {
        this.saveToStorage();
      }
    }

    // 3. Пополнения из таблицы crypto_orders в Supabase
    if (window.supabaseClient) {
      try {
        const currentUser = this.getCurrentUser();
        let query = window.supabaseClient
          .from('crypto_orders')
          .select('*')
          .order('created_at', { ascending: false });

        // Если не админ, фильтруем по текущему пользователю
        if (this.getRole() !== 'admin' && currentUser && currentUser.id && !currentUser.id.startsWith('usr_') && currentUser.id !== 'guest') {
          query = query.eq('user_id', currentUser.id);
        }

        const { data: dbOrders, error } = await query;
        if (!error && Array.isArray(dbOrders)) {
          const expiredIdsToSync = [];

          dbOrders.forEach(ord => {
            let status = ord.status || 'pending';
            const createdAtMs = ord.created_at ? new Date(ord.created_at).getTime() : 0;
            const expiresAtMs = createdAtMs ? (createdAtMs + EXPIRY_DURATION_MS) : 0;

            // Если сделка висит в pending, но прошло более 30 минут — она автоматически отменена по тайм-ауту
            if (status === 'pending' && expiresAtMs && expiresAtMs <= now) {
              status = 'cancelled';
              expiredIdsToSync.push(ord.id);
            } else if (status === 'awaiting_confirmations' && !ord.tx_hash && createdAtMs && (now - createdAtMs > AWAITING_TIMEOUT_MS)) {
              status = 'cancelled';
              expiredIdsToSync.push(ord.id);
            }

            const isCancelled = status === 'cancelled';
            const isCompleted = status === 'completed';
            const txHash = isCancelled ? '' : (ord.tx_hash || '');
            const network = ord.network || 'USDT (TRC-20)';
            let explorerUrl = '';
            if (txHash) {
              if (network.includes('Polygon') || network.includes('POL')) {
                explorerUrl = `https://polygonscan.com/tx/${txHash}`;
              } else if (network.includes('BTC') || network.includes('Bitcoin')) {
                explorerUrl = `https://www.blockchain.com/explorer/transactions/btc/${txHash}`;
              } else {
                explorerUrl = `https://tronscan.org/#/transaction/${txHash}`;
              }
            }

            // Открывать повторно можно ТОЛЬКО живые активные сделки, чей таймер ещё не истёк
            const canResume = !isCancelled && !isCompleted && (
              (status === 'pending' && expiresAtMs > now) ||
              (status === 'awaiting_confirmations')
            );

            const existingIndex = list.findIndex(item => item.id === ord.id || (txHash && item.txHash === txHash));
            if (existingIndex === -1) {
              const reqConfs = this.getRequiredConfirmations(ord.orbs_amount || ord.expected_amount);
              list.push({
                id: ord.id,
                date: ord.completed_at || ord.created_at,
                amountUsdt: Number(ord.expected_amount || ord.orbs_amount || 0),
                orbs: Number(ord.orbs_amount || 0),
                network,
                txHash,
                explorerUrl,
                status,
                confirmations: ord.confirmations || 0,
                requiredConfirmations: ord.required_confirmations || reqConfs,
                canResume: Boolean(canResume)
              });
            } else {
              // Если в локальном хранилище сделка уже отменена или завершена — ни в коем случае не возвращаем её в pending!
              if (list[existingIndex].status !== 'completed' && list[existingIndex].status !== 'cancelled') {
                list[existingIndex].status = status;
                list[existingIndex].canResume = Boolean(canResume);
              }
              if (list[existingIndex].status === 'cancelled') {
                list[existingIndex].canResume = false;
                list[existingIndex].txHash = '';
                list[existingIndex].explorerUrl = '';
              }
              if (txHash && list[existingIndex].status !== 'cancelled') {
                list[existingIndex].txHash = txHash;
              }
              if (explorerUrl && list[existingIndex].status !== 'cancelled') {
                list[existingIndex].explorerUrl = explorerUrl;
              }
            }
          });

          // Пакетно переводим истёкшие заказы в cancelled в базе Supabase
          if (expiredIdsToSync.length > 0) {
            window.supabaseClient
              .from('crypto_orders')
              .update({ status: 'cancelled' })
              .in('id', expiredIdsToSync)
              .then(() => console.log('✅ Истёкшие заказы переведены в cancelled в Supabase:', expiredIdsToSync))
              .catch(err => console.warn('Ошибка обновления истёкших заказов в Supabase:', err));
          }
        }
      } catch (e) {
        console.warn('Загрузка crypto_orders из Supabase:', e);
      }
    }

    list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return list;
  }
}

window.store = new Store();
