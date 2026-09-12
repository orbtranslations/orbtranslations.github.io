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

  static async delete(key) {
    const db = await IDBStorage.open();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDBStorage.STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDBStorage.STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Сохраняет данные графического архива/папки для работы в IndexedDB
   */
  static async saveClientArchive(workId, data) {
    if (!workId || !data) return false;
    const key = `client_archive_${workId}`;
    return await IDBStorage.set(key, {
      ...data,
      workId,
      updatedAt: Date.now()
    });
  }

  /**
   * Получает сохраненный архив/папку для работы из IndexedDB
   */
  static async getClientArchive(workId) {
    if (!workId) return null;
    const key = `client_archive_${workId}`;
    return await IDBStorage.get(key);
  }

  /**
   * Удаляет сохраненный архив/папку для работы из IndexedDB
   */
  static async removeClientArchive(workId) {
    if (!workId) return false;
    const key = `client_archive_${workId}`;
    return await IDBStorage.delete(key);
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
    this.initPromise = this.initAsyncStorage();
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

      // Очистка старых тестовых сделок из локального кэша и нормализация структуры
      if (this.data.cryptoSessions) {
        if (Array.isArray(this.data.cryptoSessions)) {
          this.data.cryptoSessions = this.data.cryptoSessions.filter(s => s && s.orderId !== 'TEST-1' && s.orderId !== 'TEST-UPDATE');
        } else if (typeof this.data.cryptoSessions === 'object') {
          this.data.cryptoSessions = Object.values(this.data.cryptoSessions).filter(s => s && s.orderId !== 'TEST-1' && s.orderId !== 'TEST-UPDATE');
        } else {
          this.data.cryptoSessions = [];
        }
      } else {
        this.data.cryptoSessions = [];
      }
      if (this.data.orders && Array.isArray(this.data.orders)) {
        this.data.orders = this.data.orders.filter(o => o && o.id !== 'TEST-1' && o.id !== 'TEST-UPDATE');
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
        const mappedWorks = dbWorks.map(w => {
          const existing = (this.data.works || []).find(ew => ew.id === w.id);
          return {
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
            fullScriptText: (existing && existing.fullScriptText) ? existing.fullScriptText : null,
            createdAt: w.created_at ? w.created_at.split('T')[0] : '2026-09-01'
          };
        });

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
          .select('id, work_id, price_paid, purchased_at')
          .eq('user_id', currentUserId);

        if (userPurchases && Array.isArray(userPurchases)) {
          const ids = userPurchases.map(p => p.work_id);
          this.data.currentUser.purchasedWorks = Array.from(new Set([...this.data.currentUser.purchasedWorks, ...ids]));
          
          if (!Array.isArray(this.data.orders)) {
            this.data.orders = [];
          }
          userPurchases.forEach(p => {
            const alreadyInOrders = this.data.orders.some(o => o.workId === p.work_id && o.type === 'purchase');
            if (!alreadyInOrders) {
              const work = this.getWorkById(p.work_id);
              const workTitle = (work && typeof work.title === 'object')
                ? { ru: work.title.ru || work.title.en || '', en: work.title.en || work.title.ru || '' }
                : (work ? { ru: work.title, en: work.titleEn || work.originalTitle || work.title } : { ru: p.work_id, en: p.work_id });
              this.data.orders.push({
                id: 'ORD-P-' + (p.id || p.work_id),
                workId: p.work_id,
                workTitle,
                price: Number(p.price_paid || (work ? work.price : 1)),
                date: p.purchased_at || new Date().toISOString(),
                type: 'purchase'
              });
            }
          });

          this.saveToStorage();
          if (window.app) {
            window.app.renderStorefront();
            window.app.renderPurchases();
          }
        }
      }

      // 4. Очистка устаревших тестовых записей без пользователя
      window.supabaseClient
        .from('crypto_orders')
        .delete()
        .in('id', ['TEST-1', 'TEST-UPDATE'])
        .then(() => {})
        .catch(() => {});
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
        orbs: 0,
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
      let parsed = null;
      const raw = localStorage.getItem(Store.STORAGE_KEY);
      if (raw) {
        parsed = JSON.parse(raw);
      } else {
        const oldRaw = localStorage.getItem('orb_marketplace_data_v2');
        if (oldRaw) parsed = JSON.parse(oldRaw);
      }

      if (parsed) {
        // Гарантируем, что cryptoSessions ВСЕГДА является массивом
        if (parsed.cryptoSessions) {
          if (!Array.isArray(parsed.cryptoSessions)) {
            parsed.cryptoSessions = Object.values(parsed.cryptoSessions).filter(Boolean);
          }
        } else {
          parsed.cryptoSessions = [];
        }

        // Орбы ВСЕГДА строго целые числа (не делятся)
        if (parsed.currentUser && parsed.currentUser.orbs !== undefined) {
          parsed.currentUser.orbs = Math.floor(Number(parsed.currentUser.orbs || 0));
        }
        if (Array.isArray(parsed.registeredUsers)) {
          parsed.registeredUsers.forEach(u => {
            if (u && u.orbs !== undefined) {
              u.orbs = Math.floor(Number(u.orbs || 0));
            }
          });
        }

        return parsed;
      }
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
      this.data.currentUser = { id: 'guest', name: 'Guest', email: '', orbs: 0, purchasedWorks: [] };
    }
    if (this.data.currentUser.id === 'guest') {
      const isEn = (window.i18n ? window.i18n.getLang() : (this.data.siteLang || 'en')) === 'en';
      this.data.currentUser.name = isEn ? 'Guest' : 'Гость';
    }
    return this.data.currentUser;
  }

  addOrbs(amount, txInfo = {}) {
    this.data.currentUser.orbs = Math.floor(this.data.currentUser.orbs + Number(amount));
    this.data.orders.push({
      id: 'ord_' + Date.now(),
      amount: Math.floor(Number(amount)),
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

    const currentOrbs = Math.floor(Number(this.data.currentUser.orbs || 0));
    const workPrice = Math.floor(Number(work.price || 1));

    if (currentOrbs < workPrice) {
      return {
        success: false,
        needOrbs: Math.max(0, workPrice - currentOrbs),
        message: 'Недостаточно Орбов для покупки'
      };
    }

    this.data.currentUser.orbs = Math.max(0, currentOrbs - workPrice);
    if (!this.data.currentUser.purchasedWorks.includes(workId)) {
      this.data.currentUser.purchasedWorks.push(workId);
    }
    this.addDevicePurchase(workId);

    // Сброс прогресса чтения для новой покупки: первое открытие начнется строго с 1-й страницы
    try {
      localStorage.removeItem(`orb_progress_${workId}`);
      localStorage.removeItem(`orb_reading_progress_${workId}`);
      localStorage.removeItem(`orb_opened_after_purchase_${workId}`);
      localStorage.removeItem(`orb_preview_progress_${workId}`);
    } catch (_) {}

    // Если работа ранее была в отозванных — снимаем статус отзыва при повторной покупке
    if (this.data.currentUser && this.data.currentUser.id) {
      this.removeRevokedPurchase(this.data.currentUser.id, workId);
    }

    const workTitle = (work && typeof work.title === 'object')
      ? { ru: work.title.ru || work.title.en || '', en: work.title.en || work.title.ru || '' }
      : (work ? { ru: work.title, en: work.titleEn || work.originalTitle || work.title } : { ru: workId, en: workId });

    this.data.orders.push({
      id: 'ORD-P-' + Date.now().toString().slice(-6),
      userId: this.data.currentUser ? this.data.currentUser.id : null,
      workId,
      workTitle,
      price: workPrice,
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

  getDevicePurchases() {
    try {
      const raw = localStorage.getItem('orb_device_purchases');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  }

  addDevicePurchase(workId) {
    if (!workId) return;
    try {
      const list = this.getDevicePurchases();
      if (!list.includes(workId)) {
        list.push(workId);
        localStorage.setItem('orb_device_purchases', JSON.stringify(list));
      }
    } catch (e) {}
  }

  removeDevicePurchase(workId) {
    if (!workId) return;
    try {
      const list = this.getDevicePurchases();
      const filtered = list.filter(id => id !== workId);
      localStorage.setItem('orb_device_purchases', JSON.stringify(filtered));
    } catch (e) {}
  }

  getRevokedPurchases() {
    try {
      const raw = localStorage.getItem('orb_revoked_purchases');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return this.data.revokedPurchases || [];
  }

  addRevokedPurchase(userId, workId = '', orderId = '', dbId = '', all = false) {
    const list = this.getRevokedPurchases();
    list.push({
      userId: String(userId || ''),
      workId: String(workId || ''),
      orderId: String(orderId || ''),
      dbId: dbId ? String(dbId) : '',
      all: Boolean(all),
      revokedAt: new Date().toISOString()
    });
    this.data.revokedPurchases = list;
    try {
      localStorage.setItem('orb_revoked_purchases', JSON.stringify(list));
    } catch (e) {}

    if (workId) {
      try {
        localStorage.removeItem(`orb_progress_${workId}`);
        localStorage.removeItem(`orb_reading_progress_${workId}`);
        localStorage.removeItem(`orb_opened_after_purchase_${workId}`);
      } catch (_) {}
    }
  }

  removeRevokedPurchase(userId, workId) {
    const list = this.getRevokedPurchases();
    const filtered = list.filter(r => !(r.userId === String(userId) && (r.workId === String(workId) || r.all)));
    this.data.revokedPurchases = filtered;
    try {
      localStorage.setItem('orb_revoked_purchases', JSON.stringify(filtered));
    } catch (e) {}
  }

  isPurchaseRevoked(userId, workId = '', orderId = '', dbId = '') {
    const list = this.getRevokedPurchases();
    if (!list || list.length === 0) return false;
    const uStr = String(userId || '');
    const wStr = String(workId || '');
    const oStr = String(orderId || '');
    const dStr = dbId ? String(dbId) : '';

    return list.some(r => {
      // 1. Если для пользователя отозваны все покупки
      if (r.userId && r.userId === uStr && r.all) return true;
      // 2. Если совпадает работа
      if (wStr && r.workId && r.workId === wStr) {
        if (!r.userId || r.userId === uStr) return true;
      }
      // 3. Если совпадает dbId
      if (dStr && r.dbId && r.dbId === dStr) return true;
      // 4. Если совпадает orderId
      if (oStr && r.orderId && r.orderId === oStr) return true;
      return false;
    });
  }

  setPurchasedWorks(workIds) {
    if (!Array.isArray(workIds)) return;
    const currentUid = this.data.currentUser ? this.data.currentUser.id : '';
    const validWorkIds = workIds.filter(id => !this.isPurchaseRevoked(currentUid, id));
    if (!this.data.currentUser.purchasedWorks) {
      this.data.currentUser.purchasedWorks = [];
    }
    const deviceList = this.getDevicePurchases().filter(id => !this.isPurchaseRevoked(currentUid, id));
    const merged = Array.from(new Set([
      ...(this.data.currentUser.purchasedWorks || []).filter(id => !this.isPurchaseRevoked(currentUid, id)),
      ...validWorkIds,
      ...deviceList
    ]));
    this.data.currentUser.purchasedWorks = merged;
    merged.forEach(id => this.addDevicePurchase(id));
    this.saveToStorage();
  }

  hasPurchased(workId) {
    const currentUid = this.data.currentUser ? this.data.currentUser.id : 'guest';
    if (this.isPurchaseRevoked(currentUid, workId)) {
      return false;
    }
    const devicePurchases = this.getDevicePurchases().filter(id => !this.isPurchaseRevoked(currentUid, id));
    if (this.getRole() === 'guest') {
      return devicePurchases.includes(workId) || (this.data.currentUser?.purchasedWorks || []).includes(workId);
    }
    const userPurchased = (this.data.currentUser?.purchasedWorks || []).includes(workId);
    return userPurchased || devicePurchases.includes(workId);
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
    const fullScript = workData.sampleScriptText || '';
    const previewPagesCount = Number(workData.previewPagesCount) || 3;
    const previewSlice = (typeof ScriptParser !== 'undefined' && ScriptParser.generatePreviewSlice && fullScript)
      ? ScriptParser.generatePreviewSlice(fullScript, previewPagesCount)
      : fullScript;

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
      previewPagesCount: previewPagesCount,
      tags: workData.tags || ['Перевод'],
      coverUrl: workData.coverUrl || 'assets/demo/cover-1.svg',
      previewImages: workData.previewImages || [
        'assets/demo/page-1.svg',
        'assets/demo/page-2.svg',
        'assets/demo/page-3.svg'
      ],
      availableLanguages: workData.availableLanguages || ['Русский', 'English'],
      scriptFileName: workData.scriptFileName || 'script.txt',
      sampleScriptText: previewSlice,
      fullScriptText: fullScript,
      createdAt: new Date().toISOString().split('T')[0]
    };

    this.data.works.unshift(work);
    this.saveToStorage();

    // Фоновая синхронизация с Supabase (метаданные + RLS скрипт)
    this.saveWorkToSupabase(work, fullScript);

    return work;
  }

  updateWork(id, updatedData) {
    const index = this.data.works.findIndex(w => w.id === id);
    if (index === -1) return null;

    const current = this.data.works[index];
    const previewPagesCount = updatedData.previewPagesCount !== undefined 
      ? Number(updatedData.previewPagesCount) 
      : (current.previewPagesCount || 3);

    let fullScript = current.fullScriptText || current.sampleScriptText || '';
    if (updatedData.sampleScriptText !== undefined && !updatedData.sampleScriptText.startsWith('[STORED_IN_IDB')) {
      fullScript = updatedData.sampleScriptText;
    }

    const previewSlice = (typeof ScriptParser !== 'undefined' && ScriptParser.generatePreviewSlice && fullScript)
      ? ScriptParser.generatePreviewSlice(fullScript, previewPagesCount)
      : (updatedData.sampleScriptText !== undefined ? updatedData.sampleScriptText : current.sampleScriptText);

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
      previewPagesCount: previewPagesCount,
      tags: updatedData.tags !== undefined ? updatedData.tags : current.tags,
      coverUrl: updatedData.coverUrl !== undefined ? updatedData.coverUrl : (current.coverUrl || 'assets/demo/cover-1.svg'),
      sampleScriptText: previewSlice,
      fullScriptText: fullScript,
      updatedAt: new Date().toISOString().split('T')[0]
    };

    const updated = this.data.works[index];
    this.saveToStorage();

    // Фоновая синхронизация с Supabase
    this.saveWorkToSupabase(updated, fullScript);

    return updated;
  }

  async deleteWork(id) {
    this.data.works = this.data.works.filter(w => w.id !== id);
    this.saveToStorage();

    if (window.supabaseClient) {
      try {
        await window.supabaseClient.from('works').delete().eq('id', id);
      } catch (err) {
        console.warn('Ошибка удаления работы из Supabase:', err);
      }
    }
  }

  /**
   * Сохраняет работу в Supabase:
   * - Открытая таблица public.works: метаданные + только безопасная превью-выжимка
   * - Закрытая таблица public.work_scripts: полный скрипт под защитой RLS
   */
  async saveWorkToSupabase(work, fullScriptText = null) {
    if (!window.supabaseClient) return { success: true, localOnly: true };

    const scriptToSave = fullScriptText || work.fullScriptText || work.sampleScriptText || '';
    const previewPages = Number(work.previewPagesCount) || 3;
    const previewSlice = (typeof ScriptParser !== 'undefined' && ScriptParser.generatePreviewSlice && scriptToSave)
      ? ScriptParser.generatePreviewSlice(scriptToSave, previewPages)
      : (work.sampleScriptText || scriptToSave);

    const titleRu = typeof work.title === 'object' ? (work.title.ru || '') : (work.title || '');
    const titleEn = typeof work.title === 'object' ? (work.title.en || '') : (work.titleEn || titleRu);
    const descRu = typeof work.description === 'object' ? (work.description.ru || '') : (work.description || '');
    const descEn = typeof work.description === 'object' ? (work.description.en || '') : (work.descriptionEn || descRu);

    const dbPayload = {
      id: work.id,
      title_ru: titleRu,
      title_en: titleEn,
      description_ru: descRu,
      description_en: descEn,
      author: work.author || '',
      price: Number(work.price) || 1,
      total_pages: Number(work.totalPages) || 1,
      preview_pages_count: previewPages,
      tags: work.tags || [],
      cover_url: work.coverUrl || 'assets/demo/cover-1.svg',
      available_languages: work.availableLanguages || ['Русский', 'English'],
      script_file_name: work.scriptFileName || 'script.txt',
      sample_script_text: previewSlice,
      updated_at: new Date().toISOString()
    };

    try {
      // 1. Сохранение метаданных и публичной превью-выжимки в public.works
      const { error: worksErr } = await window.supabaseClient
        .from('works')
        .upsert(dbPayload);

      if (worksErr) {
        console.error('Ошибка сохранения работы в public.works:', worksErr);
        throw worksErr;
      }

      // 2. Сохранение полного скрипта в закрытый бакет Storage (1 GB) и таблицу work_scripts
      if (scriptToSave && !scriptToSave.startsWith('[STORED_IN_IDB')) {
        // А. Загрузка в закрытый бакет Storage (1 GB)
        try {
          const blob = new Blob([scriptToSave], { type: 'text/plain;charset=utf-8' });
          await window.supabaseClient.storage
            .from('work-scripts')
            .upload(`${work.id}.txt`, blob, {
              cacheControl: '3600',
              upsert: true
            });
        } catch (storageUpErr) {
          console.warn('Загрузка в бакет work-scripts:', storageUpErr);
        }

        // Б. Резервное сохранение в таблицу work_scripts
        try {
          await window.supabaseClient
            .from('work_scripts')
            .upsert({
              work_id: work.id,
              full_script_text: scriptToSave,
              updated_at: new Date().toISOString()
            });
        } catch (dbScriptErr) {
          console.warn('Сохранение в таблицу work_scripts:', dbScriptErr);
        }
      }

      return { success: true };
    } catch (err) {
      console.warn('Ошибка облачной синхронизации работы с Supabase:', err);
      return { success: false, error: err };
    }
  }

  /**
   * Безопасное получение полного скрипта работы:
   * 1. Проверяет Edge Function get-work-script (читает закрытый Storage 1 GB)
   * 2. Резервно опрашивает закрытую таблицу Supabase work_scripts (RLS)
   * Гости и неоплатившие пользователи получат null (доступ отклонен).
   */
  async getFullScript(workId) {
    const work = this.getWorkById(workId);

    // 1. Если полный скрипт уже загружен в память
    if (work && work.fullScriptText && !work.fullScriptText.startsWith('[STORED_IN_IDB')) {
      return work.fullScriptText;
    }

    // 2. Запрашиваем через серверную Edge Function get-work-script
    if (window.supabaseClient) {
      try {
        if (window.supabaseClient.functions) {
          const { data: fnData, error: fnErr } = await window.supabaseClient.functions.invoke('get-work-script', {
            body: { workId: workId }
          });
          if (!fnErr && fnData && fnData.script) {
            if (work) {
              work.fullScriptText = fnData.script;
              this.saveToStorage();
            }
            return fnData.script;
          }
        }
      } catch (fnErr) {
        console.warn('Edge Function недоступна, пробуем прямой запрос:', fnErr);
      }

      // 3. Резервный запрос в закрытую таблицу work_scripts из Supabase (RLS базы данных)
      try {
        const { data, error } = await window.supabaseClient
          .from('work_scripts')
          .select('full_script_text')
          .eq('work_id', workId)
          .maybeSingle();

        if (!error && data && data.full_script_text) {
          if (work) {
            work.fullScriptText = data.full_script_text;
            this.saveToStorage();
          }
          return data.full_script_text;
        }
      } catch (err) {
        console.warn('Ошибка получения закрытого скрипта из Supabase:', err);
      }
    }

    // 3.5. Проверка в локальной базе IndexedDB (для офлайн-доступа и кэша)
    if (typeof IDBStorage !== 'undefined') {
      try {
        const idbData = await IDBStorage.get('main_store');
        if (idbData && Array.isArray(idbData.works)) {
          const idbWork = idbData.works.find(w => w && w.id === workId);
          if (idbWork && idbWork.fullScriptText && !idbWork.fullScriptText.startsWith('[STORED_IN_IDB')) {
            if (work) work.fullScriptText = idbWork.fullScriptText;
            return idbWork.fullScriptText;
          }
        }
      } catch (e) {
        console.warn('Ошибка чтения fullScriptText из IDB:', e);
      }
    }

    // 4. Резерв: если скрипт хранится в sampleScriptText (для локального офлайн-режима)
    if (work && work.sampleScriptText && !work.sampleScriptText.startsWith('[STORED_IN_IDB')) {
      return work.sampleScriptText;
    }

    return null;
  }

  /**
   * Получение скрипта превью для работы:
   * Гарантирует, что данные загружены из IDB / Supabase и не содержат заглушку [STORED_IN_IDB]
   */
  async getSampleScript(workId) {
    let work = this.getWorkById(workId);
    if (work && work.sampleScriptText && !work.sampleScriptText.startsWith('[STORED_IN_IDB')) {
      return work.sampleScriptText;
    }

    // 1. Ожидаем завершения асинхронной инициализации хранилища
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch (e) {
        console.warn('Ошибка ожидания initPromise в getSampleScript:', e);
      }
      work = this.getWorkById(workId);
      if (work && work.sampleScriptText && !work.sampleScriptText.startsWith('[STORED_IN_IDB')) {
        return work.sampleScriptText;
      }
    }

    // 2. Прямая проверка в IndexedDB
    if (typeof IDBStorage !== 'undefined') {
      try {
        const idbData = await IDBStorage.get('main_store');
        if (idbData && Array.isArray(idbData.works)) {
          const idbWork = idbData.works.find(w => w && w.id === workId);
          if (idbWork && idbWork.sampleScriptText && !idbWork.sampleScriptText.startsWith('[STORED_IN_IDB')) {
            if (work) work.sampleScriptText = idbWork.sampleScriptText;
            return idbWork.sampleScriptText;
          }
        }
      } catch (e) {
        console.warn('Ошибка прямого чтения sampleScriptText из IDB:', e);
      }
    }

    // 3. Прямая загрузка из Supabase public.works
    if (window.supabaseClient) {
      try {
        const { data, error } = await window.supabaseClient
          .from('works')
          .select('sample_script_text')
          .eq('id', workId)
          .maybeSingle();

        if (!error && data && data.sample_script_text) {
          if (work) {
            work.sampleScriptText = data.sample_script_text;
            this.saveToStorage();
          }
          return data.sample_script_text;
        }
      } catch (e) {
        console.warn('Ошибка запроса sample_script_text из Supabase:', e);
      }
    }

    return (work && work.sampleScriptText && !work.sampleScriptText.startsWith('[STORED_IN_IDB'))
      ? work.sampleScriptText
      : '';
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

  getCryptoSessionsList() {
    if (!this.data || !this.data.cryptoSessions) return [];
    if (Array.isArray(this.data.cryptoSessions)) return this.data.cryptoSessions.filter(Boolean);
    if (typeof this.data.cryptoSessions === 'object') {
      return Object.values(this.data.cryptoSessions).filter(Boolean);
    }
    return [];
  }

  /**
   * Сохранение сессии крипто-заказа (pending, awaiting_confirmations, completed, cancelled)
   */
  saveCryptoSession(session) {
    if (!session || !session.orderId) return;
    if (!Array.isArray(this.data.cryptoSessions)) {
      this.data.cryptoSessions = this.getCryptoSessionsList();
    }
    const idx = this.data.cryptoSessions.findIndex(s => s && s.orderId === session.orderId);
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
          orbs_amount: Math.floor(session.orbsAmount || 0),
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
    const sessions = this.getCryptoSessionsList();
    return sessions.find(s => s && s.orderId === orderId) || null;
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
    const sessions = this.getCryptoSessionsList();
    if (sessions.length === 0) return null;
    const now = Date.now();
    let changed = false;
    for (const s of sessions) {
      if (!s) continue;
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
      this.data.cryptoSessions = sessions;
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

    // 1.1. Покупки переводов (расходы Орбов) из локального хранилища store.orders
    const localPurchases = (this.data.orders || [])
      .filter(o => o.type === 'purchase')
      .map(o => {
        const work = this.getWorkById(o.workId);
        const workTitle = (work && typeof work.title === 'object')
          ? { ru: work.title.ru || work.title.en || '', en: work.title.en || work.title.ru || '' }
          : (typeof o.workTitle === 'object' && o.workTitle !== null)
            ? o.workTitle
            : (work ? { ru: work.title, en: work.titleEn || work.originalTitle || work.title } : { ru: o.workTitle || o.workId, en: o.workTitle || o.workId });
        const rawId = String(o.id || '');
        const id = rawId.startsWith('ORD-') ? rawId : ('ORD-P-' + rawId.replace(/^ord_p_|^ord_/, ''));
        return {
          id,
          type: 'purchase',
          workId: o.workId,
          workTitle,
          date: o.date,
          amountUsdt: Number(o.price || (work ? work.price : 1)),
          orbs: -Number(o.price || (work ? work.price : 1)),
          network: 'Orb Balance',
          txHash: '',
          explorerUrl: '',
          status: 'completed',
          canResume: false
        };
      });

    localPurchases.forEach(p => {
      const existing = list.findIndex(item => item.id === p.id || (item.type === 'purchase' && item.workId === p.workId));
      if (existing === -1) {
        list.push(p);
      }
    });

    // 1.2. Привязанные покупки устройства или текущего пользователя (гарантированный fallback)
    const allPurchasedIds = Array.from(new Set([
      ...(this.data.currentUser?.purchasedWorks || []),
      ...this.getDevicePurchases()
    ]));
    allPurchasedIds.forEach(workId => {
      const alreadyInList = list.some(item => item.type === 'purchase' && item.workId === workId);
      if (!alreadyInList) {
        const work = this.getWorkById(workId);
        const workTitle = (work && typeof work.title === 'object')
          ? { ru: work.title.ru || work.title.en || '', en: work.title.en || work.title.ru || '' }
          : (work ? { ru: work.title, en: work.titleEn || work.originalTitle || work.title } : { ru: workId, en: workId });
        list.push({
          id: `ORD-P-${workId}`,
          type: 'purchase',
          workId: workId,
          workTitle,
          date: new Date().toISOString(),
          amountUsdt: Number(work?.price || 1),
          orbs: -Number(work?.price || 1),
          network: 'Orb Balance',
          txHash: '',
          explorerUrl: '',
          status: 'completed',
          canResume: false
        });
      }
    });

    // 2. Сессии из data.cryptoSessions (включая pending, awaiting_confirmations, cancelled)
    let sessionsChanged = false;
    const localSessions = this.getCryptoSessionsList();
    if (localSessions.length > 0) {
      localSessions.forEach(s => {
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

        // Персональная история пополнений всегда привязана к текущему пользователю (включая админа)
        if (currentUser && currentUser.id && !currentUser.id.startsWith('usr_') && currentUser.id !== 'guest') {
          query = query.eq('user_id', currentUser.id);
        } else {
          // Для неавторизованных гостей не выводим чужие транзакции из базы
          query = query.eq('user_id', '00000000-0000-0000-0000-000000000000');
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

      // 4. Покупки из таблицы purchases в Supabase для авторизованного пользователя
      try {
        const currentUser = this.getCurrentUser();
        if (currentUser && currentUser.id && !currentUser.id.startsWith('usr_') && currentUser.id !== 'guest') {
          const { data: dbPurchases, error: pErr } = await window.supabaseClient
            .from('purchases')
            .select('id, work_id, price_paid, purchased_at')
            .eq('user_id', currentUser.id)
            .order('purchased_at', { ascending: false });

          if (!pErr && Array.isArray(dbPurchases)) {
            dbPurchases.forEach(p => {
              const ordId = `ORD-P-${p.id || p.work_id}`;
              if (this.isPurchaseRevoked(currentUser.id, p.work_id, ordId, p.id)) {
                return;
              }
              const work = this.getWorkById(p.work_id);
              const workTitle = (work && typeof work.title === 'object')
                ? { ru: work.title.ru || work.title.en || '', en: work.title.en || work.title.ru || '' }
                : (work ? { ru: work.title, en: work.titleEn || work.originalTitle || work.title } : { ru: p.work_id, en: p.work_id });
              const existingIndex = list.findIndex(item => item.type === 'purchase' && (item.id === ordId || item.workId === p.work_id));
              const purchaseItem = {
                id: ordId,
                type: 'purchase',
                workId: p.work_id,
                workTitle,
                date: p.purchased_at || new Date().toISOString(),
                amountUsdt: Number(p.price_paid || (work ? work.price : 1)),
                orbs: -Number(p.price_paid || (work ? work.price : 1)),
                network: 'Orb Balance',
                txHash: '',
                explorerUrl: '',
                status: 'completed',
                canResume: false
              };
              if (existingIndex === -1) {
                list.push(purchaseItem);
              } else {
                list[existingIndex] = { ...list[existingIndex], ...purchaseItem };
              }
            });
          }
        }
      } catch (pe) {
        console.warn('Загрузка purchases из Supabase:', pe);
      }
    }

    list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return list;
  }

  /**
   * Псевдоним для единой истории операций (депозиты + покупки)
   */
  async getTransactionHistory() {
    return await this.getDepositHistory();
  }

  /**
   * Получение списка всех зарегистрированных пользователей платформы
  /**
   * Локальная регистрация пользователя в хранилище браузера (для истории и fallback)
   */
  recordRegisteredUser(user) {
    if (!user || !user.id || user.id === 'guest') return;
    if (!this.data.registeredUsers) {
      this.data.registeredUsers = [];
    }
    const idx = this.data.registeredUsers.findIndex(u => u.id === user.id);
    if (idx !== -1) {
      this.data.registeredUsers[idx] = { ...this.data.registeredUsers[idx], ...user };
    } else {
      this.data.registeredUsers.unshift(user);
    }
    this.saveToStorage();
  }

  /**
   * Получение списка всех зарегистрированных пользователей
   */
  async getRegisteredUsers() {
    let users = [];

    if (window.supabaseClient) {
      // 1. Прямой запрос к таблице profiles (быстро, надежно и без вызова RPC)
      try {
        const { data, error } = await window.supabaseClient
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data) && data.length > 0) {
          users = data.map(p => ({
            id: p.id,
            email: p.email || '—',
            name: p.name || (p.email ? p.email.split('@')[0] : 'User'),
            orbs: Math.floor(Number(p.orbs || 0)),
            role: p.role || 'user',
            createdAt: p.created_at || null
          }));
        }
      } catch (e) {
        console.warn('Ошибка загрузки пользователей из profiles:', e);
      }

      // 2. Если профили ещё не созданы, пробуем вызвать серверную функцию get_admin_users
      if (users.length === 0) {
        try {
          const { data: rpcUsers, error: rpcError } = await window.supabaseClient.rpc('get_admin_users');
          if (!rpcError && Array.isArray(rpcUsers) && rpcUsers.length > 0) {
            users = rpcUsers.map(p => ({
              id: p.id,
              email: p.email || '—',
              name: p.name || (p.email ? p.email.split('@')[0] : 'User'),
              orbs: Math.floor(Number(p.orbs || 0)),
              role: p.role || 'user',
              createdAt: p.created_at || null
            }));
          }
        } catch (_) {}
      }
    }

    // 3. Подмешиваем локально сохраненных зарегистрированных пользователей
    if (this.data.registeredUsers && Array.isArray(this.data.registeredUsers)) {
      this.data.registeredUsers.forEach(localUser => {
        if (!users.some(u => u.id === localUser.id)) {
          users.push(localUser);
        }
      });
    }

    // 4. Если текущий пользователь авторизован и не гость, гарантируем его присутствие
    if (this.data.currentUser && this.data.currentUser.id && this.data.currentUser.id !== 'guest') {
      if (!users.some(u => u.id === this.data.currentUser.id)) {
        users.unshift({
          id: this.data.currentUser.id,
          email: this.data.currentUser.email || '—',
          name: this.data.currentUser.name || 'Admin',
          orbs: Math.floor(Number(this.data.currentUser.orbs || 0)),
          role: this.getRole() || 'admin',
          createdAt: new Date().toISOString()
        });
      }
    }

    return users;
  }

  /**
   * Изменение баланса Орбов пользователя (для панели администратора)
   */
  async updateUserOrbs(userId, newOrbs) {
    const val = Math.max(0, Math.floor(Number(newOrbs) || 0));

    // 1. Обновляем в Supabase
    if (window.supabaseClient && userId && !userId.startsWith('usr_')) {
      const { error } = await window.supabaseClient
        .from('profiles')
        .update({ orbs: val, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (error) {
        throw new Error(error.message || 'Ошибка обновления баланса в Supabase');
      }
    }

    // 2. Если редактируется профиль текущего активного пользователя — обновляем локальное состояние
    if (this.data.currentUser && this.data.currentUser.id === userId) {
      this.data.currentUser.orbs = val;
      this.saveToStorage();
    }

    return { success: true, orbs: val };
  }

  /**
   * Загрузка всех сделок конкретного пользователя (крипто-пополнения и покупки переводов)
   */
  async getUserOrders(userId) {
    const orders = [];

    // 1. Пополнения из таблицы crypto_orders в Supabase
    if (window.supabaseClient && userId) {
      try {
        const { data, error } = await window.supabaseClient
          .from('crypto_orders')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          data.forEach(ord => {
            const network = ord.network || 'USDT (TRC-20)';
            let explorerUrl = '';
            if (ord.tx_hash) {
              if (network.includes('Polygon') || network.includes('POL')) {
                explorerUrl = `https://polygonscan.com/tx/${ord.tx_hash}`;
              } else if (network.includes('BTC') || network.includes('Bitcoin')) {
                explorerUrl = `https://www.blockchain.com/explorer/transactions/btc/${ord.tx_hash}`;
              } else {
                explorerUrl = `https://tronscan.org/#/transaction/${ord.tx_hash}`;
              }
            }

            orders.push({
              id: ord.id,
              date: ord.completed_at || ord.created_at,
              amountUsdt: Number(ord.expected_amount || ord.orbs_amount || 0),
              orbs: Number(ord.orbs_amount || 0),
              network,
              txHash: ord.tx_hash || '',
              explorerUrl,
              status: ord.status || 'pending',
              type: 'deposit'
            });
          });
        }
      } catch (e) {
        console.warn('Ошибка загрузки сделок пользователя из Supabase:', e);
      }
    }

    // 2. Покупки работ из таблицы purchases в Supabase
    if (window.supabaseClient && userId && !userId.startsWith('usr_') && userId !== 'guest') {
      try {
        const { data: pData, error: pError } = await window.supabaseClient
          .from('purchases')
          .select('*')
          .eq('user_id', userId)
          .order('purchased_at', { ascending: false });

        if (!pError && Array.isArray(pData)) {
          pData.forEach(p => {
            const ordId = `ORD-P-${p.id || p.work_id}`;
            // Если покупка была отозвана админом — исключаем из отображения
            if (this.isPurchaseRevoked(userId, p.work_id, ordId, p.id)) {
              return;
            }

            const work = this.getWorkById(p.work_id);
            const workTitle = (work && typeof work.title === 'object')
              ? { ru: work.title.ru || work.title.en || '', en: work.title.en || work.title.ru || '' }
              : (work ? { ru: work.title, en: work.titleEn || work.originalTitle || work.title } : { ru: p.work_id, en: p.work_id });
            const price = Number(p.price_paid || (work ? work.price : 1));
            orders.push({
              id: ordId,
              dbId: p.id,
              type: 'purchase',
              workId: p.work_id,
              workTitle,
              date: p.purchased_at || p.created_at || new Date().toISOString(),
              amountUsdt: price,
              orbs: -price,
              network: 'Orb Balance',
              txHash: '',
              explorerUrl: '',
              status: 'completed'
            });
          });
        }
      } catch (pe) {
        console.warn('Ошибка загрузки покупок пользователя из Supabase:', pe);
      }
    }

    // 3. Дополняем из локальных сессий (если пользователь совпадает)
    const localOrders = this.getCryptoSessionsList();
    if (localOrders.length > 0) {
      localOrders.forEach(s => {
        if (!s || !s.orderId) return;
        const belongsToUser = (this.data.currentUser && this.data.currentUser.id === userId);
        if (belongsToUser && !orders.some(o => o.id === s.orderId)) {
          orders.push({
            id: s.orderId,
            date: s.completedAt || s.paidAt || (s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString()),
            amountUsdt: Number(s.expectedAmount || s.orbsAmount || 0),
            orbs: Number(s.orbsAmount || 0),
            network: s.network,
            txHash: s.txHash || '',
            explorerUrl: '',
            status: s.status || 'pending',
            type: 'deposit'
          });
        }
      });
    }

    // 4. Дополняем покупками из локального массива this.data.orders
    if (this.data.orders && Array.isArray(this.data.orders)) {
      this.data.orders.forEach(ord => {
        if (ord && ord.type === 'purchase') {
          const belongs = (!ord.userId && this.data.currentUser && this.data.currentUser.id === userId) || (ord.userId === userId);
          if (belongs) {
            if (this.isPurchaseRevoked(userId, ord.workId, ord.id)) {
              return;
            }
            const alreadyExists = orders.some(o => o.id === ord.id || (o.workId && o.workId === ord.workId));
            if (!alreadyExists) {
              const work = this.getWorkById(ord.workId);
              const workTitle = ord.workTitle || ((work && typeof work.title === 'object')
                ? { ru: work.title.ru || work.title.en || '', en: work.title.en || work.title.ru || '' }
                : (work ? { ru: work.title, en: work.titleEn || work.originalTitle || work.title } : { ru: ord.workId, en: ord.workId }));
              const price = Number(ord.price || (work ? work.price : 1));
              orders.push({
                id: ord.id,
                type: 'purchase',
                workId: ord.workId,
                workTitle,
                date: ord.date || new Date().toISOString(),
                amountUsdt: price,
                orbs: -price,
                network: 'Orb Balance',
                txHash: '',
                explorerUrl: '',
                status: 'completed'
              });
            }
          }
        }
      });
    }

    // 5. Резервная проверка купленных работ пользователя (если запись о сделке отсутствовала)
    let userPurchasedWorks = [];
    if (this.data.currentUser && this.data.currentUser.id === userId) {
      userPurchasedWorks = [...(this.data.currentUser.purchasedWorks || [])];
    } else if (this.data.registeredUsers) {
      const reg = this.data.registeredUsers.find(u => u.id === userId);
      if (reg && reg.purchasedWorks) userPurchasedWorks = [...reg.purchasedWorks];
    }
    userPurchasedWorks.forEach(wId => {
      if (this.isPurchaseRevoked(userId, wId, `ORD-P-${wId}`)) {
        return;
      }
      const alreadyExists = orders.some(o => o.workId === wId || o.id === `ORD-P-${wId}`);
      if (!alreadyExists) {
        const work = this.getWorkById(wId);
        const workTitle = (work && typeof work.title === 'object')
          ? { ru: work.title.ru || work.title.en || '', en: work.title.en || work.title.ru || '' }
          : (work ? { ru: work.title, en: work.titleEn || work.originalTitle || work.title } : { ru: wId, en: wId });
        const price = Number(work ? work.price : 1);
        orders.push({
          id: `ORD-P-${wId}`,
          type: 'purchase',
          workId: wId,
          workTitle,
          date: new Date().toISOString(),
          amountUsdt: price,
          orbs: -price,
          network: 'Orb Balance',
          txHash: '',
          explorerUrl: '',
          status: 'completed'
        });
      }
    });

    orders.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return orders;
  }

  /**
   * Выборочное удаление отдельной сделки пополнения (crypto_orders)
   */
  async deleteCryptoOrder(orderId) {
    if (!orderId) return { success: false, message: 'ID заказа не указан' };

    // 1. Удаление из Supabase
    if (window.supabaseClient) {
      let deletedViaRpc = false;
      try {
        const { data, error } = await window.supabaseClient.rpc('delete_crypto_order', { p_order_id: orderId });
        if (!error && data && data.success) {
          deletedViaRpc = true;
        }
      } catch (_) {
        // RPC еще не создан
      }

      if (!deletedViaRpc) {
        const { error } = await window.supabaseClient
          .from('crypto_orders')
          .delete()
          .eq('id', orderId);

        if (error) {
          console.warn('Ошибка удаления из Supabase crypto_orders:', error);
          throw new Error(error.message || 'Ошибка удаления заказа из Supabase');
        }
      }
    }

    // 2. Удаление из локального хранилища
    let changed = false;
    const currentSessions = this.getCryptoSessionsList();
    const filteredSessions = currentSessions.filter(s => s && s.orderId !== orderId);
    if (filteredSessions.length !== currentSessions.length) {
      this.data.cryptoSessions = filteredSessions;
      changed = true;
    }
    if (this.data.orders) {
      const origLen = this.data.orders.length;
      this.data.orders = this.data.orders.filter(o => o && o.id !== orderId);
      if (this.data.orders.length !== origLen) changed = true;
    }

    if (changed) {
      this.saveToStorage();
    }

    return { success: true, orderId };
  }

  /**
   * Аннулирование покупки работы у пользователя с закрытием доступа
   */
  async revokeUserPurchase(userId, workId, orderId, dbId = '') {
    if (!userId && !orderId && !workId && !dbId) return { success: false, message: 'Параметры не указаны' };

    // Если workId не передан явно, пробуем извлечь его
    if (!workId && orderId) {
      if (orderId.startsWith('ORD-P-')) {
        const suffix = orderId.replace('ORD-P-', '');
        if (suffix.startsWith('work-')) {
          workId = suffix;
        }
      }
      if (!workId) {
        const ord = (this.data.orders || []).find(o => o.id === orderId);
        if (ord && ord.workId) workId = ord.workId;
      }
    }

    // 0. Запоминаем факт отзыва в локальном хранилище, чтобы скрыть сделку и закрыть доступ немедленно
    this.addRevokedPurchase(userId, workId, orderId, dbId);

    // 1. Удаление записи из Supabase таблицы purchases
    if (window.supabaseClient && userId && !String(userId).startsWith('usr_') && userId !== 'guest') {
      // 1.1. Прямое удаление по dbId (первичный ключ id в public.purchases)
      if (dbId) {
        try {
          await window.supabaseClient
            .from('purchases')
            .delete()
            .eq('id', dbId);
        } catch (_) {}
      }

      // 1.2. Прямое удаление по user_id + work_id
      if (workId) {
        try {
          await window.supabaseClient
            .from('purchases')
            .delete()
            .eq('user_id', userId)
            .eq('work_id', workId);
        } catch (_) {}
      }

      // 1.3. Серверная хранимая функция delete_user_purchase (с безопасным поиском)
      try {
        await window.supabaseClient.rpc('delete_user_purchase', {
          p_user_id: String(userId),
          p_work_id: String(workId || ''),
          p_order_id: String(dbId || '')
        });
      } catch (_) {}
    }

    // 2. Отзыв прав доступа в локальном хранилище и текущей сессии
    let changed = false;
    const isCurrent = (this.data.currentUser && (this.data.currentUser.id === userId || !userId));

    // 2.1. Если это текущий пользователь
    if (isCurrent && workId) {
      if (this.data.currentUser.purchasedWorks) {
        const origLen = this.data.currentUser.purchasedWorks.length;
        this.data.currentUser.purchasedWorks = this.data.currentUser.purchasedWorks.filter(id => id !== workId);
        if (this.data.currentUser.purchasedWorks.length !== origLen) changed = true;
      }
    }

    // 2.2. Удаляем из registeredUsers
    if (this.data.registeredUsers && Array.isArray(this.data.registeredUsers)) {
      const regUser = this.data.registeredUsers.find(u => u.id === userId);
      if (regUser && Array.isArray(regUser.purchasedWorks) && workId) {
        const origLen = regUser.purchasedWorks.length;
        regUser.purchasedWorks = regUser.purchasedWorks.filter(id => id !== workId);
        if (regUser.purchasedWorks.length !== origLen) changed = true;
      }
    }

    // 2.3. Удаляем из покупок устройства (localStorage)
    if (workId) {
      this.removeDevicePurchase(workId);
      try {
        localStorage.removeItem(`orb_progress_${workId}`);
        localStorage.removeItem(`orb_reading_progress_${workId}`);
        localStorage.removeItem(`orb_opened_after_purchase_${workId}`);
      } catch (_) {}
      changed = true;
    }

    // 2.4. Удаляем заказ из orders
    if (this.data.orders) {
      const origLen = this.data.orders.length;
      this.data.orders = this.data.orders.filter(o => {
        if (orderId && o.id === orderId) return false;
        if (workId && o.type === 'purchase' && o.workId === workId) {
          if (!o.userId || o.userId === userId || isCurrent) return false;
        }
        return true;
      });
      if (this.data.orders.length !== origLen) changed = true;
    }

    if (changed) {
      this.saveToStorage();
    }

    // 3. Немедленно обновляем интерфейс каталога и истории
    if (typeof window !== 'undefined' && window.app) {
      if (typeof window.app.renderStorefront === 'function') window.app.renderStorefront();
      if (typeof window.app.renderPurchases === 'function') window.app.renderPurchases();
      if (typeof window.app.renderDepositHistory === 'function') window.app.renderDepositHistory();
    }

    return { success: true, workId, orderId, dbId };
  }

  /**
   * Полная очистка всей истории сделок пользователя (и пополнений, и покупок с закрытием доступа)
   */
  async clearUserOrders(userId) {
    if (!userId) return { success: false, message: 'ID пользователя не указан' };

    // 0. Запоминаем отзыв всех покупок пользователя
    this.addRevokedPurchase(userId, '', '', '', true);

    // 1. Удаление всех записей из Supabase crypto_orders и purchases
    if (window.supabaseClient && !String(userId).startsWith('usr_') && userId !== 'guest') {
      try {
        await window.supabaseClient.rpc('clear_user_crypto_orders', { p_user_id: userId });
      } catch (_) {
        try {
          await window.supabaseClient.from('crypto_orders').delete().eq('user_id', userId);
        } catch (_) {}
      }

      try {
        await window.supabaseClient.rpc('clear_user_purchases', { p_user_id: String(userId) });
      } catch (_) {
        try {
          await window.supabaseClient.from('purchases').delete().eq('user_id', userId);
        } catch (_) {}
      }
    }

    // 2. Очистка локальных сессий, заказов и закрытие доступа к купленным работам
    let changed = false;
    const isCurrent = (this.data.currentUser && this.data.currentUser.id === userId);

    if (isCurrent) {
      this.data.cryptoSessions = [];
      const purchased = [...(this.data.currentUser.purchasedWorks || [])];
      purchased.forEach(wId => {
        this.removeDevicePurchase(wId);
        try {
          localStorage.removeItem(`orb_progress_${wId}`);
          localStorage.removeItem(`orb_reading_progress_${wId}`);
          localStorage.removeItem(`orb_opened_after_purchase_${wId}`);
        } catch (_) {}
      });
      this.data.currentUser.purchasedWorks = [];
      this.data.orders = (this.data.orders || []).filter(o => o.userId && o.userId !== userId);
      changed = true;
    }

    if (this.data.registeredUsers) {
      const regUser = this.data.registeredUsers.find(u => u.id === userId);
      if (regUser) {
        if (Array.isArray(regUser.purchasedWorks)) {
          regUser.purchasedWorks.forEach(wId => {
            this.removeDevicePurchase(wId);
            try {
              localStorage.removeItem(`orb_progress_${wId}`);
              localStorage.removeItem(`orb_reading_progress_${wId}`);
              localStorage.removeItem(`orb_opened_after_purchase_${wId}`);
            } catch (_) {}
          });
          regUser.purchasedWorks = [];
        }
        changed = true;
      }
    }

    if (this.data.orders) {
      const origLen = this.data.orders.length;
      this.data.orders = this.data.orders.filter(o => o.userId !== userId);
      if (this.data.orders.length !== origLen) changed = true;
    }

    if (changed) {
      this.saveToStorage();
    }

    // 3. Обновляем интерфейс
    if (typeof window !== 'undefined' && window.app) {
      if (typeof window.app.renderStorefront === 'function') window.app.renderStorefront();
      if (typeof window.app.renderPurchases === 'function') window.app.renderPurchases();
      if (typeof window.app.renderDepositHistory === 'function') window.app.renderDepositHistory();
    }

    return { success: true, userId };
  }
}

window.store = new Store();
