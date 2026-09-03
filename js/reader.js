/**
 * Reader — Интерактивная читалка визуальных новелл и манги
 * 
 * Полное соответствие оригинальному движку "Overlaying text on graphics":
 * 1. Строгий порядок страниц из скрипта:
 *    Страницы формируются напрямую из entries скрипта (Титульный экран -> Карточки героинь -> Сцены истории).
 * 2. Фильтрация папок:
 *    Загружаются картинки только из указанных в скрипте папок (allowedSubfolders, например "Image", "キャラ紹介").
 *    Лишние и дублирующие папки (например "ImageM") полностью игнорируются.
 * 3. Наложение рамок диалогов и слоев графики:
 *    - Внутренние рамки персонажей (Clean Frame, например "Рамка 5" на карточках Хасами, Юн и др.)
 *    - Металлические рамки новелл (Рамка 1 - Рамка 4) внизу экрана с динамической нарезкой портретов говорящих (Таюн, Момимоми и др.)
 *    - Пошаговое переключение реплик персонажей внутри одной сцены по клику или стрелкам
 *    - Наложенные слои текста (Canvas overlays)
 * 4. Ленивая распаковка (On-Demand Extraction):
 *    Мгновенная работа с архивами любого размера без переполнения памяти браузера.
 */
class ReaderService {
  constructor(store, scriptParser) {
    this.store = store;
    this.parser = scriptParser || new ScriptParser();
    this.currentWork = null;
    this.isFullMode = false;
    this.pages = []; // Массив страниц, строго заданный скриптом
    this.currentIndex = 0;
    this.currentDialogBlockIndex = 0;
    this.isTwoPageSpread = false;
    this.parsedScript = null;
    this.currentLang = 'Русский';
    this.workArchives = {}; // workId -> { rawFiles, loadedAt }
    this.fileMap = new Map(); // нормализованные имена -> { zipEntry, file, name }
    this.activeBlobPages = []; // LRU кэш Blob URL
    this.portraitCache = new Map(); // name -> dataURL
  }

  /**
   * Разрешение URL для рамки по номеру или имени
   */
  getBorderUrl(nameOrIndex) {
    if (nameOrIndex === undefined || nameOrIndex === null) {
      return 'assets/borders/Рамка 1.png';
    }
    if (typeof nameOrIndex === 'number') {
      const idx = nameOrIndex + 1;
      if (idx === 2) return 'assets/borders/рамка 2.png';
      return `assets/borders/Рамка ${idx}.png`;
    }
    const str = String(nameOrIndex).toLowerCase();
    if (str.includes('5')) return 'assets/borders/Рамка 5.png';
    if (str.includes('4')) return 'assets/borders/Рамка 4.png';
    if (str.includes('3')) return 'assets/borders/Рамка 3.png';
    if (str.includes('2')) return 'assets/borders/рамка 2.png';
    return 'assets/borders/Рамка 1.png';
  }

