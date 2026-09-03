/**
 * Reader — Интерактивная читалка визуальных новелл и манги
 * Поддерживает:
 * - Бесплатное превью (с блокировкой страниц после лимита)
 * - Полный режим с наложением текста из скрипта на графику
 * - Поддержку реальных форматов Overlaying text on graphics:
 *   (overlayData.images, overlayData.dialogData, overlayData.presets, рамки и портреты)
 * - Одностраничный и двухстраничный разворот
 * - Динамический выбор языка перевода
 */
class ReaderService {
  constructor(store, scriptParser) {
    this.store = store;
    this.parser = scriptParser || new ScriptParser();
    this.currentWork = null;
    this.isFullMode = false;
    this.pages = []; // { index, name, url, isLocked }
    this.currentIndex = 0;
    this.isTwoPageSpread = false;
    this.parsedScript = null;
    this.currentLang = 'Русский';
    this.borderImages = [];
    this.loadBorders();
  }

  loadBorders() {
    // Предзагрузка 5 рамок из assets/borders/
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
    this.currentIndex = 0;

    // В превью показываем первые previewPagesCount страниц из превью-ассетов
    const previewCount = work.previewPagesCount || 3;
    const totalCount = work.totalPages || 10;
    const pages = [];

    const sampleImages = work.previewImages || [
      'assets/demo/page-1.svg',
      'assets/demo/page-2.svg',
      'assets/demo/page-3.svg'
    ];

    // Доступные бесплатные страницы
    for (let i = 0; i < previewCount; i++) {
      pages.push({
        index: i,
        name: `Preview Page ${i + 1}`,
        url: sampleImages[i % sampleImages.length],
        isLocked: false
      });
    }

    // Заблокированная страница превью
    if (totalCount > previewCount) {
      pages.push({
        index: previewCount,
        name: `Locked Page ${previewCount + 1}`,
        url: '',
        isLocked: true
      });
    }

    this.pages = pages;
    this.renderReaderUI();
  }

  /**
   * Открытие купленной работы: показывает модалку загрузки оригинального архива (.zip)
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

    window.app.showArchiveUploadModal(work);
  }

  /**
   * Обработка загруженного пользователем ZIP архива с изображениями
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

    // Натуральная сортировка файлов
    imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    if (imageFiles.length === 0) {
      throw new Error('В архиве не найдено поддерживаемых файлов изображений (PNG, JPG, WEBP, BMP)');
    }

    // Извлечение в память (Blob URL)
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

    // Определение доступных языков из скрипта
    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (this.currentWork.availableLanguages || ['Русский', 'English']);

    window.app.showLanguageSelectModal(availableLangs, (selectedLang) => {
      this.currentLang = selectedLang;
      this.renderReaderUI();
    });
  }

  /**
   * Использование демонстрационных сцен для быстрого тестирования
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
      : (this.currentWork.availableLanguages || ['Русский', 'English']);

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
   * Рендер читалки
   */
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

