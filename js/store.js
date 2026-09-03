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
    }

    // 2. Асинхронная подгрузка из IndexedDB (восстанавливает полные тяжелые скрипты и изменения)
    this.initAsyncStorage();
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

        if (window.app) {
          window.app.renderStorefront();
          if (window.admin) window.admin.renderWorksTable();
        }
      }
    } catch (e) {
      console.warn('Ошибка при инициализации IndexedDB:', e);
    }
  }

  getDefaultInitialData() {
    return {
      siteLang: 'ru', // 'ru' | 'en'
      currentUser: {
        id: 'usr_77',
        name: 'Иван Переводчик',
        email: 'reader@studio.com',
        orbs: 2.0, // Стартовый баланс для тестирования покупки
        purchasedWorks: []
      },
      currentRole: 'user', // 'guest' | 'user' | 'admin'
      xpubSettings: {
        masterPublicKey: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaY79FsjjPr32RVoU4YNzcYTLwn7G6b6xLj7b2avgKA4cG6b29SBkg6SnBRU4oU',
        defaultNetwork: 'USDT (TRC-20)',
        nextOrderIndex: 142
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

  // Настройки xPub
  getXpubSettings() {
    return this.data.xpubSettings;
  }

  updateXpubSettings(newSettings) {
    this.data.xpubSettings = { ...this.data.xpubSettings, ...newSettings };
    this.saveToStorage();
  }

  getNextOrderIndex() {
    const idx = this.data.xpubSettings.nextOrderIndex || 100;
    this.data.xpubSettings.nextOrderIndex = idx + 1;
    this.saveToStorage();
    return idx;
  }
}

window.store = new Store();