  /**
   * Открытие бесплатного превью работы
   */
  openPreview(workId) {
    const work = this.store.getWorkById(workId);
    if (!work) return;

    this.currentWork = work;
    this.isFullMode = false;
    this.parseWorkScript(work);

    if (this.workArchives[workId]) {
      this.rebuildPagesFromScript();
      this.currentIndex = 0;
      this.currentDialogBlockIndex = 0;
      this.renderReaderUI();
    } else {
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
    this.parseWorkScript(work);

    if (this.workArchives[workId]) {
      this.rebuildPagesFromScript();
      this.currentIndex = 0;
      this.currentDialogBlockIndex = 0;
      this.renderReaderUI();
    } else {
      window.app.showArchiveUploadModal(work, 'full');
    }
  }

  parseWorkScript(work) {
    if (work && work.sampleScriptText) {
      try {
        this.parsedScript = this.parser.parse(work.sampleScriptText);
      } catch (e) {
        console.error('Ошибка парсинга скрипта работы:', e);
      }
    }
  }

  /**
   * Разблокировка прямо из читалки после оплаты
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
   * Индексация ZIP-архива с фильтрацией по разрешенным папкам из скрипта
   */
  async loadUserZipFile(file) {
    if (!window.JSZip) {
      throw new Error('Библиотека JSZip не загружена');
    }

    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(file);
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

    // Разрешенные папки из скрипта (например: ["image", "キャラ紹介"])
    const allowed = (this.parsedScript && this.parsedScript.allowedSubfolders && this.parsedScript.allowedSubfolders.length > 0)
      ? this.parsedScript.allowedSubfolders.map(s => s.toLowerCase().replace(/\\/g, '/').trim())
      : null;

    this.fileMap.clear();
    const rawFiles = [];

    loadedZip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return;
      const lower = relativePath.toLowerCase().replace(/\\/g, '/');
      if (!imageExtensions.some(ext => lower.endsWith(ext))) return;

      const parts = lower.split('/').filter(Boolean);
      const isRoot = parts.length === 1;
      const firstFolder = parts.length > 1 ? parts[0] : '';

      // Строгая фильтрация: берем файлы из корня ИЛИ из указанных в скрипте папок.
      // Неизвестные папки (например "imagem") отсекаются!
      if (allowed) {
        const isAllowedFolder = allowed.some(a => firstFolder === a || lower.startsWith(a + '/'));
        if (!isRoot && !isAllowedFolder) {
          return;
        }
      }

      const fileDesc = {
        name: zipEntry.name,
        path: relativePath.replace(/\\/g, '/'),
        zipEntry: zipEntry,
        file: null
      };

      rawFiles.push(fileDesc);
      this.registerFileInMap(fileDesc);
    });

    if (rawFiles.length === 0) {
      throw new Error('В архиве не найдено изображений из указанных в скрипте папок');
    }

    if (this.currentWork) {
      this.workArchives[this.currentWork.id] = { rawFiles };
    }

