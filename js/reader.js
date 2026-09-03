/**
 * Reader — Движок интерактивной читалки
 * Поддерживает:
 * 1. Режим бесплатного превью (первые N страниц с блокировкой на N+1).
 * 2. Режим полного перевода для купленных работ:
 *    - Загрузка архива (.zip через JSZip) или папки с оригинальными изображениями
 *    - Выбор языка перевода из скрипта
 *    - Наложение текста, диалогов и рамок прямо в браузере (на базе движка Text Overlay Editor)
 */
class ReaderService {
  constructor(store, scriptParser) {
    this.store = store;
    this.scriptParser = scriptParser;

    this.currentWork = null;
    this.isFullMode = false;
    this.currentLang = 'Русский';
    this.pages = []; // Массив объектов страниц { name, url, scriptEntries, isLocked }
    this.currentIndex = 0;
    this.isTwoPageSpread = false;
    this.parsedScript = null;

    // Кэш изображений рамок диалогов
    this.borderImages = {};
    this.loadBorderAssets();
  }

  loadBorderAssets() {
    const borders = [
      { id: 0, file: 'Рамка 1.png' },
      { id: 1, file: 'рамка 2.png' },
      { id: 2, file: 'Рамка 3.png' },
      { id: 3, file: 'Рамка 4.png' },
      { id: 4, file: 'Рамка 5.png' }
    ];

    borders.forEach(b => {
      const img = new Image();
      img.src = `assets/borders/${b.file}`;
      this.borderImages[b.id] = img;
    });
  }

  /**
   * Открыть бесплатное превью работы
   */
  openPreview(workId) {
    const work = this.store.getWorkById(workId);
    if (!work) return;

    this.currentWork = work;
    this.isFullMode = false;
    this.currentIndex = 0;
    this.parsedScript = null;

    // Формируем список страниц превью
    const previewList = work.previewImages || [];
    const totalPreviewCount = work.previewPagesCount || previewList.length;

    this.pages = [];
    for (let i = 0; i < totalPreviewCount; i++) {
      this.pages.push({
        index: i,
        name: `Страница ${i + 1}`,
        url: previewList[i] || 'assets/demo/page-1.svg',
        isLocked: false
      });
    }

    // Добавляем страницу-заглушку с замком
    this.pages.push({
      index: totalPreviewCount,
      name: `Страница ${totalPreviewCount + 1}`,
      isLocked: true
    });

    this.renderReaderUI();
  }

  /**
   * Запуск процесса открытия купленного перевода
   */
  openFullTranslationModal(workId) {
    const work = this.store.getWorkById(workId);
    if (!work) return;

    this.currentWork = work;
    this.isFullMode = true;

    // Парсим скрипт перевода работы
    const scriptRaw = work.sampleScriptText || '';
    this.parsedScript = this.scriptParser.parse(scriptRaw);

    // Открываем модалку загрузки пользовательского архива
    window.app.showArchiveUploadModal(work);
  }

