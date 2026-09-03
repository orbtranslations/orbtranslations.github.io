/**
 * Reader — Интерактивная читалка визуальных новелл и манги
 * 
 * Ключевые возможности и оптимизации:
 * - Ленивая распаковка (On-Demand Extraction):
 *   Архивы любого размера (включая 270+ МБ и сотни файлов) загружаются мгновенно без переполнения памяти и краша вкладки.
 *   Изображение распаковывается ТОЛЬКО для текущей просматриваемой страницы (+ фоновый предзагрузчик следующей).
 * - Поддержка как ZIP архивов (.zip, .cbz), так и прямого выбора папки с графикой (webkitdirectory).
 * - Превью требует графику новеллы: бесплатный просмотр первых N страниц с наложением перевода,
 *   после чего отображается экран блокировки с возможностью моментальной покупки.
 * - При покупке читалка моментально открывает все остальные страницы без необходимости повторной загрузки архива.
 */
class ReaderService {
  constructor(store, scriptParser) {
    this.store = store;
    this.parser = scriptParser || new ScriptParser();
    this.currentWork = null;
    this.isFullMode = false;
    this.pages = []; // { index, name, zipEntry, file, url, isLocked }
    this.currentIndex = 0;
    this.isTwoPageSpread = false;
    this.parsedScript = null;
    this.currentLang = 'Русский';
    this.borderImages = [];
    this.workArchives = {}; // workId -> { pages, parsedScript, loadedZip, isFolder }
    this.activeBlobPages = []; // LRU кэш Blob URL для предотвращения утечек памяти
    this.loadBorders();
  }

  loadBorders() {
    for (let i = 1; i <= 5; i++) {
      const img = new Image();
      img.src = `assets/borders/Рамка ${i}.png`;
      this.borderImages.push(img);
    }
  }

  /**
   * Открытие бесплатного превью работы
   */
  openPreview(workId) {
    const work = this.store.getWorkById(workId);
    if (!work) return;

    this.currentWork = work;
    this.isFullMode = false;

    // Парсинг скрипта работы
    if (work.sampleScriptText) {
      try {
        this.parsedScript = this.parser.parse(work.sampleScriptText);
      } catch (e) {
        console.error('Ошибка парсинга скрипта работы:', e);
      }
    }

    // Если архив/папка для этой работы уже были загружены в текущей сессии
    if (this.workArchives[workId]) {
      const cached = this.workArchives[workId];
      const previewLimit = work.previewPagesCount || 3;

      this.pages = cached.pages.map(p => ({
        ...p,
        isLocked: p.index >= previewLimit
      }));
      this.currentIndex = 0;
      this.renderReaderUI();
    } else {
      // Иначе открываем окно выбора архива/папки для превью
      window.app.showArchiveUploadModal(work, 'preview');
    }
  }

  /**
   * Открытие купленной работы в полном режиме
   */
  openFullTranslationModal(workId) {
    const work = this.store.getWorkById(workId);
    if (!work) return;

    this.currentWork = work;
    this.isFullMode = true;

    // Парсинг скрипта работы
    if (work.sampleScriptText) {
      try {
        this.parsedScript = this.parser.parse(work.sampleScriptText);
      } catch (e) {
        console.error('Ошибка парсинга скрипта работы:', e);
      }
    }

    // Если архив/папка уже загружены в сессии
    if (this.workArchives[workId]) {
      const cached = this.workArchives[workId];
      this.pages = cached.pages.map(p => ({ ...p, isLocked: false }));
      this.currentIndex = 0;
      this.renderReaderUI();
    } else {
      // Запрос на загрузку архива/папки для полного чтения
      window.app.showArchiveUploadModal(work, 'full');
    }
  }

  /**
   * Разблокировка полного чтения прямо из читалки после покупки
   */
  unlockFullReading() {
    this.isFullMode = true;
    this.pages.forEach(p => { p.isLocked = false; });
    const modeBadge = document.getElementById('reader-mode-badge');
    if (modeBadge) {
      modeBadge.className = 'badge badge-accent';
      modeBadge.textContent = window.i18n && window.i18n.getLang() === 'en' ? '✨ Full Translation' : '✨ Полный перевод';
    }
    this.updateReaderDisplay();
  }