    this.initPagesSequence();
  }

  /**
   * Загрузка папки (через webkitdirectory) с фильтрацией разрешенных папок
   */
  async loadUserFolder(files) {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
    const allowed = (this.parsedScript && this.parsedScript.allowedSubfolders && this.parsedScript.allowedSubfolders.length > 0)
      ? this.parsedScript.allowedSubfolders.map(s => s.toLowerCase().replace(/\\/g, '/').trim())
      : null;

    this.fileMap.clear();
    const rawFiles = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
      const lower = relPath.toLowerCase();
      if (!imageExtensions.some(ext => lower.endsWith(ext))) continue;

      const parts = lower.split('/').filter(Boolean);
      // Если относительный путь включает имя корневой папки выбора (Folder/Image/00-00.jpg),
      // проверяем подпапки
      let subParts = parts;
      if (parts.length >= 2) {
        subParts = parts.slice(1);
      }
      const isRoot = subParts.length === 1;
      const firstFolder = subParts.length > 1 ? subParts[0] : '';

      if (allowed) {
        const isAllowedFolder = allowed.some(a => firstFolder === a || subParts.join('/').startsWith(a + '/'));
        if (!isRoot && !isAllowedFolder) {
          continue;
        }
      }

      const fileDesc = {
        name: file.name,
        path: relPath,
        zipEntry: null,
        file: file
      };

      rawFiles.push(fileDesc);
      this.registerFileInMap(fileDesc);
    }

    if (rawFiles.length === 0) {
      throw new Error('В выбранной папке не найдено изображений из указанных в скрипте папок');
    }

    if (this.currentWork) {
      this.workArchives[this.currentWork.id] = { rawFiles };
    }

    this.initPagesSequence();
  }

  /**
   * Регистрация вариантов путей в fileMap для быстрого поиска
   */
  registerFileInMap(fileDesc) {
    const norm = fileDesc.path.replace(/\\/g, '/').toLowerCase();
    const base = fileDesc.name.replace(/\.[^/.]+$/, '').toLowerCase();
    const baseWithExt = fileDesc.name.toLowerCase();

    this.fileMap.set(norm, fileDesc);
    this.fileMap.set(base, fileDesc);
    this.fileMap.set(baseWithExt, fileDesc);

    const parts = norm.split('/');
    if (parts.length >= 2) {
      const sub = parts.slice(1).join('/');
      this.fileMap.set(sub, fileDesc);
      this.fileMap.set(sub.replace(/\.[^/.]+$/, ''), fileDesc);
    }
  }

  /**
   * Поиск файла графики для записи скрипта с учетом подпапки и алиасов
   */
  resolveFileForTarget(targetKey, subfolder = '') {
    if (!targetKey) return null;
    const cleanTarget = targetKey.replace(/\\/g, '/').trim();
    const cleanTargetLower = cleanTarget.toLowerCase();
    const baseTarget = cleanTarget.split('/').pop().replace(/\.[^/.]+$/, '').toLowerCase();
    const subLower = (subfolder || '').replace(/\\/g, '/').toLowerCase().trim();

    // 1. Точное совпадение с subfolder/target
    if (subLower) {
      const combined = `${subLower}/${baseTarget}`;
      if (this.fileMap.has(combined)) return this.fileMap.get(combined);
      for (const [k, v] of this.fileMap.entries()) {
        if (k.endsWith(combined) || k.endsWith(combined + '.jpg') || k.endsWith(combined + '.png')) {
          return v;
        }
      }
    }

    // 2. Прямое совпадение targetKey
    if (this.fileMap.has(cleanTargetLower)) return this.fileMap.get(cleanTargetLower);
    if (this.fileMap.has(baseTarget)) return this.fileMap.get(baseTarget);

    // 3. Поиск по базовому имени файла
    for (const [k, v] of this.fileMap.entries()) {
      const kBase = k.split('/').pop().replace(/\.[^/.]+$/, '');
      if (kBase === baseTarget) return v;
    }

    return null;
  }

  /**
   * Инициализация последовательности страниц СТРОГО по порядку записей в скрипте
   */
  initPagesSequence() {
    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (this.currentWork ? this.currentWork.availableLanguages : ['Русский', 'English']);

    window.app.showLanguageSelectModal(availableLangs, (selectedLang) => {
      this.currentLang = selectedLang;
      this.rebuildPagesFromScript();
      this.currentIndex = 0;
      this.currentDialogBlockIndex = 0;
      this.renderReaderUI();
    });
  }

  /**
   * Формирование массива страниц из entries скрипта для выбранного языка
   */
  rebuildPagesFromScript() {
    const isPreview = !this.isFullMode;
    const previewLimit = this.currentWork ? (this.currentWork.previewPagesCount || 3) : 3;

    let entries = [];
    if (this.parsedScript && this.parsedScript.entries) {
      entries = this.parsedScript.entries[this.currentLang]
        || this.parsedScript.entries['RUS']
        || this.parsedScript.entries['ENG']
        || Object.values(this.parsedScript.entries)[0]
        || [];
    }

    if (entries.length === 0) {
      // Запасной вариант, если скрипт пуст
      const rawList = Array.from(new Set(this.fileMap.values()));
      this.pages = rawList.map((rf, idx) => ({
        index: idx,
        key: rf.name,
        targetKey: rf.name,
        name: rf.name,
        entry: { key: rf.name, text: '' },
        rawFile: rf,
        url: null,
        isLocked: isPreview && (idx >= previewLimit)
      }));
      return;
    }

    // СТРОГО соблюдаем порядок скрипта: Title -> Карточки героинь -> Сцены истории
    this.pages = entries.map((entry, idx) => {
      const targetKey = entry.targetKey || entry.key;
      const rawFile = this.resolveFileForTarget(targetKey, entry.subfolder);

      return {
        index: idx,
        key: entry.key,
        targetKey: targetKey,
        subfolder: entry.subfolder || '',
        name: entry.filename || entry.key,
        entry: entry,
        rawFile: rawFile,
        url: null,
        isLocked: isPreview && (idx >= previewLimit)
      };
    });
  }

  /**
   * Демо-сцены
   */
  loadDemoImages() {
    const work = this.currentWork;
    const isPreview = !this.isFullMode;
    const previewLimit = work ? (work.previewPagesCount || 3) : 3;

    this.pages = [
      { index: 0, key: 'Title', name: 'Title', entry: { key: 'Title', text: '挟乳海岸\nДемонстрационный режим' }, url: 'assets/demo/page-1.svg', isLocked: false },
      { index: 1, key: '01_ChichibuHasami', name: '01_ChichibuHasami', entry: { key: '01_ChichibuHasami', text: 'Титибу Хасами\nДемо-описание' }, url: 'assets/demo/page-2.svg', isLocked: false },
      { index: 2, key: '00-00', name: '00-00', entry: { key: '00-00', text: '(Таюн) Демонстрационная сцена!' }, url: 'assets/demo/page-3.svg', isLocked: false },
      { index: 3, key: '01-00', name: '01-00', entry: { key: '01-00', text: 'Заблокированная страница' }, url: 'assets/demo/cover-1.svg', isLocked: isPreview && (3 >= previewLimit) }
    ];

    this.currentIndex = 0;
    this.currentDialogBlockIndex = 0;
    this.renderReaderUI();
  }

  /**
   * Разрешение Blob URL для сырого файла
   */
  async resolveRawFileUrl(rawFile) {
    if (!rawFile) return '';
    if (rawFile.url) return rawFile.url;

    if (rawFile.file) {
      rawFile.url = URL.createObjectURL(rawFile.file);
      return rawFile.url;
    }

    if (rawFile.zipEntry) {
      const blob = await rawFile.zipEntry.async('blob');
      rawFile.url = URL.createObjectURL(blob);
      this.trackLoadedBlob(rawFile);
      return rawFile.url;
    }

    return '';
  }

  trackLoadedBlob(rawFile) {
    this.activeBlobPages.push(rawFile);
    if (this.activeBlobPages.length > 15) {
      const oldest = this.activeBlobPages.shift();
      if (oldest.url && !oldest.file) {
        URL.revokeObjectURL(oldest.url);
        oldest.url = null;
      }
    }
  }

  /**
   * Динамическая нарезка портрета персонажа с холста сцены
   */
  async getPortraitUrl(portrait) {
    if (!portrait) return null;
    if (portrait.dataURL) return portrait.dataURL;

    const cacheKey = portrait.name;
    if (this.portraitCache.has(cacheKey)) {
      return this.portraitCache.get(cacheKey);
    }

    const srcKey = portrait.sourceImage || '';
    const srcFile = this.resolveFileForTarget(srcKey);
    if (!srcFile || !portrait.crop) return null;

    try {
      const srcUrl = await this.resolveRawFileUrl(srcFile);
      const dataUrl = await this.cropImageToDataUrl(srcUrl, portrait.crop);
      if (dataUrl) {
        this.portraitCache.set(cacheKey, dataUrl);
        return dataUrl;
      }
    } catch (e) {
      console.warn('Ошибка нарезки портрета:', portrait.name, e);
    }
    return null;
  }

  cropImageToDataUrl(imgSrc, crop) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let sx, sy, sw, sh;
        if (crop.unit === '%' || (crop.x <= 1 && crop.y <= 1 && crop.w <= 1 && crop.h <= 1)) {
          sx = Math.round(crop.x * img.naturalWidth);
          sy = Math.round(crop.y * img.naturalHeight);
          sw = Math.round(crop.w * img.naturalWidth);
          sh = Math.round(crop.h * img.naturalHeight);
        } else if (crop.unit === 'percent' || (crop.isPercent && crop.w <= 100)) {
          sx = Math.round((crop.x / 100) * img.naturalWidth);
          sy = Math.round((crop.y / 100) * img.naturalHeight);
          sw = Math.round((crop.w / 100) * img.naturalWidth);
          sh = Math.round((crop.h / 100) * img.naturalHeight);
        } else {
          sx = Math.max(0, Math.round(crop.x));
          sy = Math.max(0, Math.round(crop.y));
          sw = Math.min(img.naturalWidth - sx, Math.round(crop.w));
          sh = Math.min(img.naturalHeight - sy, Math.round(crop.h));
        }

        if (sw <= 0 || sh <= 0) {
          resolve(null);
          return;
        }

        const cvs = document.createElement('canvas');
        cvs.width = sw;
        cvs.height = sh;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(cvs.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = imgSrc;
    });
  }

  setLanguage(lang) {
    this.currentLang = lang;
    this.rebuildPagesFromScript();
    this.updateReaderDisplay();
  }

  toggleSpread() {
    this.isTwoPageSpread = !this.isTwoPageSpread;
    this.updateReaderDisplay();
  }

  /**
   * Переход вперед: если в текущей сцене есть ещё реплики диалога, шагаем по ним!
   */
  nextPage() {
    const curPage = this.pages[this.currentIndex];
    if (curPage && !curPage.isLocked) {
      const blocks = ScriptParser.getBlocks((curPage.entry && curPage.entry.text) || '');
      if (blocks.length > 1 && this.currentDialogBlockIndex < blocks.length - 1) {
        this.currentDialogBlockIndex++;
        this.updateReaderDisplay();
        return;
      }
    }

    const step = this.isTwoPageSpread ? 2 : 1;
    if (this.currentIndex + step < this.pages.length) {
      this.currentIndex += step;
      this.currentDialogBlockIndex = 0;
      this.updateReaderDisplay();
    }
  }

  /**
   * Переход назад: к предыдущей реплике диалога или предыдущей сцене
   */
  prevPage() {
    if (this.currentDialogBlockIndex > 0) {
      this.currentDialogBlockIndex--;
      this.updateReaderDisplay();
      return;
    }

    const step = this.isTwoPageSpread ? 2 : 1;
    if (this.currentIndex - step >= 0) {
      this.currentIndex -= step;
      const prevPage = this.pages[this.currentIndex];
      const blocks = prevPage ? ScriptParser.getBlocks((prevPage.entry && prevPage.entry.text) || '') : [];
      this.currentDialogBlockIndex = Math.max(0, blocks.length - 1);
      this.updateReaderDisplay();
    }
  }

  goToPage(index) {
    if (index >= 0 && index < this.pages.length) {
      this.currentIndex = index;
      this.currentDialogBlockIndex = 0;
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
    this.renderPageToStage(stageLeft, leftPage, this.currentDialogBlockIndex);

    // Правая страница (при 2-страничном режиме)
    if (this.isTwoPageSpread && this.currentIndex + 1 < this.pages.length) {
      stageRight.style.display = 'flex';
      const rightPage = this.pages[this.currentIndex + 1];
      this.renderPageToStage(stageRight, rightPage, 0);
    } else {
      stageRight.style.display = 'none';
      stageRight.innerHTML = '';
    }
  }

  /**
   * Полноценный визуальный рендер страницы в стиле Visual Novel
   */
  async renderPageToStage(container, page, dialogBlockIdx = 0) {
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

    // Контейнер сцены в формате DOM Visual Novel
    const domBox = document.createElement('div');
    domBox.className = 'dialog-dom-container';

    const sceneWrapper = document.createElement('div');
    sceneWrapper.className = 'dialog-scene-wrapper';

    const sceneStage = document.createElement('div');
    sceneStage.className = 'dialog-scene-stage';

    const baseImg = document.createElement('img');
    baseImg.className = 'reader-base-image';
    baseImg.alt = page.name || page.key;

    // Ленивое получение URL сцены
    if (!page.url && page.rawFile) {
      const spinner = document.createElement('div');
      spinner.className = 'page-loading-spinner';
      spinner.innerHTML = `<div class="spinner-orb">⏳</div><p style="font-size: 0.9rem; color: var(--text-muted);">Загрузка сцены...</p>`;
      sceneStage.appendChild(spinner);
      sceneWrapper.appendChild(sceneStage);
      domBox.appendChild(sceneWrapper);
      container.appendChild(domBox);

      try {
        page.url = await this.resolveRawFileUrl(page.rawFile);
        if (spinner.parentNode) spinner.remove();
        baseImg.src = page.url;
        sceneStage.appendChild(baseImg);
      } catch (err) {
        if (spinner.parentNode) spinner.innerHTML = `❌ <span style="color: var(--accent-danger);">Ошибка: ${err.message}</span>`;
        return;
      }
    } else {
      baseImg.src = page.url || '';
      sceneStage.appendChild(baseImg);
      sceneWrapper.appendChild(sceneStage);
      domBox.appendChild(sceneWrapper);
      container.appendChild(domBox);
    }

    const overlayData = (this.parsedScript && this.parsedScript.overlayData) || {};
    const presets = overlayData.presets || [];
    const frames = overlayData.frames || {};
    const dialogData = overlayData.dialogData || {};
    const portraits = overlayData.portraits || [];
    const imagesData = overlayData.images || {};

    const cleanBase = (page.key || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');
    const fData = frames[page.key] || frames[cleanBase] || frames[`Image/${cleanBase}`] || frames[page.targetKey];

    const rawText = (page.entry && page.entry.text) || '';
    const blocks = ScriptParser.getBlocks(rawText);

    // =========================================================================
    // 1. Внутренняя рамка персонажа (Clean Frame, например Рамка 5 на карточках)
    // =========================================================================
    if (fData && fData.image) {
      const frameImg = document.createElement('img');
      frameImg.className = 'clean-frame-img';
      frameImg.src = this.getBorderUrl(fData.image);

      const posX = fData.x !== undefined ? fData.x : 50;
      const posY = fData.y !== undefined ? fData.y : -0.4;
      const scale = (fData.scale !== undefined ? fData.scale : 100) / 100;
      const opacity = (fData.opacity !== undefined ? fData.opacity : 100) / 100;

      // Ширина рамки относительно сцены (32% по умолчанию для Рамки 5)
      const widthPercent = (32 * scale).toFixed(1);

      frameImg.style.left = `${posX}%`;
      frameImg.style.top = `${posY}%`;
      frameImg.style.width = `${widthPercent}%`;
      frameImg.style.height = '100%';
      frameImg.style.opacity = opacity;
      sceneStage.appendChild(frameImg);

      // Слот текста внутри чистой рамки персонажа
      const tz = fData.textZone || { x: 5.2, y: 3.6, w: 89.9, h: 93 };
      const textSlot = document.createElement('div');
      textSlot.className = 'clean-frame-text-slot';
      textSlot.style.left = `${posX + (tz.x / 100) * parseFloat(widthPercent)}%`;
      textSlot.style.top = `${posY + (tz.y / 100) * 100}%`;
      textSlot.style.width = `${(tz.w / 100) * parseFloat(widthPercent)}%`;
      textSlot.style.height = `${(tz.h / 100) * 100}%`;

      const content = document.createElement('div');
      content.className = 'clean-frame-text-content';

      // Форматируем текст описания персонажа
      const joinedTexts = blocks.map(b => ScriptParser.stripComments(b)).filter(Boolean).join('\n\n');
      content.textContent = joinedTexts;

      const firstPreset = presets.find(p => p.name === '_style_1' || p.name.startsWith('_style')) || presets[0] || {};
      content.style.color = firstPreset.color || '#ffffff';
      content.style.fontSize = firstPreset.fontSize ? `${Math.max(14, firstPreset.fontSize * 0.75)}px` : '16px';
      content.style.fontFamily = firstPreset.fontFamily || 'Arial, sans-serif';
      content.style.textAlign = firstPreset.textAlign || 'center';
      if (firstPreset.strokeWidth > 0) {
        content.style.textShadow = `-${firstPreset.strokeWidth}px -${firstPreset.strokeWidth}px 0 ${firstPreset.strokeColor || '#000'}, ${firstPreset.strokeWidth}px ${firstPreset.strokeWidth}px 0 ${firstPreset.strokeColor || '#000'}`;
      }

      textSlot.appendChild(content);
      sceneStage.appendChild(textSlot);
    } 
    // =========================================================================
    // 2. Нижняя диалоговая рамка Visual Novel (Рамка 1 .. Рамка 4)
    // =========================================================================
    else if (blocks.length > 0) {
      const safeBlockIdx = Math.max(0, Math.min(dialogBlockIdx, blocks.length - 1));
      const activeRawBlock = blocks[safeBlockIdx] || '';
      const cleanBlockText = ScriptParser.stripComments(activeRawBlock);

      // Распознавание имени говорящего персонажа: (Таюн), (Хасами) и т.д.
      const charMatch = cleanBlockText.match(/^[\(（【]([^)）】]+)[\)）】]/);
      let charName = charMatch ? charMatch[1].trim() : '';
      let speechText = charMatch ? cleanBlockText.replace(/^[\(（【][^)）】]+[\)）】]\s*/, '') : cleanBlockText;

      const bKey1 = `${page.key}_block_${safeBlockIdx}`;
      const bKey2 = `${cleanBase}_block_${safeBlockIdx}`;
      const bSettings = dialogData[bKey1] || dialogData[bKey2] || {};

      const defBorderIdx = charName ? 0 : 3;
      const borderIdx = bSettings.borderIndex !== undefined ? bSettings.borderIndex : defBorderIdx;
      const presetName = bSettings.preset;
      const preset = presets.find(p => p.name === presetName) || {};

      const frameWrapper = document.createElement('div');
      frameWrapper.className = 'dialog-frame-wrapper';

      // Клик по диалоговой рамке переключает на следующую реплику
      frameWrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        this.nextPage();
      });

      // Белая подложка
      const bgSlot = document.createElement('div');
      bgSlot.className = 'dialog-bg-slot';
      if (borderIdx === 0) {
        bgSlot.style.left = '17.5%'; bgSlot.style.top = '0.5%'; bgSlot.style.width = '82.3%'; bgSlot.style.height = '99%';
      } else {
        bgSlot.style.left = '0.8%'; bgSlot.style.top = '2%'; bgSlot.style.width = '98.4%'; bgSlot.style.height = '96%';
      }
      frameWrapper.appendChild(bgSlot);

      // Слот портрета говорящего персонажа (слева при Рамке 1)
      const portraitSlot = document.createElement('div');
      portraitSlot.className = 'dialog-portrait-slot portrait-1';
      portraitSlot.style.left = '0.2%';
      portraitSlot.style.width = '18.0%';

      const portraitImg = document.createElement('img');
      portraitImg.alt = charName;

      let portraitObj = null;
      if (bSettings.portraitName) {
        portraitObj = portraits.find(p => p.name === bSettings.portraitName);
      } else if (charName) {
        // Автопоиск подходящего портрета по имени говорящего и сцене
        portraitObj = portraits.find(p => {
          const pLower = p.name.toLowerCase();
          const cLower = charName.toLowerCase();
          return pLower.includes(cLower) && (pLower.includes(cleanBase.toLowerCase()) || p.sourceImage.toLowerCase().includes(cleanBase.toLowerCase()));
        }) || portraits.find(p => p.name.toLowerCase().includes(charName.toLowerCase()));
      }

      if (portraitObj && borderIdx === 0) {
        this.getPortraitUrl(portraitObj).then(url => {
          if (url) {
            portraitImg.src = url;
            portraitSlot.classList.remove('hidden');
          }
        });
        portraitSlot.appendChild(portraitImg);
        frameWrapper.appendChild(portraitSlot);
      } else {
        portraitSlot.classList.add('hidden');
      }

      // Металлическая рамка (Рамка 1 или Рамка 4)
      const frameBorderImg = document.createElement('img');
      frameBorderImg.className = 'dialog-frame-img';
      frameBorderImg.src = this.getBorderUrl(borderIdx);
      frameWrapper.appendChild(frameBorderImg);

      // Текстовый слот диалога
      const textSlot = document.createElement('div');
      textSlot.className = 'dialog-text-slot';
      if (borderIdx === 0) {
        textSlot.style.left = '18.5%'; textSlot.style.top = '5.0%'; textSlot.style.width = '79.5%'; textSlot.style.height = '84.0%';
      } else {
        textSlot.style.left = '1.8%'; textSlot.style.top = '5.0%'; textSlot.style.width = '96.4%'; textSlot.style.height = '85.0%';
      }

      const textContent = document.createElement('div');
      textContent.className = 'dialog-text-content';

      // Выделение имени говорящего жирным шрифтом в начале реплики
      if (charName) {
        textContent.innerHTML = `<span style="color: var(--accent-gold); font-weight: 700; margin-right: 6px;">${charName}:</span> ${speechText}`;
      } else {
        textContent.textContent = speechText;
      }

      textContent.style.fontFamily = preset.fontFamily || 'Arial, sans-serif';
      textContent.style.fontSize = preset.fontSize ? `${preset.fontSize}px` : '22px';
      textContent.style.lineHeight = preset.lineHeight || 1.4;
      textContent.style.color = preset.color || '#000000';
      textContent.style.textAlign = preset.textAlign || 'left';

      if (preset.strokeWidth > 0) {
        textContent.style.webkitTextStroke = `${preset.strokeWidth}px ${preset.strokeColor || '#ffffff'}`;
      }

      textSlot.appendChild(textContent);
      frameWrapper.appendChild(textSlot);

      // Индикатор многостраничного диалога [1/5 ▾]
      if (blocks.length > 1) {
        const indicator = document.createElement('div');
        indicator.className = 'dialog-step-indicator';
        indicator.textContent = `${safeBlockIdx + 1} / ${blocks.length} ▾`;
        frameWrapper.appendChild(indicator);
      }

      domBox.appendChild(frameWrapper);
    }

    // =========================================================================
    // 3. Наложенные слои графики (Canvas Overlay Boxes)
    // =========================================================================
    const imgBoxes = imagesData[page.key] || imagesData[cleanBase] || imagesData[`Image/${cleanBase}`] || [];
    if (imgBoxes && imgBoxes.length > 0) {
      const overlaysContainer = document.createElement('div');
      overlaysContainer.className = 'canvas-overlays-container';

      imgBoxes.forEach((box) => {
        const boxEl = document.createElement('div');
        boxEl.className = 'canvas-text-box';
        boxEl.style.left = `${box.x || 0}%`;
        boxEl.style.top = `${box.y || 0}%`;
        boxEl.style.width = `${box.w || 20}%`;
        boxEl.style.height = `${box.h || 10}%`;

        const bPreset = presets.find(p => p.name === box.preset) || {};
        if (box.text) boxEl.textContent = ScriptParser.stripComments(box.text);
        if (bPreset.color) boxEl.style.color = bPreset.color;
        if (bPreset.fontSize) boxEl.style.fontSize = `${bPreset.fontSize}px`;
        if (bPreset.fontFamily) boxEl.style.fontFamily = bPreset.fontFamily;

        overlaysContainer.appendChild(boxEl);
      });

      sceneStage.appendChild(overlaysContainer);
    }

    // Фоновая предзагрузка следующей страницы
    this.preloadNextPage();
  }

  preloadNextPage() {
    const nextIdx = this.currentIndex + (this.isTwoPageSpread ? 2 : 1);
    if (nextIdx < this.pages.length && !this.pages[nextIdx].isLocked && this.pages[nextIdx].rawFile) {
      this.resolveRawFileUrl(this.pages[nextIdx].rawFile).catch(() => {});
    }
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