    // Выбор языков
    if (langSelect) {
      const languages = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
        ? this.parsedScript.languages
        : (this.currentWork ? this.currentWork.availableLanguages : ['Русский']);

      langSelect.innerHTML = (languages || ['Русский']).map(l => `<option value="${l}" ${l === this.currentLang ? 'selected' : ''}>🗣️ ${l}</option>`).join('');
      langSelect.style.display = this.isFullMode ? 'inline-block' : 'none';
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

  renderPageToStage(container, page) {
    container.innerHTML = '';
    if (!page) return;

    // Экран блокировки превью
    if (page.isLocked) {
      const price = this.currentWork ? this.currentWork.price : 1;
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      container.innerHTML = `
        <div class="reader-lock-screen">
          <div class="lock-icon">🔒</div>
          <h2>${isEn ? 'Free Preview Concluded' : 'Бесплатное превью завершено'}</h2>
          <p>${isEn ? 'You have reached the end of the free preview. Unlock the full adapted translation to read the entire release.' : 'Вы просмотрели доступные страницы превью. Чтобы продолжить чтение с полным наложением перевода, приобретите работу.'}</p>
          <div class="lock-price-badge">
            ${isEn ? 'Price:' : 'Стоимость:'} <strong>${price} Орб</strong> (${price} USDT)
          </div>
          <div class="lock-actions">
            ${this.store.getRole() === 'guest' 
              ? `<button class="btn btn-accent btn-large" onclick="window.app.showAuthModal()">${isEn ? '🔑 Sign In / Register' : '🔑 Войти / Зарегистрироваться'}</button>`
              : `<button class="btn btn-accent btn-large" onclick="window.app.handlePurchaseWork('${this.currentWork ? this.currentWork.id : ''}')">${isEn ? `⚡ Buy for ${price} Orb` : `⚡ Купить перевод за ${price} Орб`}</button>`
            }
          </div>
        </div>
      `;
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'page-viewport-wrapper';

    const img = document.createElement('img');
    img.src = page.url;
    img.className = 'reader-base-image';
    img.alt = page.name;
    wrapper.appendChild(img);

    // Наложение слоев в режиме полного перевода
    if (this.isFullMode && this.parsedScript) {
      const overlayLayer = this.generateOverlayLayer(page.name);
      if (overlayLayer) {
        wrapper.appendChild(overlayLayer);
      }
    }

    container.appendChild(wrapper);
  }

  /**
   * Находит запись в скрипте, соответствующую имени файла изображения
   */
  findMatchingScriptEntry(fileName) {
    if (!this.parsedScript || !this.parsedScript.entries) return null;

    const langEntries = this.parsedScript.entries[this.currentLang] 
      || this.parsedScript.entries['RUS'] 
      || this.parsedScript.entries['ENG']
      || Object.values(this.parsedScript.entries)[0];

    if (!langEntries || !Array.isArray(langEntries)) return null;

    // Нормализация имени файла из архива
    const normFile = (fileName || '').replace(/\\/g, '/');
    const baseName = normFile.split('/').pop() || '';
    const baseNameNoExt = baseName.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();
    const fullNoExt = normFile.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();

    // 1. Точное совпадение по key или filename
    let match = langEntries.find(e => {
      const keyNorm = (e.key || '').replace(/\\/g, '/').toLowerCase();
      const fnNorm = (e.filename || '').replace(/\\/g, '/').toLowerCase();
      return keyNorm === fullNoExt || fnNorm === baseNameNoExt || keyNorm === baseNameNoExt;
    });

    // 2. Частичное совпадение по базовому имени
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
   * Генерация слоя наложения текста для конкретного файла изображения
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

    // Координаты из overlayData.images
    const imgBoxes = imagesData[imageKey] || imagesData[strippedKey] || imagesData[`Image/${strippedKey}`] || [];

    blocks.forEach((blockText, idx) => {
      const blockDataKey1 = `${imageKey}_block_${idx}`;
      const blockDataKey2 = `${strippedKey}_block_${idx}`;
      const bSettings = dialogData[blockDataKey1] || dialogData[blockDataKey2] || {};
      const directEntryMeta = entriesMeta[blockDataKey1] || entriesMeta[blockDataKey2] || {};

      // Позиция: из imagesData, entriesMeta или дефолтная
      const imgBox = imgBoxes[idx] || {};
      const x = imgBox.x !== undefined ? imgBox.x : (directEntryMeta.x !== undefined ? directEntryMeta.x : 12);
      const y = imgBox.y !== undefined ? imgBox.y : (directEntryMeta.y !== undefined ? directEntryMeta.y : (68 + idx * 8));
      const w = imgBox.w !== undefined ? imgBox.w : (directEntryMeta.w !== undefined ? directEntryMeta.w : 76);

      // Пресет оформления
      const presetName = bSettings.preset || imgBox.preset || directEntryMeta.preset;
      const preset = presets.find(p => p.name === presetName) || {};

      // Рамка (borderIndex)
      const borderIdx = bSettings.borderIndex !== undefined ? bSettings.borderIndex : (directEntryMeta.borderIndex);

      const box = document.createElement('div');
      box.className = 'reader-text-box';
      box.style.left = `${Math.min(90, Math.max(0, x))}%`;
      box.style.top = `${Math.min(90, Math.max(0, y))}%`;
      box.style.width = `${Math.min(95, Math.max(20, w))}%`;

      // Применение стилей пресета
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

      // Если используется графическая рамка диалога
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