  /**
   * Ленивая загрузка ZIP-архива БЕЗ распаковки всех картинок в память.
   * Читает только каталог файлов, предотвращая падение вкладки браузера от переполнения RAM.
   */
  async loadUserZipFile(file) {
    if (!window.JSZip) {
      throw new Error('Библиотека JSZip не загружена');
    }

    const zip = new JSZip();
    // Чтение метаданных архива
    const loadedZip = await zip.loadAsync(file);
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

    const imageEntries = [];
    loadedZip.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir) {
        const lower = relativePath.toLowerCase();
        if (imageExtensions.some(ext => lower.endsWith(ext))) {
          imageEntries.push(zipEntry);
        }
      }
    });

    // Натуральная сортировка файлов
    imageEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    if (imageEntries.length === 0) {
      throw new Error('В архиве не найдено поддерживаемых файлов изображений (PNG, JPG, WEBP, BMP)');
    }

    // Создаем дескрипторы страниц: url = null (будет извлекаться по требованию)
    const pages = imageEntries.map((entry, index) => ({
      index,
      name: entry.name,
      zipEntry: entry,
      file: null,
      url: null,
      isLocked: false
    }));

    this.initPagesWithMode(pages);
  }

  /**
   * Загрузка папки с оригинальными файлами изображений (через webkitdirectory)
   * Нулевые затраты памяти, моментальный отклик!
   */
  async loadUserFolder(files) {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
    const imageFiles = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const lower = file.name.toLowerCase();
      if (imageExtensions.some(ext => lower.endsWith(ext))) {
        imageFiles.push(file);
      }
    }

    if (imageFiles.length === 0) {
      throw new Error('В выбранной папке не найдено файлов изображений (PNG, JPG, WEBP, BMP)');
    }

    imageFiles.sort((a, b) => {
      const pathA = a.webkitRelativePath || a.name;
      const pathB = b.webkitRelativePath || b.name;
      return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const pages = imageFiles.map((file, index) => ({
      index,
      name: file.webkitRelativePath || file.name,
      file: file,
      zipEntry: null,
      url: null,
      isLocked: false
    }));

    this.initPagesWithMode(pages);
  }

  /**
   * Инициализация списка страниц в зависимости от текущего режима (превью / полный)
   */
  initPagesWithMode(pages) {
    const work = this.currentWork;
    const isPreview = !this.isFullMode;
    const previewLimit = work ? (work.previewPagesCount || 3) : 3;

    // В режиме превью блокируем доступ к страницам после лимита
    pages.forEach(p => {
      p.isLocked = isPreview && (p.index >= previewLimit);
    });

    this.pages = pages;
    this.currentIndex = 0;

    // Сохраняем в кэш сессии, чтобы не заставлять пользователя повторно загружать архив
    if (work) {
      this.workArchives[work.id] = {
        pages: pages,
        loadedAt: Date.now()
      };
    }

    // Предлагаем выбрать язык перевода из скрипта
    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (work ? work.availableLanguages : ['Русский', 'English']);

    window.app.showLanguageSelectModal(availableLangs, (selectedLang) => {
      this.currentLang = selectedLang;
      this.renderReaderUI();
    });
  }

  /**
   * Использование демонстрационных сцен для быстрого теста
   */
  loadDemoImages() {
    const work = this.currentWork;
    const isPreview = !this.isFullMode;
    const previewLimit = work ? (work.previewPagesCount || 3) : 3;

    const demoPages = [
      { index: 0, name: 'Image/01-01.png', url: 'assets/demo/page-1.svg', isLocked: false },
      { index: 1, name: 'Image/01-02.png', url: 'assets/demo/page-2.svg', isLocked: false },
      { index: 2, name: 'Image/01-03.png', url: 'assets/demo/page-3.svg', isLocked: false },
      { index: 3, name: 'Image/01-04.png', url: 'assets/demo/cover-1.svg', isLocked: isPreview && (3 >= previewLimit) }
    ];

    this.pages = demoPages;
    this.currentIndex = 0;

    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (work ? work.availableLanguages : ['Русский', 'English']);

    window.app.showLanguageSelectModal(availableLangs, (selectedLang) => {
      this.currentLang = selectedLang;
      this.renderReaderUI();
    });
  }

  /**
   * Разрешение Blob URL для страницы по требованию (ленивая декомпрессия)
   */
  async resolvePageUrl(page) {
    if (page.url) return page.url;

    if (page.file) {
      page.url = URL.createObjectURL(page.file);
      this.trackLoadedBlob(page);
      return page.url;
    }

    if (page.zipEntry) {
      // Распаковываем ТОЛЬКО этот один файл
      const blob = await page.zipEntry.async('blob');
      page.url = URL.createObjectURL(blob);
      this.trackLoadedBlob(page);
      return page.url;
    }

    return '';
  }

  /**
   * Управление памятью: освобождает старые Blob URL, когда их накапливается слишком много
   */
  trackLoadedBlob(page) {
    this.activeBlobPages.push(page);
    if (this.activeBlobPages.length > 12) {
      const oldest = this.activeBlobPages.shift();
      const dist = Math.abs(oldest.index - this.currentIndex);
      // Если страница далеко от текущего положения читателя, освобождаем Blob URL
      if (dist > 2 && oldest.url && !oldest.file) {
        URL.revokeObjectURL(oldest.url);
        oldest.url = null;
      } else {
        this.activeBlobPages.push(oldest);
      }
    }
  }

  /**
   * Фоновый предзагрузчик следующей страницы для быстрого перелистывания
   */
  preloadNextPage() {
    const step = this.isTwoPageSpread ? 2 : 1;
    const nextIdx = this.currentIndex + step;
    if (nextIdx < this.pages.length && !this.pages[nextIdx].isLocked && !this.pages[nextIdx].url) {
      this.resolvePageUrl(this.pages[nextIdx]).catch(() => {});
    }
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

  renderReaderUI() {
    const modal = document.getElementById('reader-modal');
    if (!modal) return;

    modal.classList.add('active');
    document.body.classList.add('modal-open');

    const titleEl = document.getElementById('reader-work-title');
    const modeBadge = document.getElementById('reader-mode-badge');
    const langSelect = document.getElementById('reader-lang-select');

    if (titleEl) {
      titleEl.textContent = window.i18n ? window.i18n.getWorkTitle(this.currentWork) : (this.currentWork ? this.currentWork.title : 'Читалка');
    }

    if (modeBadge) {
      if (this.isFullMode) {
        modeBadge.className = 'badge badge-accent';
        modeBadge.textContent = window.i18n && window.i18n.getLang() === 'en' ? '✨ Full Translation' : '✨ Полный перевод';
      } else {
        modeBadge.className = 'badge badge-info';
        modeBadge.textContent = window.i18n && window.i18n.getLang() === 'en' ? '👁️ Free Preview' : '👁️ Бесплатное превью';
      }
    }

    if (langSelect) {
      const languages = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
        ? this.parsedScript.languages
        : (this.currentWork ? this.currentWork.availableLanguages : ['Русский', 'English']);

      langSelect.innerHTML = (languages || ['Русский']).map(l => `<option value="${l}" ${l === this.currentLang ? 'selected' : ''}>🗣️ ${l}</option>`).join('');
      langSelect.style.display = 'inline-block';
    }

    this.updateReaderDisplay();
  }

  updateReaderDisplay() {
    const stageLeft = document.getElementById('reader-stage-left');
    const stageRight = document.getElementById('reader-stage-right');
    const spreadBtn = document.getElementById('reader-spread-btn');
    const counter = document.getElementById('reader-counter');
    const slider = document.getElementById('reader-slider');

    if (!stageLeft || !stageRight) return;

    if (spreadBtn) {
      spreadBtn.textContent = this.isTwoPageSpread ? '📖 2 разворота' : '📄 1 страница';
    }

    if (slider) {
      slider.max = Math.max(0, this.pages.length - 1);
      slider.value = this.currentIndex;
    }

    if (counter) {
      counter.textContent = `${this.currentIndex + 1} / ${this.pages.length}`;
    }

    // Левая страница
    const leftPage = this.pages[this.currentIndex];
    this.renderPageToStage(stageLeft, leftPage);

    // Правая страница (при 2-х страницах)
    if (this.isTwoPageSpread && this.currentIndex + 1 < this.pages.length) {
      stageRight.style.display = 'flex';
      const rightPage = this.pages[this.currentIndex + 1];
      this.renderPageToStage(stageRight, rightPage);
    } else {
      stageRight.style.display = 'none';
      stageRight.innerHTML = '';
    }
  }

  async renderPageToStage(container, page) {
    container.innerHTML = '';
    if (!page) return;

    // Экран блокировки завершения бесплатного превью
    if (page.isLocked) {
      const price = this.currentWork ? this.currentWork.price : 1;
      const previewPages = this.currentWork ? (this.currentWork.previewPagesCount || 3) : 3;
      const totalPages = this.pages.length;
      const isEn = window.i18n && window.i18n.getLang() === 'en';

      container.innerHTML = `
        <div class="reader-lock-screen">
          <div class="lock-icon">🔒</div>
          <h2>${isEn ? 'Free Preview Concluded' : 'Бесплатное превью завершено'}</h2>
          <p>${isEn 
            ? `You have viewed all ${previewPages} free preview pages out of ${totalPages}. Purchase the translation to unlock the remaining pages.` 
            : `Вы просмотрели доступные страницы превью (${previewPages} из ${totalPages} стр.). Чтобы продолжить чтение всей новеллы с наложением перевода, приобретите работу.`}
          </p>
          <div class="lock-price-badge">
            ${isEn ? 'Price:' : 'Стоимость:'} <strong>${price} Орб</strong> (${price} USDT)
          </div>
          <div class="lock-actions">
            ${this.store.getRole() === 'guest' 
              ? `<button class="btn btn-accent btn-large" onclick="window.app.showAuthModal()">${isEn ? '🔑 Sign In / Register' : '🔑 Войти / Зарегистрироваться'}</button>`
              : `<button class="btn btn-accent btn-large" onclick="window.app.handlePurchaseWork('${this.currentWork ? this.currentWork.id : ''}', true)">${isEn ? `⚡ Buy for ${price} Orb & Continue Reading` : `⚡ Купить перевод за ${price} Орб и продолжить чтение`}</button>`
            }
          </div>
        </div>
      `;
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'page-viewport-wrapper';

    const img = document.createElement('img');
    img.className = 'reader-base-image';
    img.alt = page.name;

    // Ленивая подгрузка изображения
    if (!page.url) {
      const spinner = document.createElement('div');
      spinner.className = 'page-loading-spinner';
      spinner.innerHTML = `<div class="spinner-orb">⏳</div><p style="font-size: 0.9rem; color: var(--text-muted);">Распаковка сцены...</p>`;
      wrapper.appendChild(spinner);
      container.appendChild(wrapper);

      try {
        const url = await this.resolvePageUrl(page);
        if (spinner.parentNode) spinner.remove();
        img.src = url;
        wrapper.appendChild(img);
      } catch (err) {
        if (spinner.parentNode) {
          spinner.innerHTML = `❌ <span style="color: var(--accent-danger);">Ошибка загрузки: ${err.message}</span>`;
        }
        return;
      }
    } else {
      img.src = page.url;
      wrapper.appendChild(img);
    }

    // Наложение текстового слоя из скрипта перевода
    if (this.parsedScript) {
      const overlayLayer = this.generateOverlayLayer(page.name);
      if (overlayLayer) {
        wrapper.appendChild(overlayLayer);
      }
    }

    container.appendChild(wrapper);

    // Фоновая предзагрузка следующей страницы
    this.preloadNextPage();
  }

  /**
   * Поиск соответствующей записи в скрипте по имени файла изображения
   */
  findMatchingScriptEntry(fileName) {
    if (!this.parsedScript || !this.parsedScript.entries) return null;

    const langEntries = this.parsedScript.entries[this.currentLang] 
      || this.parsedScript.entries['RUS'] 
      || this.parsedScript.entries['ENG']
      || Object.values(this.parsedScript.entries)[0];

    if (!langEntries || !Array.isArray(langEntries)) return null;

    const normFile = (fileName || '').replace(/\\/g, '/');
    const baseName = normFile.split('/').pop() || '';
    const baseNameNoExt = baseName.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();
    const fullNoExt = normFile.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();

    // 1. Точное совпадение
    let match = langEntries.find(e => {
      const keyNorm = (e.key || '').replace(/\\/g, '/').toLowerCase();
      const fnNorm = (e.filename || '').replace(/\\/g, '/').toLowerCase();
      return keyNorm === fullNoExt || fnNorm === baseNameNoExt || keyNorm === baseNameNoExt;
    });

    // 2. Частичное совпадение
    if (!match) {
      match = langEntries.find(e => {
        const keyNorm = (e.key || '').replace(/\\/g, '/').toLowerCase();
        const fnNorm = (e.filename || '').replace(/\\/g, '/').toLowerCase();
        return baseNameNoExt.includes(fnNorm) || fnNorm.includes(baseNameNoExt) || fullNoExt.endsWith(keyNorm);
      });
    }

    return match;
  }

  /**
   * Генерация HTML-слоя наложения реплик и рамок поверх изображения
   */
  generateOverlayLayer(fileName) {
    const entry = this.findMatchingScriptEntry(fileName);
    if (!entry) return null;

    const rawText = entry.text || '';
    const blocks = ScriptParser.getBlocks(rawText);
    if (blocks.length === 0) return null;

    const overlayLayer = document.createElement('div');
    overlayLayer.className = 'reader-overlay-layer';

    const overlayData = this.parsedScript.overlayData || {};
    const presets = overlayData.presets || [];
    const imagesData = overlayData.images || {};
    const dialogData = overlayData.dialogData || {};
    const entriesMeta = overlayData.entries || {};

    const imageKey = entry.key || entry.filename;
    const strippedKey = (entry.filename || imageKey.split('/').pop() || '');

    const imgBoxes = imagesData[imageKey] || imagesData[strippedKey] || imagesData[`Image/${strippedKey}`] || [];

    blocks.forEach((blockText, idx) => {
      const blockDataKey1 = `${imageKey}_block_${idx}`;
      const blockDataKey2 = `${strippedKey}_block_${idx}`;
      const bSettings = dialogData[blockDataKey1] || dialogData[blockDataKey2] || {};
      const directEntryMeta = entriesMeta[blockDataKey1] || entriesMeta[blockDataKey2] || {};

      const imgBox = imgBoxes[idx] || {};
      const x = imgBox.x !== undefined ? imgBox.x : (directEntryMeta.x !== undefined ? directEntryMeta.x : 12);
      const y = imgBox.y !== undefined ? imgBox.y : (directEntryMeta.y !== undefined ? directEntryMeta.y : (68 + idx * 8));
      const w = imgBox.w !== undefined ? imgBox.w : (directEntryMeta.w !== undefined ? directEntryMeta.w : 76);

      const presetName = bSettings.preset || imgBox.preset || directEntryMeta.preset;
      const preset = presets.find(p => p.name === presetName) || {};
      const borderIdx = bSettings.borderIndex !== undefined ? bSettings.borderIndex : (directEntryMeta.borderIndex);

      const box = document.createElement('div');
      box.className = 'reader-text-box';
      box.style.left = `${Math.min(90, Math.max(0, x))}%`;
      box.style.top = `${Math.min(90, Math.max(0, y))}%`;
      box.style.width = `${Math.min(95, Math.max(20, w))}%`;

      if (preset.color) box.style.color = preset.color;
      if (preset.fontFamily) box.style.fontFamily = preset.fontFamily;
      if (preset.fontSize) box.style.fontSize = `${preset.fontSize}px`;
      if (preset.fontWeight) box.style.fontWeight = preset.fontWeight;
      if (preset.textAlign) box.style.textAlign = preset.textAlign;
      if (preset.lineHeight) box.style.lineHeight = preset.lineHeight;

      if (preset.strokeWidth && preset.strokeWidth > 0) {
        const strokeColor = preset.strokeColor || '#000';
        box.style.textShadow = `-${preset.strokeWidth}px -${preset.strokeWidth}px 0 ${strokeColor}, ${preset.strokeWidth}px -${preset.strokeWidth}px 0 ${strokeColor}, -${preset.strokeWidth}px ${preset.strokeWidth}px 0 ${strokeColor}, ${preset.strokeWidth}px ${preset.strokeWidth}px 0 ${strokeColor}`;
      }

      if (borderIdx !== undefined && this.borderImages[borderIdx]) {
        box.classList.add('reader-dialog-box');
        const frameImg = document.createElement('img');
        frameImg.src = this.borderImages[borderIdx].src;
        frameImg.className = 'reader-frame-background';
        box.appendChild(frameImg);
      } else if (preset.bgColor) {
        const opacity = preset.bgOpacity !== undefined ? preset.bgOpacity : 0.8;
        box.style.backgroundColor = preset.bgColor.startsWith('#') 
          ? `${preset.bgColor}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`
          : preset.bgColor;
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

window.reader = new ReaderService(window.store, new ScriptParser());