  /**
   * Обработка загруженного пользователем ZIP-архива с официальными картинками
   */
  async loadUserZipFile(file) {
    if (!window.JSZip) {
      throw new Error('Библиотека JSZip не загружена');
    }

    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(file);
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

    const imageFiles = [];
    loadedZip.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir) {
        const lower = relativePath.toLowerCase();
        if (imageExtensions.some(ext => lower.endsWith(ext))) {
          imageFiles.push(zipEntry);
        }
      }
    });

    // Сортировка по имени файлов (01-01, 01-02 ...)
    imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    if (imageFiles.length === 0) {
      throw new Error('В архиве не найдено подходящих файлов изображений (PNG, JPG, WEBP)');
    }

    // Извлечение картинок в Blob URL
    const pages = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const entry = imageFiles[i];
      const blob = await entry.async('blob');
      const blobUrl = URL.createObjectURL(blob);
      pages.push({
        index: i,
        name: entry.name,
        url: blobUrl,
        isLocked: false
      });
    }

    this.pages = pages;
    this.currentIndex = 0;

    // Предлагаем выбрать язык из скрипта
    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (this.currentWork.availableLanguages || ['Русский']);

    window.app.showLanguageSelectModal(availableLangs, (selectedLang) => {
      this.currentLang = selectedLang;
      this.renderReaderUI();
    });
  }

  /**
   * Использование встроенных демонстрационных сцен для быстрого теста
   */
  loadDemoImages() {
    const demoPages = [
      { index: 0, name: 'Image/01-01.png', url: 'assets/demo/page-1.svg', isLocked: false },
      { index: 1, name: 'Image/01-02.png', url: 'assets/demo/page-2.svg', isLocked: false },
      { index: 2, name: 'Image/01-03.png', url: 'assets/demo/page-3.svg', isLocked: false },
      { index: 3, name: 'Image/01-04.png', url: 'assets/demo/cover-1.svg', isLocked: false }
    ];

    this.pages = demoPages;
    this.currentIndex = 0;

    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (this.currentWork.availableLanguages || ['Русский']);

    window.app.showLanguageSelectModal(availableLangs, (selectedLang) => {
      this.currentLang = selectedLang;
      this.renderReaderUI();
    });
  }

  setLanguage(lang) {
    this.currentLang = lang;
    this.updateReaderDisplay();
  }

  toggleSpread() {
    this.isTwoPageSpread = !this.isTwoPageSpread;
    this.updateReaderDisplay();
  }

  nextPage() {
    const step = this.isTwoPageSpread ? 2 : 1;
    if (this.currentIndex + step < this.pages.length) {
      this.currentIndex += step;
      this.updateReaderDisplay();
    }
  }

  prevPage() {
    const step = this.isTwoPageSpread ? 2 : 1;
    if (this.currentIndex - step >= 0) {
      this.currentIndex -= step;
      this.updateReaderDisplay();
    }
  }

  goToPage(index) {
    if (index >= 0 && index < this.pages.length) {
      this.currentIndex = index;
      this.updateReaderDisplay();
    }
  }

  /**
   * Открытие полноэкранного модального окна читалки
   */
  renderReaderUI() {
    const modal = document.getElementById('reader-modal');
    if (!modal) return;

    modal.classList.add('active');
    document.body.classList.add('modal-open');

    // Настройка языка в шапке читалки
    const langSelect = document.getElementById('reader-lang-select');
    if (langSelect) {
      langSelect.innerHTML = '';
      const langs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
        ? this.parsedScript.languages
        : (this.currentWork.availableLanguages || ['Русский']);

      langs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = l;
        if (l === this.currentLang) opt.selected = true;
        langSelect.appendChild(opt);
      });
      langSelect.style.display = this.isFullMode ? 'inline-block' : 'none';
    }

    // Заголовок работы
    const titleEl = document.getElementById('reader-work-title');
    if (titleEl) {
      titleEl.textContent = this.currentWork ? this.currentWork.title : 'Читалка';
    }

    // Бейдж режима
    const badgeEl = document.getElementById('reader-mode-badge');
    if (badgeEl) {
      badgeEl.textContent = this.isFullMode ? '✨ Полный перевод' : '👁️ Превью';
      badgeEl.className = this.isFullMode ? 'badge badge-accent' : 'badge badge-warning';
    }

    this.updateReaderDisplay();
  }

  /**
   * Обновление отображения страниц на экране (1 или 2 разворота)
   */
  updateReaderDisplay() {
    const stageLeft = document.getElementById('reader-stage-left');
    const stageRight = document.getElementById('reader-stage-right');
    const spreadBtn = document.getElementById('reader-spread-btn');
    const slider = document.getElementById('reader-slider');
    const counter = document.getElementById('reader-counter');

    if (!stageLeft) return;

    if (spreadBtn) {
      spreadBtn.textContent = this.isTwoPageSpread ? '📖 2 разворота' : '📄 1 страница';
    }

    if (slider) {
      slider.max = this.pages.length - 1;
      slider.value = this.currentIndex;
    }

    if (counter) {
      counter.textContent = `${this.currentIndex + 1} / ${this.pages.length}`;
    }

    // Очистка и рендер левой страницы
    const leftPage = this.pages[this.currentIndex];
    this.renderPageToStage(stageLeft, leftPage);

    // Рендер правой страницы (если включен режим двух страниц)
    if (this.isTwoPageSpread && this.currentIndex + 1 < this.pages.length) {
      stageRight.style.display = 'flex';
      const rightPage = this.pages[this.currentIndex + 1];
      this.renderPageToStage(stageRight, rightPage);
    } else {
      stageRight.style.display = 'none';
      stageRight.innerHTML = '';
    }
  }

  /**
   * Рендер конкретной страницы с возможным наложением текстовых слоев
   */
  renderPageToStage(container, page) {
    container.innerHTML = '';
    if (!page) return;

    // Если это заблокированная страница превью
    if (page.isLocked) {
      container.innerHTML = `
        <div class="reader-lock-screen">
          <div class="lock-icon">🔒</div>
          <h2>Бесплатное превью завершено</h2>
          <p>Вы просмотрели доступные страницы превью. Чтобы продолжить чтение с полным наложением перевода, приобретите работу.</p>
          <div class="lock-price-badge">
            Стоимость: <strong>${this.currentWork ? this.currentWork.price : 1} Орб</strong> (1 USDT)
          </div>
          <div class="lock-actions">
            ${this.store.getRole() === 'guest' 
              ? `<button class="btn btn-accent btn-large" onclick="window.app.showAuthModal()">🔑 Войти / Зарегистрироваться</button>`
              : `<button class="btn btn-accent btn-large" onclick="window.app.handlePurchaseWork('${this.currentWork ? this.currentWork.id : ''}')">⚡ Купить перевод за ${this.currentWork ? this.currentWork.price : 1} Орб</button>`
            }
          </div>
        </div>
      `;
      return;
    }

    // Обычная страница с изображением
    const wrapper = document.createElement('div');
    wrapper.className = 'page-viewport-wrapper';

    const img = document.createElement('img');
    img.src = page.url;
    img.className = 'reader-base-image';
    img.alt = page.name;
    wrapper.appendChild(img);

    // Если в режиме полного перевода доступен скрипт — накладываем слои
    if (this.isFullMode && this.parsedScript) {
      const overlayLayer = this.generateOverlayLayer(page.name);
      if (overlayLayer) {
        wrapper.appendChild(overlayLayer);
      }
    }

    container.appendChild(wrapper);
  }

  /**
   * Генерация HTML-слоя наложения для конкретного файла изображения
   */
  generateOverlayLayer(fileName) {
    if (!this.parsedScript) return null;

    const overlayLayer = document.createElement('div');
    overlayLayer.className = 'reader-overlay-layer';

    // Поиск записей для выбранного языка и текущего файла
    const langEntries = this.parsedScript.entries ? this.parsedScript.entries[this.currentLang] : null;
    const overlayData = this.parsedScript.overlayData || {};
    const entriesMeta = overlayData.entries || {};

    let matchingEntry = null;
    if (langEntries && Array.isArray(langEntries)) {
      matchingEntry = langEntries.find(e => {
        const cleanE = (e.file || '').replace(/\\/g, '/');
        const cleanF = (fileName || '').replace(/\\/g, '/');
        return cleanF.includes(cleanE) || cleanE.includes(cleanF);
      });
    }

    if (!matchingEntry || !matchingEntry.blocks || matchingEntry.blocks.length === 0) {
      return null;
    }

    // Рендеринг блоков текста
    matchingEntry.blocks.forEach((blockText, blockIdx) => {
      const blockKey = `${matchingEntry.file}_block_${blockIdx}`;
      const blockMeta = entriesMeta[blockKey] || { x: 15, y: 75, w: 70, h: 18 };

      const box = document.createElement('div');
      box.className = 'reader-text-box';
      box.style.left = `${blockMeta.x || 15}%`;
      box.style.top = `${blockMeta.y || 75}%`;
      box.style.width = `${blockMeta.w || 70}%`;

      // Если указана диалоговая рамка (borderIndex: 0..4)
      if (blockMeta.borderIndex !== undefined && this.borderImages[blockMeta.borderIndex]) {
        box.classList.add('reader-dialog-box');
        const frameImg = document.createElement('img');
        frameImg.src = this.borderImages[blockMeta.borderIndex].src;
        frameImg.className = 'reader-frame-background';
        box.appendChild(frameImg);
      }

      const textEl = document.createElement('div');
      textEl.className = 'reader-box-content';
      textEl.textContent = blockText;

      box.appendChild(textEl);
      overlayLayer.appendChild(box);
    });

    return overlayLayer;
  }

  closeReader() {
    const modal = document.getElementById('reader-modal');
    if (modal) {
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
    }
  }
}

window.reader = new ReaderService(window.store, window.scriptParser || new ScriptParser());
