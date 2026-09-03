/**
 * Store — Центральное хранилище состояния платформы
 * Хранит каталог работ, баланс Орбов, историю покупок и настройки xPub кошелька.
 */
class Store {
  static STORAGE_KEY = 'orb_marketplace_data_v1';

  constructor() {
    this.data = this.loadFromStorage();
    if (!this.data || !this.data.works || this.data.works.length === 0) {
      this.data = this.getDefaultInitialData();
      this.saveToStorage();
    }
  }

  getDefaultInitialData() {
    return {
      currentUser: {
        id: 'usr_77',
        name: 'Иван Переводчик',
        email: 'reader@studio.com',
        orbs: 2.0, // Стартовый баланс для тестирования покупки
        purchasedWorks: [] // Изначально пусто, чтобы можно было протестировать процесс покупки!
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
          title: 'Хроники Забытого Клинка: Пролог',
          originalTitle: 'Chronicles of the Forgotten Blade',
          description: 'Художественный перевод пролога и первой главы визуальной новеллы. Полная адаптация диалоговых окон, кастомные рамки персонажей и наложение реплик с оригинальной стилистикой.',
          author: 'Glaive Team',
          price: 1, // 1 Орб = 1 USDT
          totalPages: 16,
          previewPagesCount: 3, // Первые 3 страницы доступны бесплатно всем!
          tags: ['Визуальная новелла', 'Фэнтези', 'Драма', '18+'],
          coverUrl: 'assets/demo/cover-1.svg',
          previewImages: [
            'assets/demo/page-1.svg',
            'assets/demo/page-2.svg',
            'assets/demo/page-3.svg'
          ],
          availableLanguages: ['Русский', 'English', '日本語'],
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
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Ошибка загрузки Store:', e);
      return null;
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem(Store.STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error('Ошибка сохранения Store:', e);
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

    // Списание баланса
    this.data.currentUser.orbs = Math.round((this.data.currentUser.orbs - work.price) * 100) / 100;
    this.data.currentUser.purchasedWorks.push(workId);
    this.data.orders.push({
      id: 'ord_' + Date.now(),
      workId,
      workTitle: work.title,
      price: work.price,
      date: new Date().toISOString(),
      type: 'purchase'
    });
    this.saveToStorage();
    return { success: true, newBalance: this.data.currentUser.orbs };
  }

  hasPurchased(workId) {
    if (this.getRole() === 'admin') return true; // Админу доступно всё
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
      title: workData.title || 'Новая работа',
      originalTitle: workData.originalTitle || '',
      description: workData.description || '',
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
      availableLanguages: workData.availableLanguages || ['Русский'],
      scriptFileName: workData.scriptFileName || `${workData.title || 'script'}.txt`,
      sampleScriptText: workData.sampleScriptText || '',
      createdAt: new Date().toISOString().split('T')[0]
    };
    this.data.works.unshift(work);
    this.saveToStorage();
    return work;
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

  resetAll() {
    this.data = this.getDefaultInitialData();
    this.saveToStorage();
  }
}

// Экспорт глобального синглтона
window.store = new Store();
