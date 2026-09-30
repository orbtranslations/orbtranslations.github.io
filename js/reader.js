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
    this.createdBlobUrls = new Set(); // Постоянные Blob URL текущей сессии (без преждевременного отзыва)
    this.portraitCache = new Map(); // name -> dataURL
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.didPan = false;
    this._eventsSetup = false;
    this.isDemoMode = false;
    this.activeDemoImages = null;
    this.resolvedUrlCache = new Map(); // shortUrl -> { imageUrl, nl, fileName, resolvedAt }
  }

  static BORDER_CONFIGS = [
    { // Рамка 1: портрет слева, текст справа
      portraitZones: [{ x: 1.4, y: 0.5, w: 15.8, h: 99.0 }],
      bgZone: { x: 19.5, y: 3.5, w: 79.5, h: 93.0 },
      textZone: { x: 20.6, y: 6.0, w: 77.2, h: 85.0 }
    },
    { // Рамка 2: текст слева, портрет справа
      portraitZones: [{ x: 82.8, y: 0.5, w: 15.8, h: 99.0 }],
      bgZone: { x: 0.8, y: 3.5, w: 79.5, h: 93.0 },
      textZone: { x: 2.0, y: 6.0, w: 77.0, h: 85.0 }
    },
    { // Рамка 3: портреты слева и справа, текст в центре
      portraitZones: [
        { x: 1.4, y: 0.5, w: 15.8, h: 99.0 },
        { x: 82.8, y: 0.5, w: 15.8, h: 99.0 }
      ],
      bgZone: { x: 19.0, y: 3.5, w: 61.5, h: 93.0 },
      textZone: { x: 20.6, y: 6.0, w: 58.8, h: 85.0 }
    },
    { // Рамка 4: без портретов, сплошной текст по всей ширине
      portraitZones: [],
      bgZone: { x: 0.8, y: 3.5, w: 98.4, h: 93.0 },
      textZone: { x: 2.0, y: 6.8, w: 96.0, h: 84.5 }
    }
  ];

  /**
   * Нормализует список портретов (преобразует словарь или массив в единый массив объектов)
   */
  normalizePortraits(portraits) {
    if (!portraits) return [];
    if (Array.isArray(portraits)) {
      return portraits.filter(Boolean).map(p => ({
        ...p,
        name: p.name || ''
      }));
    }
    if (typeof portraits === 'object') {
      return Object.entries(portraits).map(([key, val]) => {
        if (!val || typeof val !== 'object') return null;
        return {
          ...val,
          name: val.name || key
        };
      }).filter(Boolean);
    }
    return [];
  }

  /**
   * Нормализует список пресетов текста (преобразует словарь или массив в единый массив объектов)
   */
  normalizePresets(presets) {
    if (!presets) return [];
    if (Array.isArray(presets)) {
      return presets.filter(Boolean);
    }
    if (typeof presets === 'object') {
      return Object.entries(presets).map(([key, val]) => {
        if (!val || typeof val !== 'object') return null;
        return {
          ...val,
          name: val.name || key
        };
      }).filter(Boolean);
    }
    return [];
  }

  /**
   * Поиск наиболее подходящего портрета с поддержкой русских и английских алиасов
   */
  findBestPortrait(rawPortraits, charName, sceneKey, explicitName = '') {
    const portraits = this.normalizePortraits(rawPortraits);
    if (!portraits || portraits.length === 0) return null;

    // 1. Точное или частичное совпадение по явному имени из dialogData
    if (explicitName) {
      const expClean = explicitName.toLowerCase().trim();
      const exact = portraits.find(p => p && p.name && p.name.toLowerCase() === expClean);
      if (exact) return exact;
      const partial = portraits.find(p => p && p.name && p.name.toLowerCase().includes(expClean));
      if (partial) return partial;
    }

    if (!charName) return null;

    const cLower = charName.toLowerCase().trim();
    const cleanScene = (sceneKey || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').replace(/__occ\d+$/, '').toLowerCase();
    const sceneMatch = cleanScene.match(/^([a-z]*\d+)[-](\d+|[a-z]+)/);
    const sceneNum = sceneMatch ? sceneMatch[1] : cleanScene;

    // Таблица алиасов имен для сопоставления английских и русских вариантов
    const aliases = {
      // Vol 1
      'hasami': ['хасами', 'hasami', 'chichibu'],
      'хасами': ['хасами', 'hasami', 'chichibu'],
      'tayun': ['таюн', 'tayun', 'комунэ', 'komune', 'yun'],
      'таюн': ['таюн', 'tayun', 'комунэ', 'komune', 'yun'],
      'yuurin': ['юрин', 'yuurin', 'yurin', 'никё', 'nikyou'],
      'yurin': ['юрин', 'yuurin', 'yurin', 'никё', 'nikyou'],
      'юрин': ['юрин', 'yuurin', 'yurin', 'никё', 'nikyou'],
      // Vol 2
      'momimomi': ['момимоми', 'momimomi', 'оомомо', 'oomomo', 'мимоми', 'mimomi'],
      'момимоми': ['момимоми', 'momimomi', 'оомомо', 'oomomo', 'мимоми', 'mimomi'],
      'kureha': ['куреха', 'kureha', 'идзури', 'izuri'],
      'куреха': ['куреха', 'kureha', 'идзури', 'izuri'],
      'kureha-sensei': ['куреха', 'kureha', 'куреха-сэнсэй', 'куреха-сенсей'],
      'куреха-сенсей': ['куреха', 'kureha', 'куреха-сэнсэй', 'куреха-сенсей'],
      // Vol 3
      'hazumi': ['хазуми', 'hazumi'],
      'хазуми': ['хазуми', 'hazumi'],
      'shidaki': ['сидаки', 'shidaki', 'сида', 'shida', 'кимихо', 'kimiho'],
      'сидаки': ['сидаки', 'shidaki', 'сида', 'shida', 'кимихо', 'kimiho'],
      'oochi': ['оочи', 'oochi', 'ochi', 'чио', 'chio'],
      'оочи': ['оочи', 'oochi', 'ochi', 'чио', 'chio'],
      // Vol 4-10+
      'ippa': ['иппа', 'ippa'],
      'иппа': ['иппа', 'ippa'],
      'ippa-sensei': ['иппа', 'ippa', 'иппа-сенсей', 'иппа-сэнсэй'],
      'иппа-сенсей': ['иппа', 'ippa', 'иппа-сенсей', 'иппа-сэнсэй'],
      'niko': ['нико', 'niko'],
      'нико': ['нико', 'niko'],
      'mako': ['мако', 'mako'],
      'мако': ['мако', 'mako'],
      'milk': ['милка', 'милк', 'milk', 'milka'],
      'милка': ['милка', 'милк', 'milk', 'milka'],
      'yuki': ['юки', 'yuki'],
      'юки': ['юки', 'yuki'],
      'horyu': ['хорю', 'horyu'],
      'хорю': ['хорю', 'horyu'],
      'chanyu': ['чаню', 'chanyu'],
      'чаню': ['чаню', 'chanyu'],
      'erochi': ['эрочи', 'erochi'],
      'эрочи': ['эрочи', 'erochi'],
      'painuki': ['пайнуки', 'painuki'],
      'пайнуки': ['пайнуки', 'painuki'],
      'boin': ['боин', 'boin'],
      'боин': ['боин', 'boin'],
      'jagu': ['джагу', 'jagu'],
      'джагу': ['джагу', 'jagu'],
      'rakku': ['ракку', 'rakku'],
      'ракку': ['ракку', 'rakku'],
      'nokka': ['нокка', 'nokka'],
      'нокка': ['нокка', 'nokka'],
      'futa': ['фута', 'futa'],
      'фута': ['фута', 'futa'],
      'barun': ['барун', 'barun'],
      'барун': ['барун', 'barun'],
      'bancho': ['банчё', 'банче', 'bancho'],
      'банчё': ['банчё', 'банче', 'bancho'],
      'sante': ['санте', 'sante'],
      'санте': ['санте', 'sante'],
      'sante-sensei': ['санте', 'sante', 'санте-сенсей'],
      'санте-сенсей': ['санте', 'sante', 'санте-сенсей'],
      'kohaku': ['кохаку', 'kohaku'],
      'кохаку': ['кохаку', 'kohaku'],
      'kohaku-sensei': ['кохаку', 'kohaku', 'кохаку-сенсей'],
      'кохаку-сенсей': ['кохаку', 'kohaku', 'кохаку-сенсей'],
      'washizuka': ['вашидзука', 'washizuka'],
      'вашидзука': ['вашидзука', 'washizuka'],
      'washizuka-sensei': ['вашидзука', 'washizuka', 'вашидзука-сенсей'],
      'вашидзука-сенсей': ['вашидзука', 'washizuka', 'вашидзука-сенсей']
    };

    const targetAliases = new Set(aliases[cLower] || [cLower]);
    const translitRu = this.transliterateEnToRu(cLower);
    if (translitRu) targetAliases.add(translitRu);
    const translitEn = this.transliterateRuToEn(cLower);
    if (translitEn) targetAliases.add(translitEn);
    const aliasArr = Array.from(targetAliases);

    // Приоритет 1: Имя + сцена (например, Хасами для сцены 10-02 -> Хасами 10-01A)
    const matchScene = portraits.find(p => {
      if (!p || !p.name) return false;
      const pLower = p.name.toLowerCase();
      const sLower = (p.sourceImage || '').toLowerCase();
      const hasChar = aliasArr.some(a => pLower.includes(a));
      const hasScene = pLower.includes(cleanScene) || sLower.includes(cleanScene) ||
                       (sceneNum && (pLower.includes(sceneNum) || sLower.includes(sceneNum)));
      return hasChar && hasScene;
    });
    if (matchScene) return matchScene;

    // Приоритет 2: Любой портрет данного персонажа
    const matchAny = portraits.find(p => {
      if (!p || !p.name) return false;
      const pLower = p.name.toLowerCase();
      return aliasArr.some(a => pLower.includes(a));
    });
    return matchAny || null;
  }

  /**
   * Нормализация ключа файла для нечувствительного сопоставления (устраняет расхождения между дефисами, подчеркиваниями и префиксами)
   */
  normalizeKeyForMatching(k) {
    if (!k) return '';
    return String(k)
      .split(/[\/\\]/).pop()
      .replace(/\.[^/.]+$/, '')
      .replace(/^[a-z]_/i, '')
      .replace(/[_\s]+/g, '-')
      .replace(/__occ\d+$/i, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Вычисление индекса повторного появления сцены с одним фоном (__occ1, __occ2)
   */
  getSceneOccurrence(pageKey, pageIndex) {
    if (!pageKey || pageIndex === undefined || pageIndex === null || pageIndex <= 0 || !this.pages || this.pages.length === 0) {
      return 0;
    }
    const cleanKey = this.normalizeKeyForMatching(pageKey);
    let occ = 0;
    for (let i = 0; i < pageIndex; i++) {
      const prevP = this.pages[i];
      if (prevP) {
        const prevClean = this.normalizeKeyForMatching(prevP.key || prevP.targetKey || prevP.name);
        if (prevClean === cleanKey) {
          occ++;
        }
      }
    }
    return occ;
  }

  /**
   * Получить список ключей кандидатов для поиска в dialogData и frames с учетом __occ
   */
  getCandidateSceneKeys(page) {
    if (!page) return [];
    const cleanBase = (page.key || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').replace(/__occ\d+$/, '');
    const cleanTarget = (page.targetKey || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').replace(/__occ\d+$/, '');

    const occ = (page.occurrence !== undefined && page.occurrence !== null)
      ? page.occurrence
      : this.getSceneOccurrence(page.key, page.index);
    const occSuffix = occ > 0 ? `__occ${occ}` : '';

    const baseKeys = [
      page.key,
      cleanBase,
      page.targetKey,
      cleanTarget,
      page.subfolder ? `${page.subfolder}/${cleanBase}` : null,
      page.subfolder ? `${page.subfolder}/${page.key}` : null,
      `Image-M/${cleanBase}`,
      `Image-M/${page.key}`,
      `Image/${cleanBase}`,
      `Image/${page.key}`
    ].filter(Boolean);

    const result = [];
    if (occSuffix) {
      baseKeys.forEach(k => {
        const cleanK = k.replace(/__occ\d+$/, '');
        result.push(`${cleanK}${occSuffix}`);
      });
    }
    baseKeys.forEach(k => {
      if (!result.includes(k)) result.push(k);
    });

    return result;
  }

  /**
   * Транслитерация с русского на английский для сопоставления персонажей
   */
  transliterateRuToEn(str) {
    if (!str) return '';
    const map = {
      'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y',
      'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
      'х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
    };
    return str.toLowerCase().split('').map(c => map[c] !== undefined ? map[c] : c).join('');
  }

  /**
   * Транслитерация с английского на русский для сопоставления персонажей
   */
  transliterateEnToRu(str) {
    if (!str) return '';
    const s = str.toLowerCase();
    const map = [
      ['shch','щ'],['zh','ж'],['ts','ц'],['ch','ч'],['sh','ш'],['ya','я'],['yu','ю'],['yo','ё'],
      ['kh','х'],['a','а'],['b','б'],['v','в'],['g','г'],['d','д'],['e','е'],['z','з'],['i','и'],
      ['y','й'],['k','к'],['l','л'],['m','м'],['n','н'],['o','о'],['p','п'],['r','р'],['s','с'],
      ['t','т'],['u','у'],['f','ф'],['h','х']
    ];
    let res = s;
    for (const [en, ru] of map) {
      res = res.split(en).join(ru);
    }
    return res;
  }

  /**
   * Определение приоритетного языка для читалки на основе текущего языка интерфейса сайта
   */
  getPriorityLanguage(availableLangs) {
    if (!availableLangs || availableLangs.length === 0) return 'Русский';
    const siteLang = (window.i18n && window.i18n.getLang()) ? window.i18n.getLang().toLowerCase() : 'ru';
    if (siteLang.startsWith('ru')) {
      const match = availableLangs.find(l => {
        const lower = l.toLowerCase();
        return lower === 'rus' || lower === 'ru' || lower.includes('рус');
      });
      if (match) return match;
    } else if (siteLang.startsWith('en')) {
      const match = availableLangs.find(l => {
        const lower = l.toLowerCase();
        return lower === 'eng' || lower === 'en' || lower.includes('eng');
      });
      if (match) return match;
    }
    return availableLangs[0];
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
   * Нормализация кода языка для сопоставления настроек оверлеев и рамок
   */
  getNormalizedLangCodes(lang) {
    if (!lang) return ['RUS', 'Русский'];
    const l = String(lang).trim();
    const lLower = l.toLowerCase();
    const codes = [l];
    if (lLower.startsWith('ru') || lLower === 'русский' || lLower === 'рус') {
      codes.push('RUS', 'RU', 'Русский');
    } else if (lLower.startsWith('en') || lLower === 'english' || lLower === 'eng') {
      codes.push('ENG', 'EN', 'English');
    }
    return [...new Set(codes)];
  }

  /**
   * Поиск настроек рамки или наложенной графики для страницы с учетом выбранного языка
   */
  getFrameForPage(page, lang) {
    const overlayData = (this.parsedScript && this.parsedScript.overlayData) || {};
    const frames = overlayData.frames || {};
    if (!page) return null;

    const cleanBase = (page.key || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');
    const cleanTarget = (page.targetKey || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');
    const isTitle = (page.entry && page.entry.isTitle) || 
                    cleanBase.toLowerCase().includes('title') || 
                    cleanTarget.toLowerCase().includes('title') ||
                    page.index === 0;

    const candidateKeys = this.getCandidateSceneKeys(page);

    if (isTitle) {
      candidateKeys.push('Title', '001_Title', '01_Title', 'title', '001_title', '01_title');
      for (const k of Object.keys(frames)) {
        const kClean = k.split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').replace(/__lang_.*$/i, '').toLowerCase();
        if (kClean.includes('title')) {
          candidateKeys.push(k, k.replace(/__lang_.*$/i, ''));
        }
      }
    }
    const langCodes = this.getNormalizedLangCodes(lang);

    // 1. Поиск по ключам с точным суффиксом языка (__lang_RUS, __lang_ENG)
    for (const key of candidateKeys) {
      for (const code of langCodes) {
        const langKey = `${key}__lang_${code}`;
        if (frames[langKey] && (frames[langKey].image || frames[langKey].customImage || (frames[langKey].layers && frames[langKey].layers.length > 0))) {
          return frames[langKey];
        }
      }
    }

    // 2. Поиск по нечувствительному к регистру суффиксу __lang_
    for (const fKey of Object.keys(frames)) {
      for (const key of candidateKeys) {
        if (fKey.toLowerCase().startsWith(`${key.toLowerCase()}__lang_`)) {
          for (const code of langCodes) {
            if (fKey.toLowerCase().endsWith(`__lang_${code.toLowerCase()}`)) {
              return frames[fKey];
            }
          }
        }
      }
    }

    // 3. Базовый поиск без языкового суффикса (например для "002_01_ChichibuHasami")
    for (const key of candidateKeys) {
      const baseFrame = frames[key];
      if (baseFrame && (baseFrame.image || baseFrame.customImage || (baseFrame.layers && baseFrame.layers.length > 0))) {
        if (baseFrame.lang && baseFrame.lang !== 'all') {
          const matches = langCodes.some(c => c.toLowerCase() === baseFrame.lang.toLowerCase());
          const layerMatches = Array.isArray(baseFrame.layers) && baseFrame.layers.some(l => {
            const lLang = l.lang || 'all';
            return lLang === 'all' || langCodes.some(c => c.toLowerCase() === lLang.toLowerCase());
          });
          if (!matches && !layerMatches) continue;
        }
        return baseFrame;
      }
    }

    // 4. Поиск в frames по чистому имени файла (без пути)
    for (const [fKey, fObj] of Object.entries(frames)) {
      const fClean = fKey.split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').toLowerCase();
      if (fClean === cleanBase.toLowerCase() || fClean === cleanTarget.toLowerCase()) {
        if (fObj && (fObj.image || fObj.customImage || (fObj.layers && fObj.layers.length > 0))) {
          if (fObj.lang && fObj.lang !== 'all') {
            const matches = langCodes.some(c => c.toLowerCase() === fObj.lang.toLowerCase());
            const layerMatches = Array.isArray(fObj.layers) && fObj.layers.some(l => {
              const lLang = l.lang || 'all';
              return lLang === 'all' || langCodes.some(c => c.toLowerCase() === lLang.toLowerCase());
            });
            if (!matches && !layerMatches) continue;
          }
          return fObj;
        }
      }
    }

    return null;
  }

  /**
   * Открытие бесплатного превью работы с автоматической проверкой сохраненного архива/папки
   */
  async openPreview(workId) {
    let work = this.store.getWorkById(workId);
    if (!work && this.store.initPromise) {
      try { await this.store.initPromise; } catch (e) {}
      work = this.store.getWorkById(workId);
    }
    if (!work) return;

    this.currentWork = work;
    this.isFullMode = false;

    // Гарантированно получаем готовый скрипт превью (разворачивая [STORED_IN_IDB] при необходимости)
    const sampleScript = await this.store.getSampleScript(workId);
    if (sampleScript && !sampleScript.startsWith('[STORED_IN_IDB')) {
      this.parseWorkScript(work, sampleScript);
    } else {
      this.parseWorkScript(work);
    }

    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (work.availableLanguages || ['Русский', 'English']);
    this.currentLang = this.getPriorityLanguage(availableLangs);

    // Проверяем наличие настроенных демо-изображений
    const hasConfiguredDemoImages = Array.isArray(work.demoImages)
      ? work.demoImages.some(item => item && item.url)
      : (work.demoImages && typeof work.demoImages === 'object' && Object.keys(work.demoImages).length > 0);

    if (this.workArchives[workId]) {
      this.isDemoMode = false;
      this.activeDemoImages = null;
      this.rebuildPagesFromScript();
      this.currentIndex = 0;
      this.currentDialogBlockIndex = 0;
      this.renderReaderUI();
      return;
    }

    // Проверяем сохраненный на клиенте архив или дескриптор папки
    const saved = await this.tryLoadSavedClientArchive(workId);
    if (saved && (saved.type === 'zip' || saved.status === 'loaded')) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      const name = saved.fileName || saved.folderName || '';
      window.app.showToast(
        isEn ? `⚡ Loaded saved graphics: ${name}` : `⚡ Загружена сохраненная графика: ${name}`,
        'info'
      );
      this.isDemoMode = false;
      this.activeDemoImages = null;
      this.rebuildPagesFromScript();
      this.currentIndex = 0;
      this.currentDialogBlockIndex = 0;
      this.renderReaderUI();
      return;
    }

    // Если локального архива нет, но настроены интернет-ссылки для превью — сразу запускаем демо-сцены!
    if (hasConfiguredDemoImages) {
      await this.loadDemoImages();
      return;
    }

    window.app.showArchiveUploadModal(work, 'preview', saved);
  }

  /**
   * Открытие купленной работы в полном режиме с автоматической проверкой сохраненного архива/папки
   */
  async openFullTranslationModal(workId) {
    let work = this.store.getWorkById(workId);
    if (!work && this.store.initPromise) {
      try { await this.store.initPromise; } catch (e) {}
      work = this.store.getWorkById(workId);
    }
    if (!work) return;

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const isPurchased = this.store.hasPurchased(workId);

    // Если не куплено и не админ — уведомляем и открываем превью
    if (!isPurchased) {
      window.app.showToast(
        isEn ? 'Please purchase this work to read the full translation' : 'Для доступа к полному переводу необходимо приобрести работу',
        'warning'
      );
      await this.openPreview(workId);
      return;
    }

    this.currentWork = work;
    this.isFullMode = true;

    // Безопасная загрузка закрытого скрипта из Supabase work_scripts (защищено RLS)
    let fullScript = await this.store.getFullScript(workId);
    if (fullScript && !fullScript.startsWith('[STORED_IN_IDB')) {
      this.parseWorkScript(work, fullScript);
    } else {
      const sampleScript = await this.store.getSampleScript(workId);
      this.parseWorkScript(work, sampleScript);
    }

    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (work.availableLanguages || ['Русский', 'English']);
    this.currentLang = this.getPriorityLanguage(availableLangs);

    if (this.workArchives[workId]) {
      this.rebuildPagesFromScript();
      const lastPage = this.getInitialPageIndexForWork(workId);
      this.currentIndex = (lastPage > 0 && lastPage < this.pages.length) ? lastPage : 0;
      this.currentDialogBlockIndex = 0;
      this.renderReaderUI();
      if (this.currentIndex > 0) {
        window.app?.showToast(
          isEn ? `📖 Resumed reading from page ${this.currentIndex + 1}` : `📖 Чтение возобновлено с ${this.currentIndex + 1} страницы`,
          'info'
        );
      }
      return;
    }

    // Проверяем сохраненный на клиенте архив или дескриптор папки
    const saved = await this.tryLoadSavedClientArchive(workId);
    if (saved && (saved.type === 'zip' || saved.status === 'loaded')) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      const name = saved.fileName || saved.folderName || '';
      window.app.showToast(
        isEn ? `⚡ Loaded saved graphics: ${name}` : `⚡ Загружена сохраненная графика: ${name}`,
        'info'
      );
      this.rebuildPagesFromScript();
      const lastPage = this.getInitialPageIndexForWork(workId);
      this.currentIndex = (lastPage > 0 && lastPage < this.pages.length) ? lastPage : 0;
      this.currentDialogBlockIndex = 0;
      this.renderReaderUI();
      if (this.currentIndex > 0) {
        window.app?.showToast(
          isEn ? `📖 Resumed reading from page ${this.currentIndex + 1}` : `📖 Чтение возобновлено с ${this.currentIndex + 1} страницы`,
          'info'
        );
      }
      return;
    }

    window.app.showArchiveUploadModal(work, 'full', saved);
  }

  /**
   * Попытка восстановить графику из локальной базы IndexedDB
   */
  async tryLoadSavedClientArchive(workId) {
    if (typeof IDBStorage === 'undefined') return null;
    try {
      const saved = await IDBStorage.getClientArchive(workId);
      if (!saved) return null;

      // 1. Сохраненный ZIP-архив (Blob)
      if (saved.type === 'zip' && saved.blob) {
        await this.loadUserZipFile(saved.blob);
        return { type: 'zip', fileName: saved.fileName, size: saved.size };
      }

      // 2. Сохраненный дескриптор папки (File System Access API)
      if (saved.type === 'dirHandle' && saved.handle) {
        let perm = 'prompt';
        try {
          perm = await saved.handle.queryPermission({ mode: 'read' });
        } catch (e) {
          perm = 'prompt';
        }

        if (perm === 'granted') {
          const files = await this.readFilesFromDirectoryHandle(saved.handle);
          await this.loadUserFolder(files);
          return { type: 'dirHandle', status: 'loaded', folderName: saved.folderName };
        } else {
          return { type: 'dirHandle', status: 'needs_permission', handle: saved.handle, folderName: saved.folderName };
        }
      }

      // 3. Сохраненный список файлов (Blob-массив для fallback-папок)
      if (saved.type === 'files' && Array.isArray(saved.files) && saved.files.length > 0) {
        const files = saved.files.map(f => {
          const file = new File([f.blob], f.name, { type: f.type || 'image/jpeg' });
          if (f.path) {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: f.path,
              writable: false
            });
          }
          return file;
        });
        await this.loadUserFolder(files);
        return { type: 'files', status: 'loaded', folderName: saved.folderName };
      }
    } catch (err) {
      console.warn('Не удалось автоматически загрузить сохраненный архив:', err);
    }
    return null;
  }

  /**
   * Рекурсивное считывание файлов из FileSystemDirectoryHandle
   */
  async readFilesFromDirectoryHandle(dirHandle) {
    const files = [];
    async function scan(handle, pathPrefix = '') {
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          const relPath = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
          Object.defineProperty(file, 'webkitRelativePath', {
            value: relPath,
            writable: false
          });
          files.push(file);
        } else if (entry.kind === 'directory') {
          const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
          await scan(entry, nextPrefix);
        }
      }
    }
    await scan(dirHandle, dirHandle.name);
    return files;
  }

  /**
   * Сменить или заново выбрать архив/папку для текущей работы
   */
  changeArchive() {
    if (!this.currentWork) return;
    const work = this.currentWork;
    const mode = this.isFullMode ? 'full' : 'preview';
    this.closeReader();
    window.app.showArchiveUploadModal(work, mode);
  }

  /**
   * Удалить сохраненную графику для работы из IndexedDB
   */
  async forgetSavedArchive(workId) {
    const targetId = workId || (this.currentWork ? this.currentWork.id : null);
    if (!targetId) return;
    if (typeof IDBStorage !== 'undefined') {
      await IDBStorage.removeClientArchive(targetId);
    }
    delete this.workArchives[targetId];
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    window.app.showToast(
      isEn ? '🗑 Saved graphics removed from this browser' : '🗑 Сохраненная графика удалена из этого браузера',
      'info'
    );
  }

  parseWorkScript(work, customScript = null) {
    const scriptToParse = customScript 
      || (this.isFullMode ? (work.fullScriptText || work.sampleScriptText) : work.sampleScriptText);

    if (scriptToParse && !scriptToParse.startsWith('[STORED_IN_IDB')) {
      try {
        this.parsedScript = this.parser.parse(scriptToParse);
      } catch (e) {
        console.error('Ошибка парсинга скрипта работы:', e);
      }
    }
  }

  /**
   * Разблокировка прямо из читалки после оплаты
   */
  async unlockFullReading() {
    this.isFullMode = true;
    if (this.currentWork) {
      const fullScript = await this.store.getFullScript(this.currentWork.id);
      if (fullScript) {
        this.parseWorkScript(this.currentWork, fullScript);
        this.rebuildPagesFromScript();
      }
    }

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
    const loadedZip = await zip.loadAsync(file, {
      decodeFileName: (bytes) => {
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (e) {
          try {
            return new TextDecoder('shift-jis').decode(bytes);
          } catch (e2) {
            return new TextDecoder('windows-1251').decode(bytes);
          }
        }
      }
    });
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
    const RAW_DIR_BLACKLIST = ['imagem', 'raw', 'raws', 'original', 'originals', 'orig', 'jp', 'japanese', 'src'];

    // Разрешенные папки из скрипта (например: ["image", "キャラ紹介"])
    const allowed = (this.parsedScript && this.parsedScript.allowedSubfolders && this.parsedScript.allowedSubfolders.length > 0)
      ? this.parsedScript.allowedSubfolders.map(s => s.toLowerCase().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim())
      : null;

    // Определяем наличие общей корневой папки-обертки в ZIP (например "挟乳海岸/Image/00-00.jpg")
    let hasRootWrapper = false;
    let detectedRootPrefix = '';
    if (allowed && allowed.length > 0) {
      let inspected = 0;
      loadedZip.forEach((relativePath, zipEntry) => {
        if (zipEntry.dir || inspected > 50) return;
        inspected++;
        const p = relativePath.toLowerCase().replace(/\\/g, '/');
        const segs = p.split('/').filter(Boolean);
        if (segs.length >= 2) {
          if (allowed.includes(segs[0])) {
            hasRootWrapper = false;
            detectedRootPrefix = '';
            inspected = 999;
          } else if (segs.length >= 3 && allowed.includes(segs[1])) {
            hasRootWrapper = true;
            detectedRootPrefix = segs[0];
          }
        }
      });
    }

    this.revokeSessionBlobs();
    this.fileMap.clear();
    const rawFiles = [];

    loadedZip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return;
      const lower = relativePath.toLowerCase().replace(/\\/g, '/');
      if (!imageExtensions.some(ext => lower.endsWith(ext))) return;

      let parts = lower.split('/').filter(Boolean);
      if (hasRootWrapper && parts.length > 1 && parts[0] === detectedRootPrefix) {
        parts = parts.slice(1);
      }

      const isRoot = parts.length === 1;
      const subfolder = parts.length > 1 ? parts[0] : '';

      // 1. Блокировка японских исходников и сырых файлов
      if (RAW_DIR_BLACKLIST.includes(subfolder)) {
        if (!allowed || !allowed.includes(subfolder)) {
          return;
        }
      }

      // 2. Строгая фильтрация по allowedSubfolders из скрипта
      if (allowed && allowed.length > 0) {
        const isAllowedFolder = allowed.includes(subfolder) || allowed.some(a => subfolder.startsWith(a + '/'));
        if (!isRoot && !isAllowedFolder) {
          return;
        }
      }

      const fileDesc = {
        name: zipEntry.name,
        path: relativePath.replace(/\\/g, '/'),
        subfolder: subfolder,
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
   * Загрузка папки (через webkitdirectory или File System Access API) с фильтрацией разрешенных папок
   */
  async loadUserFolder(files) {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
    const RAW_DIR_BLACKLIST = ['imagem', 'raw', 'raws', 'original', 'originals', 'orig', 'jp', 'japanese', 'src'];

    // Если parsedScript еще не готов, пробуем восстановить из currentWork
    if (!this.parsedScript && this.currentWork) {
      const scriptText = this.currentWork.sampleScriptText || this.currentWork.fullScriptText;
      if (scriptText && !scriptText.startsWith('[STORED_IN_IDB')) {
        try {
          this.parsedScript = this.parser.parse(scriptText);
        } catch (e) {}
      }
    }

    const allowed = (this.parsedScript && this.parsedScript.allowedSubfolders && this.parsedScript.allowedSubfolders.length > 0)
      ? this.parsedScript.allowedSubfolders.map(s => s.toLowerCase().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim())
      : null;

    // Определяем наличие общей корневой папки-обертки (например "挟乳海岸/Image/00-00.jpg" при webkitdirectory)
    let hasRootWrapper = false;
    let detectedRootPrefix = '';
    if (allowed && allowed.length > 0) {
      for (let i = 0; i < Math.min(files.length, 50); i++) {
        const p = (files[i].webkitRelativePath || files[i].name || '').replace(/\\/g, '/').toLowerCase();
        const segs = p.split('/').filter(Boolean);
        if (segs.length >= 2) {
          if (allowed.includes(segs[0])) {
            hasRootWrapper = false;
            detectedRootPrefix = '';
            break;
          }
          if (segs.length >= 3 && allowed.includes(segs[1])) {
            hasRootWrapper = true;
            detectedRootPrefix = segs[0];
          }
        }
      }
    }

    this.revokeSessionBlobs();
    this.fileMap.clear();
    const rawFiles = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
      const lower = relPath.toLowerCase();
      if (!imageExtensions.some(ext => lower.endsWith(ext))) continue;

      let parts = lower.split('/').filter(Boolean);
      if (hasRootWrapper && parts.length > 1 && parts[0] === detectedRootPrefix) {
        parts = parts.slice(1);
      }

      const isRoot = parts.length === 1;
      const subfolder = parts.length > 1 ? parts[0] : '';

      // 1. Блокировка японских исходников и сырых файлов
      if (RAW_DIR_BLACKLIST.includes(subfolder)) {
        if (!allowed || !allowed.includes(subfolder)) {
          continue;
        }
      }

      // 2. Строгая фильтрация по разрешенным папкам из скрипта
      if (allowed && allowed.length > 0) {
        const isAllowedFolder = allowed.includes(subfolder) || allowed.some(a => subfolder.startsWith(a + '/'));
        if (!isRoot && !isAllowedFolder) {
          continue;
        }
      }

      const fileDesc = {
        name: file.name,
        path: relPath,
        subfolder: subfolder,
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
    const pureName = fileDesc.name.split(/[\/\\]/).pop();
    const pureBase = pureName.replace(/\.[^/.]+$/, '').toLowerCase();
    const pureBaseWithExt = pureName.toLowerCase();
    const normNoExt = norm.replace(/\.[^/.]+$/, '');

    this.fileMap.set(norm, fileDesc);
    this.fileMap.set(normNoExt, fileDesc);

    // Варианты суффиксов путей (например "image/00-00.jpg" и "image/00-00")
    const parts = norm.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const subPath = parts.slice(i).join('/');
      this.fileMap.set(subPath, fileDesc);
      this.fileMap.set(subPath.replace(/\.[^/.]+$/, ''), fileDesc);
    }

    // Для чистого имени файла (без пути) приоритет отдается разрешенным папкам скрипта
    const allowed = (this.parsedScript && this.parsedScript.allowedSubfolders)
      ? this.parsedScript.allowedSubfolders.map(s => s.toLowerCase().trim())
      : null;
    const fileSub = (fileDesc.subfolder || '').toLowerCase();
    const isPrimary = !allowed || (fileSub && allowed.includes(fileSub));

    if (!this.fileMap.has(pureBase) || isPrimary) {
      this.fileMap.set(pureBase, fileDesc);
    }
    if (!this.fileMap.has(pureBaseWithExt) || isPrimary) {
      this.fileMap.set(pureBaseWithExt, fileDesc);
    }
  }

  /**
   * Поиск файла графики для записи скрипта с учетом подпапки и алиасов
   */
  resolveFileForTarget(targetKey, subfolder = '') {
    if (!targetKey) return null;
    const cleanTarget = targetKey.replace(/\\/g, '/').trim();
    const cleanTargetLower = cleanTarget.toLowerCase();
    const baseTarget = cleanTarget.split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').toLowerCase();
    const subLower = (subfolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase().trim();

    // 1. Точное совпадение с subfolder/target
    if (subLower) {
      const combined = `${subLower}/${baseTarget}`;
      if (this.fileMap.has(combined)) return this.fileMap.get(combined);
      if (this.fileMap.has(combined + '.jpg')) return this.fileMap.get(combined + '.jpg');
      if (this.fileMap.has(combined + '.png')) return this.fileMap.get(combined + '.png');
      if (this.fileMap.has(combined + '.webp')) return this.fileMap.get(combined + '.webp');

      for (const [k, v] of this.fileMap.entries()) {
        if (k === combined || k.endsWith('/' + combined) ||
            k === combined + '.jpg' || k.endsWith('/' + combined + '.jpg') ||
            k === combined + '.png' || k.endsWith('/' + combined + '.png') ||
            k === combined + '.webp' || k.endsWith('/' + combined + '.webp')) {
          return v;
        }
      }
    }

    // 2. Прямое совпадение targetKey
    if (this.fileMap.has(cleanTargetLower)) return this.fileMap.get(cleanTargetLower);
    const cleanTargetNoExt = cleanTargetLower.replace(/\.[^/.]+$/, '');
    if (this.fileMap.has(cleanTargetNoExt)) return this.fileMap.get(cleanTargetNoExt);

    // 3. Если указана subfolder, ищем файл, чей путь гарантированно находится в этой подпапке
    if (subLower) {
      for (const [k, v] of this.fileMap.entries()) {
        const vNorm = (v.path || '').replace(/\\/g, '/').toLowerCase();
        const vParts = vNorm.split('/').filter(Boolean);
        const hasSub = vParts.includes(subLower);
        const nameMatch = k.endsWith(baseTarget) || k.endsWith(baseTarget + '.jpg') || k.endsWith(baseTarget + '.png');
        if (hasSub && nameMatch) {
          return v;
        }
      }
    }

    // 4. Поиск по чистому имени baseTarget
    if (this.fileMap.has(baseTarget)) return this.fileMap.get(baseTarget);

    for (const [k, v] of this.fileMap.entries()) {
      const kPure = k.split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');
      if (kPure === baseTarget) return v;
    }

    return null;
  }

  /**
   * Сохранение прогресса чтения для купленной работы
   */
  saveReadingProgress(workId, pageIndex) {
    if (!workId) return;
    try {
      localStorage.setItem(`orb_reading_progress_${workId}`, String(pageIndex));
    } catch (e) {}
  }

  /**
   * Получение сохраненного прогресса чтения
   */
  getReadingProgress(workId) {
    if (!workId) return 0;
    try {
      const saved = localStorage.getItem(`orb_reading_progress_${workId}`);
      if (saved !== null) {
        const val = parseInt(saved, 10);
        return isNaN(val) ? 0 : Math.max(0, val);
      }
    } catch (e) {}
    return 0;
  }

  /**
   * Определение начальной страницы для купленной работы:
   * Первое открытие купленной работы после покупки строго начинает с 1-й страницы (индекс 0).
   * Запоминание страницы начинает работать с момента этого первого открытия.
   * Возврат к последней прочитанной странице происходит при последующих открытиях.
   */
  getInitialPageIndexForWork(workId) {
    if (!this.isFullMode || !workId) return 0;
    const hasOpenedKey = `orb_opened_after_purchase_${workId}`;
    const hasOpened = localStorage.getItem(hasOpenedKey);
    if (!hasOpened) {
      // Первое открытие купленной работы после её покупки
      localStorage.setItem(hasOpenedKey, '1');
      return 0;
    }
    // Последующее открытие купленной работы: возвращаем сохраненную страницу
    return this.getReadingProgress(workId);
  }

  /**
   * Инициализация последовательности страниц СТРОГО по порядку записей в скрипте
   */
  initPagesSequence() {
    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (this.currentWork ? this.currentWork.availableLanguages : ['Русский', 'English']);

    // При открытии читалки приоритетным является язык интерфейса сайта
    this.currentLang = this.getPriorityLanguage(availableLangs);
    this.rebuildPagesFromScript();

    if (this.isFullMode && this.currentWork) {
      const lastPage = this.getInitialPageIndexForWork(this.currentWork.id);
      if (lastPage > 0 && lastPage < this.pages.length) {
        this.currentIndex = lastPage;
        const isEn = window.i18n && window.i18n.getLang() === 'en';
        window.app?.showToast(
          isEn ? `📖 Resumed reading from page ${lastPage + 1}` : `📖 Чтение возобновлено с ${lastPage + 1} страницы`,
          'info'
        );
      } else {
        this.currentIndex = 0;
      }
    } else {
      this.currentIndex = 0;
    }

    this.currentDialogBlockIndex = 0;
    this.renderReaderUI();
  }

  /**
   * Формирование массива страниц из entries скрипта для выбранного языка
   */
  rebuildPagesFromScript() {
    const isPreview = !this.isFullMode;
    const previewLimit = this.currentWork ? (this.currentWork.previewPagesCount || 3) : 3;

    let entries = [];
    if (this.parsedScript && this.parsedScript.entries) {
      const normCodes = this.getNormalizedLangCodes(this.currentLang);
      for (const code of normCodes) {
        if (this.parsedScript.entries[code] && this.parsedScript.entries[code].length > 0) {
          entries = this.parsedScript.entries[code];
          break;
        }
      }
      if (entries.length === 0) {
        entries = this.parsedScript.entries['RUS']
          || this.parsedScript.entries['Русский']
          || this.parsedScript.entries['ENG']
          || this.parsedScript.entries['English']
          || Object.values(this.parsedScript.entries)[0]
          || [];
      }
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

    // Если активен режим демо-сцен, накладываем строгую фильтрацию только по заданным демо-ссылкам
    if (this.isDemoMode) {
      this.applyDemoPagesFilter();
    }
  }

  /**
   * Получение ссылки на демо-изображение из интернета для заданной страницы/сцены
   */
  getDemoImageUrl(work, pageIndex, pageKey = '') {
    if (!work || !work.demoImages) return null;
    const pageNum = pageIndex + 1; // 1-based номер страницы

    if (Array.isArray(work.demoImages)) {
      // 1. Поиск по точному номеру страницы (1, 2, 3...)
      const foundByNum = work.demoImages.find(item => {
        if (!item || !item.url) return false;
        const p = String(item.page !== undefined ? item.page : (item.num || '')).trim();
        return p === String(pageNum);
      });
      if (foundByNum) return foundByNum.url.trim();

      // 2. Поиск по ключу/имени сцены (Title, 00-00 и т.д.)
      if (pageKey) {
        const cleanKey = String(pageKey).split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').toLowerCase();
        const normKey = this.normalizeKeyForMatching(pageKey);
        const foundByKey = work.demoImages.find(item => {
          if (!item || !item.url) return false;
          const p = String(item.page !== undefined ? item.page : (item.key || item.name || '')).trim().toLowerCase();
          const normItem = this.normalizeKeyForMatching(p || item.url);
          return p === cleanKey || p === String(pageKey).toLowerCase() || (normKey && normItem === normKey);
        });
        if (foundByKey) return foundByKey.url.trim();
      }
      return null;
    }

    if (typeof work.demoImages === 'object') {
      return work.demoImages[pageNum] 
        || (pageKey && work.demoImages[pageKey]) 
        || null;
    }

    if (typeof work.demoImages === 'string') {
      const lines = work.demoImages.split('\n');
      for (const line of lines) {
        const parts = line.split(/[:=](.+)/);
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const url = parts[1].trim();
          if (key === String(pageNum) || (pageKey && key.toLowerCase() === pageKey.toLowerCase())) {
            return url;
          }
        }
      }
    }

    return null;
  }

  /**
   * Проверка, является ли ссылка короткой ссылкой на страницу ExHentai / E-Hentai (/s/...)
   */
  isShortLink(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = url.trim().toLowerCase();
    return clean.includes('exhentai.org/s/') || clean.includes('e-hentai.org/s/');
  }

  /**
   * Получение актуальной прямой ссылки на изображение по короткой ссылке через Supabase Edge Function resolve-preview.
   * При сбое Hath-ноды или истечении keystamp передается forceFresh=true и failover nl.
   */
  async resolveImageUrl(shortUrl, forceFresh = false, nl = null) {
    if (!this.isShortLink(shortUrl)) return shortUrl;

    const cleanShort = shortUrl.trim();

    // 1. Поиск в кэше памяти и sessionStorage (если не запрошено принудительное обновление)
    if (!forceFresh && !nl) {
      const cached = this.resolvedUrlCache.get(cleanShort);
      if (cached && cached.imageUrl) {
        return cached.imageUrl;
      }
      try {
        const item = sessionStorage.getItem(`ex_img_${cleanShort}`);
        if (item) {
          const parsed = JSON.parse(item);
          // Кэш валиден 2 часа (пока действует Hath keystamp)
          if (parsed && parsed.imageUrl && (Date.now() - parsed.resolvedAt < 2 * 3600 * 1000)) {
            this.resolvedUrlCache.set(cleanShort, parsed);
            return parsed.imageUrl;
          }
        }
      } catch (e) {}
    }

    if (!window.supabaseClient || !window.supabaseClient.functions) {
      console.warn('[Reader] Supabase Client недоступен для разрешения ссылки:', cleanShort);
      return cleanShort;
    }

    try {
      const bodyPayload = { url: cleanShort, forceFresh };
      if (nl) bodyPayload.nl = nl;

      const { data, error } = await window.supabaseClient.functions.invoke('resolve-preview', {
        body: bodyPayload
      });

      if (error || !data || !data.success || !data.imageUrl) {
        let errorDetails = (data && data.error) || error?.message;
        if (error && error.context) {
          try {
            const errJson = await error.context.json();
            if (errJson && errJson.error) errorDetails = errJson.error;
          } catch (_) {
            try { errorDetails = await error.context.text(); } catch (_) {}
          }
        }
        console.warn('[Reader] Ошибка функции resolve-preview:', errorDetails || error);
        return null;
      }

      const cacheEntry = {
        imageUrl: data.imageUrl,
        nl: data.nl || null,
        fileName: data.fileName || '',
        resolvedAt: Date.now()
      };

      this.resolvedUrlCache.set(cleanShort, cacheEntry);
      try {
        sessionStorage.setItem(`ex_img_${cleanShort}`, JSON.stringify(cacheEntry));
      } catch (e) {}

      return data.imageUrl;
    } catch (err) {
      console.warn('[Reader] Ошибка вызова resolve-preview:', err);
      return null;
    }
  }

  /**
   * Демо-сцены: построение страниц по реальному скрипту новеллы с наложением интернет-изображений
   */
  /**
   * Строгая фильтрация и привязка страниц к настроенным демо-ссылкам из интернета.
   * Сопоставляет каждую ссылку (включая нелинейные номера, например 11) с соответствующей сценой скрипта.
   */
  applyDemoPagesFilter(customDemoImages = null) {
    const work = this.currentWork;
    const demoImages = customDemoImages || this.activeDemoImages || (work ? work.demoImages : null);
    if (!demoImages) return;

    const hasConfiguredDemoImages = Array.isArray(demoImages)
      ? demoImages.some(item => item && item.url)
      : (typeof demoImages === 'object' && Object.keys(demoImages).length > 0);

    if (!hasConfiguredDemoImages) return;

    // Получаем список сцен скрипта для выбранного языка
    let allEntries = [];
    if (this.parsedScript && this.parsedScript.entries) {
      const normCodes = this.getNormalizedLangCodes(this.currentLang);
      for (const code of normCodes) {
        if (this.parsedScript.entries[code] && this.parsedScript.entries[code].length > 0) {
          allEntries = this.parsedScript.entries[code];
          break;
        }
      }
      if (allEntries.length === 0) {
        allEntries = this.parsedScript.entries['RUS']
          || this.parsedScript.entries['Русский']
          || this.parsedScript.entries['ENG']
          || this.parsedScript.entries['English']
          || Object.values(this.parsedScript.entries)[0]
          || [];
      }
    }

    const demoPages = [];
    const normalizedList = [];

    if (Array.isArray(demoImages)) {
      demoImages.forEach((item, idx) => {
        if (item && item.url && String(item.url).trim()) {
          normalizedList.push({
            page: item.page !== undefined ? item.page : (item.num || (idx + 1)),
            url: String(item.url).trim()
          });
        }
      });
    } else if (typeof demoImages === 'object') {
      Object.entries(demoImages).forEach(([k, v]) => {
        if (v && String(v).trim()) {
          normalizedList.push({
            page: k,
            url: String(v).trim()
          });
        }
      });
    }

    normalizedList.forEach((item, itemIdx) => {
      const rawPage = item.page;
      const num = Number(rawPage);
      let matchedEntry = null;

      // 1. Поиск по 1-based номеру сцены в скрипте (например, для 11-й страницы берем 11-ю сцену allEntries[10])
      if (!isNaN(num) && num > 0 && num <= allEntries.length) {
        matchedEntry = allEntries[num - 1];
      }

      // 2. Если по номеру не найдено, ищем по имени/ключу сцены (Title, 01-01, 00-00 и т.д.)
      if (!matchedEntry && rawPage) {
        const rawStr = String(rawPage).toLowerCase().trim();
        matchedEntry = allEntries.find(e => {
          if (!e) return false;
          const kLower = (e.key || '').toLowerCase();
          const tLower = (e.targetKey || '').toLowerCase();
          const pure = kLower.split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');
          const pureTarget = tLower.split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');
          const isTitleMatch = (rawStr === 'title' || rawStr === 'титул' || rawStr.includes('title')) && 
                               (e.isTitle || pure.includes('title') || pureTarget.includes('title'));
          return kLower === rawStr || tLower === rawStr || pure === rawStr || pureTarget === rawStr || isTitleMatch;
        });
      }

      // Если первая страница превью и в скрипте есть титул — привязываем к титулу скрипта
      if (!matchedEntry && (itemIdx === 0 || String(rawPage).trim() === '1') && allEntries.length > 0) {
        const first = allEntries[0];
        const pureFirst = (first.key || '').toLowerCase();
        if (first.isTitle || pureFirst.includes('title')) {
          matchedEntry = first;
        }
      }

      const pageKey = matchedEntry ? matchedEntry.key : String(rawPage || (itemIdx + 1));
      const targetKey = matchedEntry ? (matchedEntry.targetKey || matchedEntry.key) : pageKey;
      const pageName = matchedEntry ? (matchedEntry.filename || matchedEntry.key) : `Сцена ${rawPage || (itemIdx + 1)}`;

      demoPages.push({
        index: demoPages.length,
        originalIndex: (!isNaN(num) && num > 0) ? (num - 1) : itemIdx,
        key: pageKey,
        targetKey: targetKey,
        subfolder: matchedEntry ? (matchedEntry.subfolder || '') : '',
        name: pageName,
        entry: matchedEntry || { key: pageKey, text: '' },
        rawFile: null,
        url: item.url,
        sourceUrl: item.url,
        isLocked: false
      });
    });

    if (demoPages.length > 0) {
      demoPages.forEach((p, idx) => { p.index = idx; });
      this.pages = demoPages;
    }
  }

  /**
   * Демо-сцены: построение страниц по реальному скрипту новеллы с наложением интернет-изображений
   */
  async loadDemoImages(customDemoImages = null, customScript = null) {
    const work = this.currentWork;
    if (!work) return;

    this.isFullMode = false;
    this.isDemoMode = true;
    this.activeDemoImages = customDemoImages || work.demoImages || [];

    // 1. Получаем и парсим актуальный скрипт этой работы
    let scriptText = customScript || '';
    if (!scriptText) {
      if (work.fullScriptText && !work.fullScriptText.startsWith('[STORED_IN_IDB')) {
        scriptText = work.fullScriptText;
      } else {
        scriptText = await this.store.getFullScript(work.id);
      }
      if (!scriptText || scriptText.startsWith('[STORED_IN_IDB')) {
        scriptText = work.sampleScriptText || (await this.store.getSampleScript(work.id));
      }
    }
    if (scriptText) {
      this.parseWorkScript(work, scriptText);
    }

    const availableLangs = (this.parsedScript && this.parsedScript.languages && this.parsedScript.languages.length > 0)
      ? this.parsedScript.languages
      : (work.availableLanguages || ['Русский', 'English']);
    this.currentLang = this.getPriorityLanguage(availableLangs);

    // 2. Строим структуру страниц по скрипту новеллы (с автоматическим применением applyDemoPagesFilter)
    this.rebuildPagesFromScript();

    this.currentIndex = 0;
    this.currentDialogBlockIndex = 0;
    this.renderReaderUI();

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    window.app?.showToast(
      isEn 
        ? `💡 Loaded interactive preview (${this.pages.length} demo scenes)` 
        : `💡 Загружено интерактивное превью (${this.pages.length} демо-сцен)`,
      'info'
    );
  }

  /**
   * Открыть демо-сцены для конкретной работы по ID
   */
  async loadDemoImagesForWork(workId) {
    let work = this.store.getWorkById(workId);
    if (!work && this.store.initPromise) {
      try { await this.store.initPromise; } catch (e) {}
      work = this.store.getWorkById(workId);
    }
    if (!work) return;
    this.currentWork = work;
    await this.loadDemoImages();
  }

  /**
   * Прямой запуск демо-превью с произвольными данными (для тестирования прямо из формы админки без сохранения)
   */
  async loadDemoImagesWithData(work, demoImages, scriptText) {
    this.currentWork = work || { id: 'preview-temp', title: 'Демо-превью' };
    this.currentWork.demoImages = demoImages;
    await this.loadDemoImages(demoImages, scriptText);
  }

  /**
   * Разрешение постоянного URL для сырого файла на время сессии
   */
  async resolveRawFileUrl(rawFile) {
    if (!rawFile) return '';
    if (rawFile.url) return rawFile.url;

    if (rawFile.file) {
      rawFile.url = URL.createObjectURL(rawFile.file);
      this.createdBlobUrls.add(rawFile.url);
      return rawFile.url;
    }

    if (rawFile.zipEntry) {
      const blob = await rawFile.zipEntry.async('blob');
      rawFile.url = URL.createObjectURL(blob);
      this.createdBlobUrls.add(rawFile.url);
      return rawFile.url;
    }

    return '';
  }

  /**
   * Очистка Blob URL сессии при смене архива
   */
  revokeSessionBlobs() {
    if (this.createdBlobUrls && this.createdBlobUrls.size > 0) {
      for (const url of this.createdBlobUrls) {
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
      this.createdBlobUrls.clear();
    }
    if (this.pages) {
      this.pages.forEach(p => { p.url = null; });
    }
  }

  /**
   * Проверка, является ли страница карточкой персонажа, оверлеем или чистой графикой (где весь текст уже на экране)
   */
  isPageCleanFrame(page) {
    if (!page) return false;
    const fData = this.getFrameForPage(page, this.currentLang);
    if (fData && (fData.image || fData.customImage || fData.textZone || (fData.layers && fData.layers.length > 0))) {
      return true;
    }
    const cleanBase = (page.key || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').toLowerCase();
    if (cleanBase.startsWith('001_') || cleanBase.startsWith('002_') || cleanBase.startsWith('003_') || cleanBase.startsWith('004_') ||
        cleanBase.startsWith('01_') || cleanBase.startsWith('02_') || cleanBase.startsWith('03_') || cleanBase.startsWith('04_') || cleanBase.startsWith('05_') || cleanBase.includes('title')) {
      return true;
    }
    return false;
  }

  /**
   * Проверка на висячие предлоги и союзы для правил типографики
   */
  static isHangingWord(word) {
    if (!word) return false;
    const clean = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()«»""'']/g, '').trim();
    return /^[a-zA-Zа-яА-ЯёЁ]$|^([вксоуия]|не|на|но|за|из|до|по|со|ко|во|ли|бы|же|то|in|on|at|to|by|of|an|or|as|if|so|no|is)$/i.test(clean);
  }

  /**
   * Получение контекста canvas для точного измерения ширины текста
   */
  getMeasureContext(fontStr) {
    if (!this._measureCanvas) {
      this._measureCanvas = document.createElement('canvas');
      this._measureCtx = this._measureCanvas.getContext('2d');
    }
    if (fontStr && this._measureCtx) {
      this._measureCtx.font = fontStr;
    }
    return this._measureCtx;
  }

  /**
   * Перенос текста по словам с учетом типографики и висячих предлогов
   */
  wrapDialogText(text, maxWidth, fontStr) {
    if (!text || maxWidth <= 0) return [''];
    const ctx = this.getMeasureContext(fontStr || '22px Arial, sans-serif');
    const safeMaxWidth = Math.max(20, maxWidth - 16);

    const inputLines = text.split('\n');
    const result = [];

    for (const inputLine of inputLines) {
      const trimmed = inputLine.trim();
      if (!trimmed) {
        result.push('');
        continue;
      }

      const words = trimmed.split(/\s+/).filter(Boolean);
      let currentLine = '';

      for (let i = 0; i < words.length; i++) {
        const word = words[i].trim();
        if (!word) continue;

        const testLine = currentLine ? (currentLine + ' ' + word) : word;
        const testWidth = ctx.measureText(testLine).width;

        if (testWidth > safeMaxWidth && currentLine) {
          let lineToPush = currentLine.trim();
          let carryOver = '';
          while (true) {
            const lastSpaceIdx = lineToPush.lastIndexOf(' ');
            if (lastSpaceIdx <= 0) break;
            const candidateWord = lineToPush.slice(lastSpaceIdx + 1).trim();
            if (ReaderService.isHangingWord(candidateWord)) {
              const before = lineToPush.slice(0, lastSpaceIdx).trim();
              if (before) {
                lineToPush = before;
                carryOver = candidateWord + (carryOver ? ' ' + carryOver : '');
                continue;
              }
            }
            break;
          }

          if (carryOver) {
            result.push(lineToPush);
            currentLine = carryOver + ' ' + word;
          } else {
            result.push(lineToPush);
            currentLine = word;
          }
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        result.push(currentLine.trim());
      }
    }

    return result.length > 0 ? result : [''];
  }

  /**
   * Разбить все диалоговые блоки сцены на пошаговые экраны со строгим ограничением в 4 строки
   */
  /**
   * Разбить все диалоговые блоки сцены на пошаговые экраны со строгим ограничением в 4 строки
   */
  getDialogStepsForPage(page) {
    if (!page || page.isLocked || this.isPageCleanFrame(page)) {
      return [{ blockIndex: 0, stepIndex: 0, text: '', charName: '', isFirstOfSpeaker: true, borderIdx: 3 }];
    }

    const rawText = (page.entry && page.entry.text) || '';
    const blocks = ScriptParser.getBlocks(rawText);
    if (!blocks || blocks.length === 0) {
      return [{ blockIndex: 0, stepIndex: 0, text: '', charName: '', isFirstOfSpeaker: true, borderIdx: 3 }];
    }

    const overlayData = (this.parsedScript && this.parsedScript.overlayData) || {};
    const presets = this.normalizePresets(overlayData.presets);
    const dialogData = overlayData.dialogData || {};
    const cleanBase = (page.key || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');

    const candKeys = this.getCandidateSceneKeys(page);

    const steps = [];

    const getEstimatedLines = (text, hasSpeakerPrefix = false, speakerName = '') => {
      if (!text) return 0;
      const lines = text.split('\n');
      let total = 0;
      for (let i = 0; i < lines.length; i++) {
        let len = lines[i].length;
        if (i === 0 && hasSpeakerPrefix && speakerName) {
          len += speakerName.length + 2;
        }
        total += Math.max(1, Math.ceil(len / 40));
      }
      return total;
    };

    blocks.forEach((rawBlock, bIdx) => {
      const cleanBlock = ScriptParser.stripComments(rawBlock).trim();
      if (!cleanBlock) return;

      const charMatch = cleanBlock.match(/^[\(（【]([^)）】]+)[\)）】]/);
      const charName = charMatch ? charMatch[1].trim() : '';
      const speechWithoutSpeaker = charMatch 
        ? cleanBlock.replace(/^[\(（【][^)）】]+[\)）】]\s*/, '').trim() 
        : cleanBlock.trim();

      let bSettings = {};
      for (const k of candKeys) {
        const fullKey = `${k}_block_${bIdx}`;
        if (dialogData[fullKey]) {
          bSettings = dialogData[fullKey];
          break;
        }
      }

      const defBorderIdx = charName ? 0 : 3;
      let borderIdx = defBorderIdx;
      if (bSettings.borderIndex !== undefined && bSettings.borderIndex !== null) {
        borderIdx = typeof bSettings.borderIndex === 'number' 
          ? bSettings.borderIndex 
          : parseInt(bSettings.borderIndex, 10);
        if (isNaN(borderIdx)) borderIdx = defBorderIdx;
      }

      const preset = presets.find(p => p.name === bSettings.preset) || {};
      const bCfg = ReaderService.BORDER_CONFIGS[borderIdx] || ReaderService.BORDER_CONFIGS[0];
      const customTz = (overlayData.borderZones && overlayData.borderZones[borderIdx]) || bCfg.textZone;

      const rawLines = speechWithoutSpeaker.split('\n').map(l => l.trim()).filter(Boolean);
      if (rawLines.length === 0) return;

      // Если отдельная строка превышает 160 символов, аккуратно разбиваем её по предложениям
      const atomLines = [];
      for (const line of rawLines) {
        if (line.length <= 160) {
          atomLines.push(line);
        } else {
          const sentences = line.split(/(?<=[.!?♥…])\s+/);
          let cur = '';
          for (const s of sentences) {
            if (s.length <= 160) {
              if (!cur) {
                cur = s;
              } else if ((cur + ' ' + s).length <= 160) {
                cur += ' ' + s;
              } else {
                atomLines.push(cur);
                cur = s;
              }
            } else {
              if (cur) {
                atomLines.push(cur);
                cur = '';
              }
              const words = s.split(/\s+/);
              let wCur = '';
              for (const w of words) {
                if (!wCur) {
                  wCur = w;
                } else if ((wCur + ' ' + w).length <= 160) {
                  wCur += ' ' + w;
                } else {
                  atomLines.push(wCur);
                  wCur = w;
                }
              }
              if (wCur) cur = wCur;
            }
          }
          if (cur) atomLines.push(cur);
        }
      }

      const blockSteps = [];
      let currentStepLines = [];

      for (let i = 0; i < atomLines.length; i++) {
        const line = atomLines[i];
        const isFirstInStep = currentStepLines.length === 0;
        const isFirstOfSpeaker = blockSteps.length === 0 && isFirstInStep;

        const candidateLines = [...currentStepLines, line];
        const candidateText = candidateLines.join('\n');
        const estLines = getEstimatedLines(candidateText, isFirstOfSpeaker, charName);

        if (!isFirstInStep && (estLines > 4 || candidateText.length > 165)) {
          blockSteps.push({
            text: currentStepLines.join('\n'),
            charName: charName,
            isFirstOfSpeaker: blockSteps.length === 0
          });
          currentStepLines = [line];
        } else {
          currentStepLines.push(line);
        }
      }

      if (currentStepLines.length > 0) {
        blockSteps.push({
          text: currentStepLines.join('\n'),
          charName: charName,
          isFirstOfSpeaker: blockSteps.length === 0
        });
      }

      blockSteps.forEach((subStep, sIdx) => {
        steps.push({
          blockIndex: bIdx,
          stepIndex: sIdx,
          totalStepsInBlock: blockSteps.length,
          charName: charName,
          isFirstOfSpeaker: subStep.isFirstOfSpeaker,
          text: subStep.text,
          speechText: speechWithoutSpeaker,
          borderIdx: borderIdx,
          preset: preset,
          bSettings: bSettings,
          customTz: customTz
        });
      });
    });

    return steps.length > 0 ? steps : [{ blockIndex: 0, stepIndex: 0, text: '', charName: '', isFirstOfSpeaker: true, borderIdx: 3 }];
  }

  /**
   * Разрешение URL источника изображения для портрета (поддержка локальных файлов, демо-сцен и фонов)
   */
  async resolvePortraitSourceUrl(portrait) {
    if (!portrait) return null;
    if (portrait.dataURL) return portrait.dataURL;

    const srcKey = (portrait.sourceImage || '').trim();

    // 1. Поиск в загруженном файловом архиве/папке
    if (srcKey && this.fileMap && this.fileMap.size > 0) {
      const srcFile = this.resolveFileForTarget(srcKey);
      if (srcFile) {
        try {
          const url = await this.resolveRawFileUrl(srcFile);
          if (url) return url;
        } catch (e) {
          console.warn('Не удалось получить URL из rawFile для портрета:', e);
        }
      }
    }

    // 2. В режиме демо-сцен или интернет-ссылок
    if (this.pages && this.pages.length > 0) {
      // 2a. Ищем страницу по имени файла/сцены (например, 02-0, 03-01)
      if (srcKey) {
        const cleanSrc = srcKey.split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').toLowerCase();
        const normSrc = this.normalizeKeyForMatching(srcKey);
        const matchedPage = this.pages.find(p => {
          if (!p || !p.url) return false;
          const pKey = (p.key || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').toLowerCase();
          const pTarget = (p.targetKey || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').toLowerCase();
          const pName = (p.name || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '').toLowerCase();
          const normP = this.normalizeKeyForMatching(p.key || p.targetKey || p.name);
          return pKey === cleanSrc || pTarget === cleanSrc || pName === cleanSrc || pKey.includes(cleanSrc) || (normSrc && normP === normSrc);
        });
        if (matchedPage && matchedPage.url) {
          return matchedPage.url;
        }
      }

      // 2b. Ищем в demoImages работы
      const work = this.currentWork;
      if (work && work.demoImages) {
        const demoUrl = this.getDemoImageUrl(work, -1, srcKey);
        if (demoUrl) return demoUrl;
      }

      // 2c. Проверяем текущую открытую сцену в читалке
      const curPage = this.pages[this.currentIndex];
      if (curPage && curPage.url) {
        if (srcKey) {
          const normSrc = this.normalizeKeyForMatching(srcKey);
          const normCur = this.normalizeKeyForMatching(curPage.key || curPage.targetKey || curPage.name);
          const srcScene = normSrc.match(/^([a-z]*\d+)/);
          const curScene = normCur.match(/^([a-z]*\d+)/);
          if (srcScene && curScene && srcScene[1] === curScene[1]) {
            return curPage.url;
          }
        }
        // Если сцена текущей реплики совпадает, используем фон текущей сцены
        return curPage.url;
      }
    }

    return null;
  }

  /**
   * Определение базового разрешения изображения, на котором производилась нарезка портрета
   */
  getPortraitBaseResolution(portrait, imgNaturalW, imgNaturalH) {
    if (!portrait || !portrait.crop) return { baseW: imgNaturalW || 1280, baseH: imgNaturalH || 720 };
    const c = portrait.crop;

    if (c.baseWidth && c.baseHeight) {
      return { baseW: c.baseWidth, baseH: c.baseHeight };
    }
    if (c.origW && c.origH) {
      return { baseW: c.origW, baseH: c.origH };
    }

    if (c.unit === '%' || (c.x <= 1 && c.y <= 1 && c.w <= 1 && c.h <= 1)) {
      return { baseW: 1, baseH: 1, isPercent: true };
    }
    if (c.unit === 'percent' || (c.isPercent && c.w <= 100)) {
      return { baseW: 100, baseH: 100, isPercent: true };
    }

    // Собираем максимальные координаты среди всех портретов текущей новеллы
    let maxCropX = c.x + c.w;
    let maxCropY = c.y + c.h;

    const allPortraits = this.normalizePortraits(
      (this.parsedScript && this.parsedScript.overlayData && this.parsedScript.overlayData.portraits) || []
    );
    for (const p of allPortraits) {
      if (p && p.crop && typeof p.crop === 'object') {
        const pc = p.crop;
        if (pc.unit !== '%' && !pc.isPercent && pc.w > 1) {
          if (pc.x + pc.w > maxCropX) maxCropX = pc.x + pc.w;
          if (pc.y + pc.h > maxCropY) maxCropY = pc.y + pc.h;
        }
      }
    }

    const aspect = (imgNaturalW && imgNaturalH) ? (imgNaturalW / imgNaturalH) : (16 / 9);

    const standardResolutions = [
      { w: 800, h: 600, aspect: 4/3 },
      { w: 1024, h: 576, aspect: 16/9 },
      { w: 1024, h: 768, aspect: 4/3 },
      { w: 1280, h: 720, aspect: 16/9 },
      { w: 1280, h: 800, aspect: 16/10 },
      { w: 1280, h: 960, aspect: 4/3 },
      { w: 1366, h: 768, aspect: 16/9 },
      { w: 1600, h: 900, aspect: 16/9 },
      { w: 1920, h: 1080, aspect: 16/9 },
      { w: 1920, h: 1200, aspect: 16/10 },
      { w: 2560, h: 1440, aspect: 16/9 },
      { w: 3840, h: 2160, aspect: 16/9 }
    ];

    const candidates = standardResolutions.filter(r =>
      r.w >= maxCropX && r.h >= maxCropY && Math.abs(r.aspect - aspect) < 0.15
    );

    if (candidates.length > 0) {
      return { baseW: candidates[0].w, baseH: candidates[0].h };
    }

    const anyCandidate = standardResolutions.find(r => r.w >= maxCropX && r.h >= maxCropY);
    if (anyCandidate) {
      return { baseW: anyCandidate.w, baseH: anyCandidate.h };
    }

    const inferredW = Math.max(maxCropX, Math.round(maxCropY * aspect));
    const inferredH = Math.max(maxCropY, Math.round(inferredW / aspect));
    return { baseW: inferredW || 1280, baseH: inferredH || 720 };
  }

  /**
   * Преобразование координат кропа в нормализованные доли (0..1) с учетом разрешения исходного изображения
   */
  getNormalizedCrop(crop, imgNaturalW, imgNaturalH, portrait = null) {
    if (!crop) return { x: 0, y: 0, w: 1, h: 1 };

    if (crop.unit === '%' || (crop.x <= 1 && crop.y <= 1 && crop.w <= 1 && crop.h <= 1)) {
      return {
        x: Math.max(0, Math.min(1, crop.x)),
        y: Math.max(0, Math.min(1, crop.y)),
        w: Math.max(0.01, Math.min(1 - Math.max(0, crop.x), crop.w)),
        h: Math.max(0.01, Math.min(1 - Math.max(0, crop.y), crop.h))
      };
    }

    if (crop.unit === 'percent' || (crop.isPercent && crop.w <= 100)) {
      const nx = crop.x / 100;
      const ny = crop.y / 100;
      const nw = crop.w / 100;
      const nh = crop.h / 100;
      return {
        x: Math.max(0, Math.min(1, nx)),
        y: Math.max(0, Math.min(1, ny)),
        w: Math.max(0.01, Math.min(1 - nx, nw)),
        h: Math.max(0.01, Math.min(1 - ny, nh))
      };
    }

    // Координаты в пикселях: находим базовое разрешение
    const base = this.getPortraitBaseResolution(portrait || { crop }, imgNaturalW, imgNaturalH);
    const baseW = base.baseW || imgNaturalW || 1280;
    const baseH = base.baseH || imgNaturalH || 720;

    const nx = Math.max(0, Math.min(1, crop.x / baseW));
    const ny = Math.max(0, Math.min(1, crop.y / baseH));
    const nw = Math.max(0.01, Math.min(1 - nx, crop.w / baseW));
    const nh = Math.max(0.01, Math.min(1 - ny, crop.h / baseH));

    return { x: nx, y: ny, w: nw, h: nh };
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

    const srcUrl = await this.resolvePortraitSourceUrl(portrait);
    if (!srcUrl || !portrait.crop) return null;

    try {
      const dataUrl = await this.cropImageToDataUrl(srcUrl, portrait.crop, portrait);
      if (dataUrl) {
        this.portraitCache.set(cacheKey, dataUrl);
        return dataUrl;
      }
    } catch (e) {
      console.warn('Ошибка нарезки портрета:', portrait.name, e);
    }
    return null;
  }

  /**
   * Нарезка портрета через Canvas (с безопасным перехватом CORS)
   */
  cropImageToDataUrl(imgSrc, crop, portrait = null) {
    return new Promise((resolve) => {
      const isLocal = imgSrc.startsWith('data:') || imgSrc.startsWith('blob:') || imgSrc.startsWith('/') || imgSrc.startsWith(window.location.origin);
      if (!isLocal) {
        // Для внешних изображений не используем Canvas с crossOrigin во избежание CORS блокировки браузером
        resolve(null);
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const norm = this.getNormalizedCrop(crop, img.naturalWidth, img.naturalHeight, portrait);
          let sx = Math.max(0, Math.round(norm.x * img.naturalWidth));
          let sy = Math.max(0, Math.round(norm.y * img.naturalHeight));
          let sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(norm.w * img.naturalWidth)));
          let sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(norm.h * img.naturalHeight)));

          if (sw <= 0 || sh <= 0) {
            resolve(null);
            return;
          }

          const cvs = document.createElement('canvas');
          cvs.width = sw;
          cvs.height = sh;
          const ctx = cvs.getContext('2d');
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          try {
            resolve(cvs.toDataURL('image/png'));
          } catch (corsErr) {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imgSrc;
    });
  }

  /**
   * Надежный рендеринг портрета в слоте рамки диалога (Canvas + DOM/CSS fallback)
   */
  async renderPortraitInSlot(slot, portraitObj, baseImg) {
    if (!slot || !portraitObj) return;

    slot.innerHTML = '';
    const cacheKey = portraitObj.name;

    // 1. Проверяем кэш готовых нарезок
    if (this.portraitCache.has(cacheKey)) {
      const cachedUrl = this.portraitCache.get(cacheKey);
      if (cachedUrl) {
        const pImg = document.createElement('img');
        pImg.src = cachedUrl;
        pImg.alt = '';
        pImg.style.width = '100%';
        pImg.style.height = '100%';
        pImg.style.objectFit = 'cover';
        slot.appendChild(pImg);
        return;
      }
    }

    // 2. Если уже есть dataURL в самом объекте
    if (portraitObj.dataURL) {
      const pImg = document.createElement('img');
      pImg.src = portraitObj.dataURL;
      pImg.alt = '';
      pImg.style.width = '100%';
      pImg.style.height = '100%';
      pImg.style.objectFit = 'cover';
      slot.appendChild(pImg);
      return;
    }

    // 3. Получаем URL исходного изображения
    let srcUrl = await this.resolvePortraitSourceUrl(portraitObj);
    if (!srcUrl && baseImg && baseImg.src) {
      srcUrl = baseImg.src;
    }

    if (!srcUrl || !portraitObj.crop) {
      return;
    }

    const isLocalOrData = srcUrl.startsWith('data:') || srcUrl.startsWith('blob:') || srcUrl.startsWith('/') || srcUrl.startsWith(window.location.origin);

    // Функция гарантированного DOM/CSS кропа: работает для ЛЮБЫХ внешних URL без CORS!
    const renderDomCssCrop = () => {
      slot.innerHTML = '';
      const cssImg = document.createElement('img');
      cssImg.className = 'portrait-crop-css';
      cssImg.alt = portraitObj.name || '';

      const applyCrop = () => {
        const natW = cssImg.naturalWidth || 1280;
        const natH = cssImg.naturalHeight || 720;
        const norm = this.getNormalizedCrop(portraitObj.crop, natW, natH, portraitObj);

        const scaleW = norm.w > 0 ? (1 / norm.w) * 100 : 100;
        const scaleH = norm.h > 0 ? (1 / norm.h) * 100 : 100;
        const leftPercent = norm.w > 0 ? (-norm.x * scaleW) : 0;
        const topPercent = norm.h > 0 ? (-norm.y * scaleH) : 0;

        cssImg.style.setProperty('position', 'absolute', 'important');
        cssImg.style.setProperty('left', `${leftPercent}%`, 'important');
        cssImg.style.setProperty('top', `${topPercent}%`, 'important');
        cssImg.style.setProperty('width', `${scaleW}%`, 'important');
        cssImg.style.setProperty('height', `${scaleH}%`, 'important');
        cssImg.style.setProperty('max-width', 'none', 'important');
        cssImg.style.setProperty('max-height', 'none', 'important');
        cssImg.style.setProperty('object-fit', 'fill', 'important');
        cssImg.style.setProperty('pointer-events', 'none', 'important');
      };

      cssImg.onload = applyCrop;
      cssImg.onerror = () => {
        slot.innerHTML = '';
      };
      cssImg.src = srcUrl;
      slot.appendChild(cssImg);

      if (cssImg.complete && cssImg.naturalWidth > 0) {
        applyCrop();
      }
    };

    // Если ресурс внешний (http/https с внешнего хостинга), сразу рендерим через CSS без crossOrigin,
    // чтобы браузер ни в коем случае не заблокировал изображение политикой CORS!
    if (!isLocalOrData) {
      renderDomCssCrop();
      return;
    }

    // Для локальных blob / data URL используем нарезку через Canvas
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const norm = this.getNormalizedCrop(portraitObj.crop, img.naturalWidth, img.naturalHeight, portraitObj);

      let croppedDataUrl = null;
      try {
        const cvs = document.createElement('canvas');
        let sx = Math.max(0, Math.round(norm.x * img.naturalWidth));
        let sy = Math.max(0, Math.round(norm.y * img.naturalHeight));
        let sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(norm.w * img.naturalWidth)));
        let sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(norm.h * img.naturalHeight)));
        cvs.width = sw;
        cvs.height = sh;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        croppedDataUrl = cvs.toDataURL('image/png');
        this.portraitCache.set(cacheKey, croppedDataUrl);
      } catch (canvasErr) {
        croppedDataUrl = null;
      }

      if (croppedDataUrl) {
        slot.innerHTML = '';
        const pImg = document.createElement('img');
        pImg.src = croppedDataUrl;
        pImg.alt = '';
        pImg.style.width = '100%';
        pImg.style.height = '100%';
        pImg.style.objectFit = 'cover';
        slot.appendChild(pImg);
      } else {
        renderDomCssCrop();
      }
    };
    img.onerror = () => {
      renderDomCssCrop();
    };
    img.src = srcUrl;
  }

  setLanguage(lang) {
    this.currentLang = lang;
    this.rebuildPagesFromScript();
    this.updateReaderDisplay();
  }

  toggleSpread() {
    this.isTwoPageSpread = !this.isTwoPageSpread;
    if (this.isTwoPageSpread) {
      this.resetZoom();
    }
    this.updateReaderDisplay();
  }

  /**
   * Увеличение масштаба сцены (Zoom In)
   */
  zoomIn() {
    if (this.isTwoPageSpread) return;
    this.zoomLevel = Math.min(3.0, +(this.zoomLevel + 0.25).toFixed(2));
    this.applyStageTransform();
  }

  /**
   * Уменьшение масштаба сцены (Zoom Out)
   */
  zoomOut() {
    if (this.isTwoPageSpread) return;
    this.zoomLevel = Math.max(0.5, +(this.zoomLevel - 0.25).toFixed(2));
    if (this.zoomLevel <= 1.0) {
      this.panX = 0;
      this.panY = 0;
    }
    this.applyStageTransform();
  }

  /**
   * Сброс масштаба до 100% (1x)
   */
  resetZoom() {
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.applyStageTransform();
  }

  /**
   * Переключение масштаба 2x / 1x (по двойному клику)
   */
  toggleZoom() {
    if (this.isTwoPageSpread) return;
    if (this.zoomLevel > 1.0) {
      this.resetZoom();
    } else {
      this.zoomLevel = 2.0;
      this.panX = 0;
      this.panY = 0;
      this.applyStageTransform();
    }
  }

  /**
   * Применение трансформации зума и панорамирования
   */
  applyStageTransform() {
    const stage = document.querySelector('.reader-spread-layout');
    const resetBtn = document.getElementById('reader-zoom-reset-btn');
    if (resetBtn) {
      resetBtn.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }
    if (!stage) return;
    if (this.zoomLevel !== 1.0 || this.panX !== 0 || this.panY !== 0) {
      stage.style.transform = `scale(${this.zoomLevel}) translate(${this.panX / this.zoomLevel}px, ${this.panY / this.zoomLevel}px)`;
      stage.classList.add('zoomed');
    } else {
      stage.style.transform = 'none';
      stage.classList.remove('zoomed', 'panning');
    }
  }

  /**
   * Настройка обработчиков событий для сцены (скролл текста, двойной клик зума, панорамирование)
   */
  setupStageEvents() {
    if (this._eventsSetup) return;
    this._eventsSetup = true;

    const container = document.getElementById('reader-stage-container');
    if (!container) return;

    // Вспомогательная функция: поиск текстового слота с активным скроллом (только карточки персонажей)
    const getScrollableTextSlot = (target) => {
      if (!target) return null;
      const directSlot = target.closest('.clean-frame-text-slot');
      if (directSlot && directSlot.scrollHeight > directSlot.clientHeight + 4) {
        return directSlot;
      }
      const wrapper = target.closest('.clean-frame-wrapper, .reader-stage-slot, .reader-dom-box');
      if (wrapper) {
        const cleanSlot = wrapper.querySelector('.clean-frame-text-slot');
        if (cleanSlot && cleanSlot.scrollHeight > cleanSlot.clientHeight + 4) return cleanSlot;
      }
      return null;
    };

    // Скролл колесиком мыши:
    // - Если курсор над переполненным текстом, плавно скроллим текст.
    // - Если текст полностью помещается, либо скролл достиг конца, либо курсор на любом другом участке сцены/экрана —
    //   колесико мыши листает реплики диалогов и страницы!
    const onStageWheel = (e) => {
      // Игнорируем скролл над всплывающей панелью инструментов
      if (e.target.closest('#reader-bottom-bar') || e.target.closest('.reader-header') || e.target.closest('select')) {
        return;
      }

      // При скролле колесиком снимаем фокус с ползунка страниц и убираем принудительный показ
      if (document.activeElement && document.activeElement.closest('#reader-bottom-bar')) {
        document.activeElement.blur();
      }
      const bBar = document.getElementById('reader-bottom-bar');
      if (bBar) bBar.classList.remove('force-show');

      const textSlot = getScrollableTextSlot(e.target);
      if (textSlot) {
        const canScrollDown = e.deltaY > 0 && (textSlot.scrollTop + textSlot.clientHeight < textSlot.scrollHeight - 2);
        const canScrollUp = e.deltaY < 0 && textSlot.scrollTop > 2;
        if (canScrollDown || canScrollUp) {
          e.preventDefault();
          textSlot.scrollTop += e.deltaY * 0.7;
          return;
        }
      }

      e.preventDefault();
      const now = Date.now();
      if (!this.lastWheelTime) this.lastWheelTime = 0;
      if (now - this.lastWheelTime < 110) return;
      if (Math.abs(e.deltaY) < 4) return;
      this.lastWheelTime = now;

      if (e.deltaY > 0) {
        this.nextPage();
      } else {
        this.prevPage();
      }
    };

    container.addEventListener('wheel', onStageWheel, { passive: false });

    // Клик по сцене читалки для перехода вперед/назад
    let stageClickTimer = null;
    container.addEventListener('click', (e) => {
      if (e.target.closest('#reader-bottom-bar') || e.target.closest('.btn') || e.target.closest('select') || e.target.closest('input')) {
        return;
      }
      if (this.didPan) {
        this.didPan = false;
        return;
      }
      if (e.target.closest('.dialog-frame-wrapper')) return;

      const textSlot = getScrollableTextSlot(e.target);
      if (textSlot) return;

      if (stageClickTimer) {
        clearTimeout(stageClickTimer);
        stageClickTimer = null;
      }

      stageClickTimer = setTimeout(() => {
        stageClickTimer = null;
        if (this.didPan) return;

        const clickX = e.clientX;
        const width = window.innerWidth;
        if (clickX > width * 0.35) {
          this.nextPage();
        } else {
          this.prevPage();
        }
      }, 200);
    });

    // Двойной клик переключает масштаб 2x / 1x (как в Overlaying text on graphics)
    container.addEventListener('dblclick', (e) => {
      if (e.target.closest('#reader-bottom-bar') || e.target.closest('.btn') || e.target.closest('select')) return;
      if (stageClickTimer) {
        clearTimeout(stageClickTimer);
        stageClickTimer = null;
      }
      this.toggleZoom();
    });

    // Управление видимостью панели при взаимодействии со слайдером страниц
    const bottomBar = document.getElementById('reader-bottom-bar');
    const trigger = document.getElementById('reader-bottom-trigger');
    const slider = document.getElementById('reader-slider');

    if (bottomBar) {
      bottomBar.addEventListener('mousedown', () => {
        bottomBar.classList.add('force-show');
      });
      window.addEventListener('mouseup', () => {
        bottomBar.classList.remove('force-show');
        if (document.activeElement && document.activeElement.closest('#reader-bottom-bar')) {
          document.activeElement.blur();
        }
      });
    }

    if (slider) {
      const releaseSlider = () => {
        slider.blur();
        if (bottomBar) bottomBar.classList.remove('force-show');
      };
      slider.addEventListener('change', releaseSlider);
      slider.addEventListener('pointerup', releaseSlider);
      slider.addEventListener('mouseup', releaseSlider);
      slider.addEventListener('touchend', releaseSlider);
    }

    if (trigger) {
      trigger.addEventListener('mouseleave', () => {
        if (bottomBar) bottomBar.classList.remove('force-show');
        if (document.activeElement && document.activeElement.closest('#reader-bottom-bar')) {
          document.activeElement.blur();
        }
      });
    }

    // Перемещение панорамирования мышью при увеличенном масштабе
    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('#reader-bottom-bar') || e.target.closest('.btn') || e.target.closest('select')) return;
      if (e.button !== 0 || this.zoomLevel <= 1.0 || this.isTwoPageSpread) return;

      e.preventDefault();
      this.isPanning = true;
      this.didPan = false;
      this.panStartX = e.clientX - this.panX;
      this.panStartY = e.clientY - this.panY;
      const layout = document.querySelector('.reader-spread-layout');
      if (layout) layout.classList.add('panning');
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPanning || this.zoomLevel <= 1.0 || this.isTwoPageSpread) return;
      e.preventDefault();
      const currentPanX = e.clientX - this.panStartX;
      const currentPanY = e.clientY - this.panStartY;

      if (Math.abs(currentPanX - this.panX) > 4 || Math.abs(currentPanY - this.panY) > 4) {
        this.didPan = true;
      }

      const maxPanX = window.innerWidth * 0.7;
      const maxPanY = window.innerHeight * 0.7;
      this.panX = Math.max(-maxPanX, Math.min(maxPanX, currentPanX));
      this.panY = Math.max(-maxPanY, Math.min(maxPanY, currentPanY));
      this.applyStageTransform();
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        const layout = document.querySelector('.reader-spread-layout');
        if (layout) layout.classList.remove('panning');
      }
    });
  }

  /**
   * Переход вперед: если в текущей сцене есть ещё реплики диалога, шагаем по ним!
   */
  nextPage() {
    const curPage = this.pages[this.currentIndex];
    const isClean = this.isPageCleanFrame(curPage);
    if (curPage && !curPage.isLocked && !isClean) {
      const steps = this.getDialogStepsForPage(curPage);
      if (steps.length > 1 && this.currentDialogBlockIndex < steps.length - 1) {
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
    } else if (!this.isFullMode) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      window.app?.showToast(
        isEn 
          ? `🔒 Demo preview complete (${this.pages.length} scenes). Purchase to unlock full translation!` 
          : `🔒 Демо-превью завершено (${this.pages.length} сцен). Приобретите новеллу, чтобы открыть все главы!`,
        'info'
      );
    }
  }

  /**
   * Переход назад: к предыдущей реплике диалога или предыдущей сцене
   */
  prevPage() {
    const curPage = this.pages[this.currentIndex];
    const isClean = this.isPageCleanFrame(curPage);
    if (curPage && !curPage.isLocked && !isClean) {
      if (this.currentDialogBlockIndex > 0) {
        this.currentDialogBlockIndex--;
        this.updateReaderDisplay();
        return;
      }
    }

    const step = this.isTwoPageSpread ? 2 : 1;
    if (this.currentIndex - step >= 0) {
      this.currentIndex -= step;
      const prevPage = this.pages[this.currentIndex];
      const prevIsClean = this.isPageCleanFrame(prevPage);
      if (prevPage && !prevIsClean) {
        const prevSteps = this.getDialogStepsForPage(prevPage);
        this.currentDialogBlockIndex = Math.max(0, prevSteps.length - 1);
      } else {
        this.currentDialogBlockIndex = 0;
      }
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
    document.body.classList.add('reader-open');

    const titleEl = document.getElementById('reader-work-title');
    const modeBadge = document.getElementById('reader-mode-badge');
    const langSelect = document.getElementById('reader-lang-select');
    const closeBtn = modal.querySelector('.reader-header-left button');

    if (closeBtn && window.i18n) {
      closeBtn.textContent = window.i18n.t('reader_btn_close');
    }

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

    this.setupStageEvents();
    this.updateReaderDisplay();
  }

  updateReaderDisplay() {
    const stageLeft = document.getElementById('reader-stage-left');
    const stageRight = document.getElementById('reader-stage-right');
    const spreadBtn = document.getElementById('reader-spread-btn');
    const spreadBottomBtn = document.getElementById('reader-spread-bottom-btn');
    const counter = document.getElementById('reader-counter');
    const slider = document.getElementById('reader-slider');
    const resetBtn = document.getElementById('reader-zoom-reset-btn');

    if (!stageLeft || !stageRight) return;

    const layout = document.querySelector('.reader-spread-layout');
    if (layout) {
      layout.classList.toggle('spread-view', this.isTwoPageSpread);
      layout.classList.toggle('single-view', !this.isTwoPageSpread);
    }

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const spreadText = this.isTwoPageSpread 
      ? (isEn ? '📖 2 Screens' : '📖 2 экрана') 
      : (isEn ? '📖 1 Screen' : '📖 1 экран');
    if (spreadBtn) {
      spreadBtn.textContent = spreadText;
    }
    if (spreadBottomBtn) {
      spreadBottomBtn.textContent = spreadText;
    }

    if (resetBtn) {
      resetBtn.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }

    if (slider) {
      slider.max = Math.max(0, this.pages.length - 1);
      slider.value = this.currentIndex;
    }

    if (counter) {
      counter.textContent = `${this.currentIndex + 1} / ${this.pages.length}`;
    }

    // Сохраняем прогресс чтения для купленной работы
    if (this.isFullMode && this.currentWork && this.currentIndex >= 0) {
      this.saveReadingProgress(this.currentWork.id, this.currentIndex);
    }

    // Обновление счетчика реплик диалога в нижней панели управления (только для новелл с отдельными репликами)
    const dialogStepCounter = document.getElementById('reader-dialog-step-counter');
    if (dialogStepCounter) {
      const curPage = this.pages[this.currentIndex];
      const isClean = this.isPageCleanFrame(curPage);
      const steps = (curPage && !curPage.isLocked && !isClean)
        ? this.getDialogStepsForPage(curPage)
        : [];
      if (steps.length > 1) {
        const safeIdx = Math.max(0, Math.min(this.currentDialogBlockIndex, steps.length - 1));
        dialogStepCounter.textContent = `${safeIdx + 1} / ${steps.length} ▾`;
        dialogStepCounter.style.display = 'inline-flex';
        dialogStepCounter.onclick = (e) => {
          e.stopPropagation();
          this.nextPage();
        };
      } else {
        dialogStepCounter.style.display = 'none';
      }
    }

    // Левая страница
    const leftPage = this.pages[this.currentIndex];
    this.renderPageToStage(stageLeft, leftPage, this.currentDialogBlockIndex);

    // Правая страница (при 2-экранном режиме)
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
   * Динамическое автомасштабирование шрифта в диалоговом окне:
   * гарантирует, что текст на 100% помещается в текущие границы окна без появления скроллбара
   */
  autoFitDialogText(slotEl, contentEl, preferredSize = 24, minSize = 11) {
    if (!slotEl || !contentEl) return;

    const availableH = slotEl.clientHeight;
    const availableW = slotEl.clientWidth;
    if (availableH <= 0 || availableW <= 0) return;

    const fits = () => {
      return (
        contentEl.offsetHeight <= availableH &&
        contentEl.offsetWidth <= availableW &&
        slotEl.scrollHeight <= availableH + 1 &&
        slotEl.scrollWidth <= availableW + 1
      );
    };

    // 1. Проверяем желаемый размер шрифта
    contentEl.style.fontSize = `${preferredSize}px`;
    if (fits()) return;

    // 2. Бинарный поиск оптимального размера
    let low = minSize;
    let high = preferredSize;
    let bestSize = minSize;

    for (let iter = 0; iter < 14 && (high - low) > 0.3; iter++) {
      const mid = (low + high) / 2;
      contentEl.style.fontSize = `${mid}px`;
      if (fits()) {
        bestSize = mid;
        low = mid;
      } else {
        high = mid;
      }
    }

    contentEl.style.fontSize = `${bestSize.toFixed(1)}px`;
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
            ${isEn ? 'Price:' : 'Стоимость:'} <strong>${price} ${isEn ? 'Orbs' : 'Орб'}</strong> (${price} USDT)
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

    // Резервная защита и авто-обновление ссылки на изображение при истечении срока или ошибке сети:
    baseImg.onerror = async () => {
      // 1. Для сырых файлов zip-архива
      if (page.rawFile && page.rawFile.zipEntry) {
        try {
          const base64 = await page.rawFile.zipEntry.async('base64');
          const ext = (page.rawFile.name || '').split('.').pop().toLowerCase();
          const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
          const dataUrl = `data:${mime};base64,${base64}`;
          page.url = dataUrl;
          if (page.rawFile) page.rawFile.url = dataUrl;
          baseImg.src = dataUrl;
        } catch (e) {
          console.warn('Резервная конвертация в base64 не удалась:', e);
        }
        return;
      }

      // 2. Если ссылка на изображение устарела (Hath keystamp) или сервер недоступен:
      // Запрашиваем актуальную прямую ссылку у Supabase Edge Function по исходной короткой ссылке
      const shortUrl = (this.isShortLink(page.sourceUrl) ? page.sourceUrl : null) || (this.isShortLink(page.url) ? page.url : null);
      if (shortUrl && (!page._refreshAttempts || page._refreshAttempts < 2)) {
        page._refreshAttempts = (page._refreshAttempts || 0) + 1;
        console.warn(`[Reader] Картинка недоступна (${baseImg.src}). Запрашиваем актуальную ссылку у Supabase... (попытка ${page._refreshAttempts})`);

        const cached = this.resolvedUrlCache.get(shortUrl);
        const failoverNl = cached ? cached.nl : null;
        this.resolvedUrlCache.delete(shortUrl);
        try { sessionStorage.removeItem(`ex_img_${shortUrl}`); } catch (e) {}

        const freshUrl = await this.resolveImageUrl(shortUrl, true, failoverNl);
        if (freshUrl && freshUrl !== baseImg.src) {
          page.url = freshUrl;
          baseImg.src = freshUrl;
          return;
        }
      }

      if (page.url && page.url.startsWith('http')) {
        console.warn('Не удалось загрузить внешнее изображение после попыток обновления:', page.url);
        baseImg.src = 'assets/demo/cover-1.svg';
      }
    };

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
    } else if (this.isShortLink(page.sourceUrl || page.url)) {
      const shortUrl = page.sourceUrl || page.url;
      const cached = this.resolvedUrlCache.get(shortUrl);
      let targetUrl = cached?.imageUrl;

      if (!targetUrl) {
        // Показываем деликатный спиннер при первичном разрешении короткой ссылки
        const spinner = document.createElement('div');
        spinner.className = 'page-loading-spinner';
        spinner.innerHTML = `<div class="spinner-orb">🌐</div><p style="font-size: 0.9rem; color: var(--text-muted);">Получение актуальной ссылки на сцену...</p>`;
        sceneStage.appendChild(spinner);
        sceneWrapper.appendChild(sceneStage);
        domBox.appendChild(sceneWrapper);
        container.appendChild(domBox);

        try {
          targetUrl = await this.resolveImageUrl(shortUrl);
        } catch (e) {}

        if (spinner.parentNode) spinner.remove();
      }

      page.url = targetUrl || page.url;
      baseImg.src = targetUrl || 'assets/demo/cover-1.svg';
      sceneStage.appendChild(baseImg);
      if (!domBox.parentNode) {
        sceneWrapper.appendChild(sceneStage);
        domBox.appendChild(sceneWrapper);
        container.appendChild(domBox);
      }
    } else {
      baseImg.src = page.url || '';
      sceneStage.appendChild(baseImg);
      sceneWrapper.appendChild(sceneStage);
      domBox.appendChild(sceneWrapper);
      container.appendChild(domBox);
    }

    const overlayData = (this.parsedScript && this.parsedScript.overlayData) || {};
    const presets = this.normalizePresets(overlayData.presets);
    const frames = overlayData.frames || {};
    const dialogData = overlayData.dialogData || {};
    const portraits = this.normalizePortraits(overlayData.portraits);
    const imagesData = overlayData.images || {};

    const cleanBase = (page.key || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');
    const cleanTarget = (page.targetKey || '').split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');
    const isTitle = (page.entry && page.entry.isTitle) || 
                    cleanBase.toLowerCase().includes('title') || 
                    cleanTarget.toLowerCase().includes('title') ||
                    page.index === 0;

    const fData = this.getFrameForPage(page, this.currentLang);
    const langCodes = this.getNormalizedLangCodes(this.currentLang);

    const rawText = (page.entry && page.entry.text) || '';
    const blocks = ScriptParser.getBlocks(rawText);

    // =========================================================================
    // 1. Графический оверлей (Title) или Внутренняя рамка персонажа (Clean Frame)
    // =========================================================================
    const fLayers = (fData && Array.isArray(fData.layers) && fData.layers.length > 0)
      ? fData.layers
      : (fData ? [fData] : []);

    const activeLayers = fLayers.filter(l => {
      const lLang = l.lang || (fData && fData.lang) || 'all';
      return lLang === 'all' || langCodes.some(c => c.toLowerCase() === lLang.toLowerCase());
    }).sort((a, b) => Number(a.layer || 1) - Number(b.layer || 1));

    if (fData && (fData.customImage || fData.image || activeLayers.length > 0)) {
      const resolveLayerSrc = (layer) => {
        if (!layer) return '';
        if (layer.customImage) return layer.customImage;
        const imgName = layer.image;
        if (!imgName) return '';
        if (overlayData.frameAssets) {
          if (overlayData.frameAssets[imgName]) return overlayData.frameAssets[imgName];
          const cleanTarget = imgName.replace(/\.[^/.]+$/, '').toLowerCase();
          for (const [k, dURL] of Object.entries(overlayData.frameAssets)) {
            if (k.toLowerCase() === imgName.toLowerCase() || k.replace(/\.[^/.]+$/, '').toLowerCase() === cleanTarget) {
              return dURL;
            }
          }
        }
        const imgStr = String(imgName).toLowerCase();
        if (imgStr.includes('рамка') || imgStr.includes('border') || imgStr.includes('frame')) {
          return this.getBorderUrl(imgName);
        }
        return imgName;
      };

      const posX = fData.x !== undefined ? fData.x : 50;
      const posY = fData.y !== undefined ? fData.y : 0;
      const scale = (fData.scale !== undefined ? fData.scale : 100) / 100;
      const opacity = (fData.opacity !== undefined ? fData.opacity : 100) / 100;

      const layerElements = [];
      const renderLayers = activeLayers.length > 0 ? activeLayers : [fData];

      renderLayers.forEach((layer, lIdx) => {
        const layerSrc = resolveLayerSrc(layer);
        if (!layerSrc) return;

        const layerImg = document.createElement('img');
        layerImg.className = 'clean-frame-img';
        layerImg.src = layerSrc;

        const lx = layer.x !== undefined ? layer.x : posX;
        const ly = layer.y !== undefined ? layer.y : posY;
        const lOpacity = (layer.opacity !== undefined ? layer.opacity : (fData.opacity !== undefined ? fData.opacity : 100)) / 100;
        const isStretch = !!(layer.stretch || (layer.stretchX && layer.stretchY));
        const isStretchX = !!(layer.stretchX || layer.stretch);
        const isStretchY = !!(layer.stretchY || layer.stretch);

        layerImg.style.left = isStretchX ? '0%' : `${lx}%`;
        layerImg.style.top = isStretchY ? '0%' : `${ly}%`;
        layerImg.style.opacity = lOpacity;
        layerImg.style.zIndex = layer.layer !== undefined ? layer.layer : (10 + lIdx);
        layerImg.style.objectFit = 'fill';

        layerImg.onload = () => {
          layer._frameNatW = layerImg.naturalWidth;
          layer._frameNatH = layerImg.naturalHeight;
          if (typeof updateFrameLayout === 'function') updateFrameLayout();
        };
        if (layerImg.complete && layerImg.naturalWidth > 0) {
          layer._frameNatW = layerImg.naturalWidth;
          layer._frameNatH = layerImg.naturalHeight;
        }

        layerElements.push({ img: layerImg, layer, isStretch, isStretchX, isStretchY, lx, ly });
        sceneStage.appendChild(layerImg);
      });

      // Поиск слоя с текстовой зоной для позиционирования текста
      let textBoundLayer = renderLayers.slice().reverse().find(l => l && l.textZone) || renderLayers[renderLayers.length - 1] || fData;
      const isInternalCleanFrame = !isTitle && (
        (fData.image && String(fData.image).toLowerCase().includes('рамка 5')) || 
        cleanBase.startsWith('002_') || cleanBase.startsWith('003_') || cleanBase.startsWith('004_') ||
        cleanBase.startsWith('02_') || cleanBase.startsWith('03_') || cleanBase.startsWith('04_') ||
        (overlayData.framePresets && overlayData.framePresets[fData.image] === 'CharaTable')
      );
      const isTitleOrGraphic = isTitle || (!fData.textZone && !textBoundLayer.textZone && (fData.customImage || !isInternalCleanFrame));

      let textSlot = null;
      let textContent = null;

      // Определение настроек диалога и пресета из dialogData
      const candKeys = this.getCandidateSceneKeys(page);

      let bSettings = {};
      for (const k of candKeys) {
        const fullKey = `${k}_block_0`;
        if (dialogData[fullKey]) {
          bSettings = dialogData[fullKey];
          break;
        }
      }

      // Слот текста создается, если есть реплики (blocks > 0) И это карточка персонажа или задана textZone
      const hasTextZone = !!(textBoundLayer && textBoundLayer.textZone) || !!fData.textZone;
      const shouldRenderText = blocks.length > 0 && (hasTextZone || isInternalCleanFrame || !isTitleOrGraphic);

      let matchedPreset = {};
      if (shouldRenderText) {
        textSlot = document.createElement('div');
        textSlot.className = 'clean-frame-text-slot';
        textSlot.style.zIndex = '30';
        textSlot.style.pointerEvents = 'auto';

        textContent = document.createElement('div');
        textContent.className = 'clean-frame-text-content';

        const joinedTexts = blocks.map(b => ScriptParser.stripComments(b)).filter(Boolean).join('\n\n');
        textContent.textContent = joinedTexts;

        const presetName = bSettings.preset 
          || (overlayData.framePresets && (overlayData.framePresets[fData.image] || overlayData.framePresets['internal']))
          || (isInternalCleanFrame ? 'CharaTable' : '_style_1');

        matchedPreset = presets.find(p => p.name === presetName)
          || presets.find(p => p.name === 'CharaTable')
          || presets.find(p => p.name === '_style_1' || p.name.startsWith('_style'))
          || presets[0]
          || {};

        textContent.style.color = matchedPreset.color || (isInternalCleanFrame ? '#000000' : '#ffffff');
        textContent.style.fontFamily = matchedPreset.fontFamily || 'Arial, sans-serif';
        textContent.style.textAlign = matchedPreset.textAlign || (isInternalCleanFrame ? 'center' : 'left');
        textContent.style.lineHeight = matchedPreset.lineHeight || 1.4;
        if (matchedPreset.fontWeight === 'bold') textContent.style.fontWeight = 'bold';

        if (matchedPreset.strokeWidth > 0) {
          textContent.style.webkitTextStroke = `${matchedPreset.strokeWidth}px ${matchedPreset.strokeColor || '#000000'}`;
          textContent.style.textShadow = `-${matchedPreset.strokeWidth}px -${matchedPreset.strokeWidth}px 0 ${matchedPreset.strokeColor || '#000'}, ${matchedPreset.strokeWidth}px ${matchedPreset.strokeWidth}px 0 ${matchedPreset.strokeColor || '#000'}`;
        }

        textSlot.appendChild(textContent);
      }

      // Функция динамического расчета геометрии слоев рамки и адаптивного шрифта
      function updateFrameLayout() {
        const curSceneW = baseImg.naturalWidth || 640;
        const curSceneH = baseImg.naturalHeight || 480;

        layerElements.forEach(({ img, layer, isStretchX, isStretchY, lx, ly }) => {
          if (isStretchX && isStretchY) {
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.left = '0%';
            img.style.top = '0%';
            return;
          }

          const lScale = (layer.scale !== undefined ? layer.scale : (fData.scale !== undefined ? fData.scale : 100)) / 100;
          const lScaleX = (layer.scaleX !== undefined ? layer.scaleX : (layer.scale !== undefined ? layer.scale : (fData.scale !== undefined ? fData.scale : 100))) / 100;
          const lScaleY = (layer.scaleY !== undefined ? layer.scaleY : (layer.scale !== undefined ? layer.scale : (fData.scale !== undefined ? fData.scale : 100))) / 100;

          const natW = layer._frameNatW || img.naturalWidth || fData._frameNatW;
          const natH = layer._frameNatH || img.naturalHeight || fData._frameNatH;

          let widthPercent = 50.4 * lScaleX;
          let heightPercent = 100 * lScaleY;

          if (isStretchX) {
            img.style.width = '100%';
            img.style.left = '0%';
          } else {
            if (natW && curSceneW > 0) {
              widthPercent = ((natW * lScaleX) / curSceneW) * 100;
            } else if (fData.customImage && isTitleOrGraphic) {
              widthPercent = 100 * lScaleX;
            }
            img.style.width = `${widthPercent}%`;
            img.style.left = `${lx}%`;
          }

          if (isStretchY) {
            img.style.height = '100%';
            img.style.top = '0%';
          } else {
            if (natH && curSceneH > 0) {
              heightPercent = ((natH * lScaleY) / curSceneH) * 100;
            } else if (isTitleOrGraphic) {
              heightPercent = 100 * lScaleY;
            }
            img.style.height = isTitleOrGraphic ? 'auto' : `${heightPercent}%`;
            img.style.top = `${ly}%`;
          }
        });

        if (textSlot) {
          const boundLayer = textBoundLayer || fData;
          const boundEl = layerElements.find(le => le.layer === boundLayer) || layerElements[layerElements.length - 1];
          const bImg = boundEl ? boundEl.img : null;

          const isTzStretchX = !!(boundLayer.stretchX || boundLayer.stretch);
          const isTzStretchY = !!(boundLayer.stretchY || boundLayer.stretch);

          const bNatW = boundLayer._frameNatW || (bImg && bImg.naturalWidth) || fData._frameNatW || (isTitleOrGraphic ? curSceneW : 313);
          const bNatH = boundLayer._frameNatH || (bImg && bImg.naturalHeight) || fData._frameNatH || (isTitleOrGraphic ? curSceneH : 470);

          const baseScale = boundLayer.scale !== undefined ? boundLayer.scale : (fData.scale !== undefined ? fData.scale : 100);
          let bScaleX = (boundLayer.scaleX !== undefined ? boundLayer.scaleX : baseScale) / 100;
          let bScaleY = (boundLayer.scaleY !== undefined ? boundLayer.scaleY : baseScale) / 100;

          if (!boundLayer._frameNatW && bNatW <= 550 && bScaleX <= 0.4) {
            const assumedOriginalW = bNatW / bScaleX;
            if (assumedOriginalW >= 700 && assumedOriginalW <= 1600) {
              bScaleX = 1.0;
              bScaleY = 1.0;
            }
          }

          const frameDrawW = isTzStretchX ? curSceneW : (bNatW * bScaleX);
          const frameDrawH = isTzStretchY ? curSceneH : (bNatH * bScaleY);

          const bX = boundLayer.x !== undefined ? boundLayer.x : posX;
          const bY = boundLayer.y !== undefined ? boundLayer.y : posY;

          const frameDrawX = isTzStretchX ? 0 : ((bX / 100) * curSceneW);
          const frameDrawY = isTzStretchY ? 0 : ((bY / 100) * curSceneH);

          // Точная зона текста карточки героини: отступы 5% по бокам и сверху/снизу как в оригинальном редакторе
          const tz = boundLayer.textZone || fData.textZone || { x: 5, y: 5, w: 90, h: 90 };

          const zonePixelX = frameDrawX + (tz.x / 100) * frameDrawW;
          const zonePixelY = frameDrawY + (tz.y / 100) * frameDrawH;
          const zonePixelW = (tz.w / 100) * frameDrawW;
          const zonePixelH = (tz.h / 100) * frameDrawH;

          textSlot.style.left = `${(zonePixelX / curSceneW) * 100}%`;
          textSlot.style.top = `${(zonePixelY / curSceneH) * 100}%`;
          textSlot.style.width = `${(zonePixelW / curSceneW) * 100}%`;
          textSlot.style.height = `${(zonePixelH / curSceneH) * 100}%`;
          textSlot.scrollTop = 0;

          // Масштабирование шрифта под реальное разрешение сцены
          const scaleRatio = curSceneW / 1000;
          const baseFontSize = matchedPreset.fontSize || 24;
          const effectiveFontSize = Math.max(12, Math.round(baseFontSize * scaleRatio));
          if (textContent) {
            textContent.style.fontSize = `${effectiveFontSize}px`;
          }
        }
      }

      if (baseImg.complete && baseImg.naturalWidth > 0) {
        updateFrameLayout();
      } else {
        baseImg.addEventListener('load', updateFrameLayout);
        updateFrameLayout();
      }

      if (textSlot) {
        sceneStage.appendChild(textSlot);
      }
    } 
    // =========================================================================
    // 2. Нижняя диалоговая рамка Visual Novel (Рамка 1 .. Рамка 4)
    // =========================================================================
    else if (blocks.length > 0) {
      const steps = this.getDialogStepsForPage(page);
      const safeStepIdx = Math.max(0, Math.min(dialogBlockIdx, Math.max(0, steps.length - 1)));
      const activeStep = steps[safeStepIdx] || steps[0] || {};

      const borderIdx = (activeStep.borderIdx !== undefined) ? activeStep.borderIdx : (activeStep.charName ? 0 : 3);
      const preset = activeStep.preset || {};
      const charName = activeStep.charName || '';
      const bSettings = activeStep.bSettings || {};

      const frameWrapper = document.createElement('div');
      frameWrapper.className = 'dialog-frame-wrapper';

      // Клик по диалоговой рамке переключает на следующую реплику
      frameWrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        this.nextPage();
      });

      const bCfg = ReaderService.BORDER_CONFIGS[borderIdx] || ReaderService.BORDER_CONFIGS[0];
      const rawTz = activeStep.customTz || bCfg.textZone;
      const tz = {
        x: Math.max(bCfg.textZone.x, rawTz.x !== undefined ? rawTz.x : bCfg.textZone.x),
        y: Math.max(bCfg.textZone.y, rawTz.y !== undefined ? rawTz.y : bCfg.textZone.y),
        w: Math.min(bCfg.textZone.w, rawTz.w !== undefined ? rawTz.w : bCfg.textZone.w),
        h: Math.min(bCfg.textZone.h, rawTz.h !== undefined ? rawTz.h : bCfg.textZone.h)
      };

      // 1. Белая подложка под текст
      const bgSlot = document.createElement('div');
      bgSlot.className = 'dialog-bg-slot';
      bgSlot.style.left = `${bCfg.bgZone.x}%`;
      bgSlot.style.top = `${bCfg.bgZone.y}%`;
      bgSlot.style.width = `${bCfg.bgZone.w}%`;
      bgSlot.style.height = `${bCfg.bgZone.h}%`;
      frameWrapper.appendChild(bgSlot);

      // 2. Портреты согласно конфигурации зон рамки (Рамка 1: слева; Рамка 2: справа; Рамка 3: слева и справа)
      if (bCfg.portraitZones && bCfg.portraitZones.length > 0) {
        bCfg.portraitZones.forEach((pz, pIdx) => {
          try {
            let portraitObj = null;
            if (pIdx === 0) {
              // Основной портрет говорящего персонажа (в Рамке 1 слева, в Рамке 2 справа)
              portraitObj = this.findBestPortrait(portraits, charName, cleanBase, bSettings.portraitName);
            } else if (pIdx === 1) {
              // Второй портрет (в Рамке 3 справа)
              portraitObj = this.findBestPortrait(portraits, '', cleanBase, bSettings.portrait2Name);
            }

            if (portraitObj) {
              const portraitSlot = document.createElement('div');
              portraitSlot.className = `dialog-portrait-slot portrait-${pIdx + 1}`;
              portraitSlot.style.left = `${pz.x}%`;
              portraitSlot.style.top = `${pz.y}%`;
              portraitSlot.style.width = `${pz.w}%`;
              portraitSlot.style.height = `${pz.h}%`;

              this.renderPortraitInSlot(portraitSlot, portraitObj, baseImg);
              frameWrapper.appendChild(portraitSlot);
            }
          } catch (pErr) {
            console.warn('Ошибка рендеринга портрета:', pErr);
          }
        });
      }

      // 3. Металлическая рамка (Рамка 1, 2, 3 или 4)
      const frameBorderImg = document.createElement('img');
      frameBorderImg.className = 'dialog-frame-img';
      frameBorderImg.src = this.getBorderUrl(borderIdx);
      frameWrapper.appendChild(frameBorderImg);

      // 4. Текстовый слот диалога с безопасным отступом от фаски рамки (строго не более 4 строк)
      const textSlot = document.createElement('div');
      textSlot.className = 'dialog-text-slot';
      textSlot.style.left = `${tz.x}%`;
      textSlot.style.top = `${tz.y}%`;
      textSlot.style.width = `${tz.w}%`;
      textSlot.style.height = `${tz.h}%`;

      const textContent = document.createElement('div');
      textContent.className = 'dialog-text-content';

      const stepText = activeStep.text !== undefined 
        ? activeStep.text 
        : (Array.isArray(activeStep.lines) ? activeStep.lines.join('\n') : '');

      // Выделение имени говорящего с четкой контрастной обводкой и отступом (только на первой странице реплики)
      if (charName && (activeStep.isFirstOfSpeaker || activeStep.pageIndex === 0)) {
        const prefix = `${charName}:`;
        let cleanText = stepText;
        if (cleanText.startsWith(prefix)) {
          cleanText = cleanText.slice(prefix.length).trimStart();
        }
        textContent.innerHTML = `<span class="dialog-char-name">${charName}:</span> ${cleanText}`;
      } else {
        textContent.textContent = stepText;
      }

      const baseFontSize = preset.fontSize || 24;
      textContent.style.fontFamily = preset.fontFamily || 'Arial, sans-serif';
      textContent.style.fontSize = `${baseFontSize}px`;
      textContent.style.fontSize = `clamp(${Math.round(baseFontSize * 0.7)}px, ${(baseFontSize / 10.24).toFixed(2)}cqw, ${Math.round(baseFontSize * 1.15)}px)`;
      textContent.style.lineHeight = preset.lineHeight || 1.48;
      textContent.style.color = preset.color || '#000000';
      textContent.style.textAlign = preset.textAlign || 'left';

      if (preset.strokeWidth > 0) {
        textContent.style.webkitTextStroke = `${preset.strokeWidth}px ${preset.strokeColor || '#ffffff'}`;
      }

      textSlot.appendChild(textContent);
      frameWrapper.appendChild(textSlot);
      domBox.appendChild(frameWrapper);

      // Динамическое автомасштабирование: текст идеально вписывается в окно без скроллбара
      const computeAndFit = () => {
        const fwWidth = frameWrapper.clientWidth || 1024;
        const scale = fwWidth / 1024;
        const preferred = Math.max(14, Math.round(baseFontSize * scale));
        this.autoFitDialogText(textSlot, textContent, preferred, 11);
      };

      computeAndFit();
      requestAnimationFrame(computeAndFit);

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          computeAndFit();
        });
        ro.observe(frameWrapper);
        frameWrapper._dialogRo = ro;
      }
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
      this.resolveRawFileUrl(this.pages[nextIdx].rawFile).then(url => {
        if (url) this.pages[nextIdx].url = url;
      }).catch(() => {});
    }
  }

  closeReader() {
    this.isDemoMode = false;
    this.activeDemoImages = null;
    const modal = document.getElementById('reader-modal');
    if (modal) {
      modal.classList.remove('active');
      document.body.classList.remove('modal-open');
      document.body.classList.remove('reader-open');
    }
  }
}

window.reader = new ReaderService(window.store, new ScriptParser());
