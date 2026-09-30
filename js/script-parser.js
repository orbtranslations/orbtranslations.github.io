/**
 * Парсер скриптов для приложения наложения текста
 * Обрабатывает специфичный формат текстового файла скриптов перевода.
 */
class ScriptParser {
  constructor() {
    this.knownFiles = new Set();
    this.knownFileToSubfolder = new Map();
  }

  /**
   * Устанавливает список известных названий файлов изображений проекта,
   * которые служат точными триггерами для распознавания кадров при парсинге.
   * @param {Iterable<string|File>|Map|Set} fileListOrMap
   */
  setKnownFiles(fileListOrMap) {
    if (!this.knownFiles) this.knownFiles = new Set();
    if (!this.knownFileToSubfolder) this.knownFileToSubfolder = new Map();
    if (!fileListOrMap) return;

    const addName = (rawName, subfolder = '') => {
      if (!rawName || typeof rawName !== 'string') return;
      const clean = rawName.replace(/\\/g, '/').trim();
      const base = clean.replace(/\.[^/.]+$/, '').trim();
      const nameOnly = clean.split('/').pop().trim();
      const baseOnly = nameOnly.replace(/\.[^/.]+$/, '').trim();

      this.knownFiles.add(clean);
      this.knownFiles.add(clean.toLowerCase());
      this.knownFiles.add(base);
      this.knownFiles.add(base.toLowerCase());
      this.knownFiles.add(nameOnly);
      this.knownFiles.add(nameOnly.toLowerCase());
      this.knownFiles.add(baseOnly);
      this.knownFiles.add(baseOnly.toLowerCase());

      let sub = subfolder;
      if (!sub && clean.includes('/')) {
        const parts = clean.split('/');
        parts.pop();
        sub = parts.join('/');
      }

      if (sub) {
        this.knownFileToSubfolder.set(baseOnly.toLowerCase(), sub);
        this.knownFileToSubfolder.set(nameOnly.toLowerCase(), sub);
        this.knownFileToSubfolder.set(base.toLowerCase(), sub);
        const stripped = baseOnly.replace(/^\d{1,4}_/, '').toLowerCase();
        if (stripped !== baseOnly.toLowerCase()) {
          this.knownFileToSubfolder.set(stripped, sub);
        }
      }
    };

    if (fileListOrMap instanceof Map) {
      for (const [key, val] of fileListOrMap.entries()) {
        let sub = '';
        const rel = (val && (val.webkitRelativePath || val.relativePath)) || (typeof key === 'string' ? key : '');
        if (rel) {
          const normRel = rel.replace(/\\/g, '/');
          const p = normRel.split('/');
          if (p.length > 2) sub = p.slice(1, -1).join('/');
          else if (p.length === 2) sub = p[0];
        }
        addName(key, sub);
        if (val && val.name) addName(val.name, sub);
      }
    } else if (Array.isArray(fileListOrMap) || fileListOrMap instanceof Set) {
      for (const item of fileListOrMap) {
        if (!item) continue;
        if (typeof item === 'string') {
          addName(item);
        } else if (item.name) {
          let sub = '';
          const rel = item.webkitRelativePath || item.relativePath || item.name;
          if (rel) {
            const normRel = rel.replace(/\\/g, '/');
            const p = normRel.split('/');
            if (p.length > 2) sub = p.slice(1, -1).join('/');
            else if (p.length === 2) sub = p[0];
          }
          addName(item.name, sub);
        }
      }
    }
  }

  _isKnownFile(name) {
    if (!name || !this.knownFiles || this.knownFiles.size === 0) return false;
    const clean = name.trim();
    const cleanLower = clean.toLowerCase();
    const cleanNorm = cleanLower.replace(/\\/g, '/');
    const cleanNoExt = cleanNorm.replace(/\.[^/.]+$/, '');
    const cleanBase = cleanNoExt.split('/').pop().trim();
    const stripped = cleanBase.replace(/^\d{1,4}_/, '');

    return (
      this.knownFiles.has(clean) ||
      this.knownFiles.has(cleanLower) ||
      this.knownFiles.has(cleanNorm) ||
      this.knownFiles.has(cleanNoExt) ||
      this.knownFiles.has(cleanBase) ||
      this.knownFiles.has(stripped)
    );
  }

  _getKnownSubfolder(name) {
    if (!name || !this.knownFileToSubfolder || this.knownFileToSubfolder.size === 0) return '';
    const clean = name.replace(/\\/g, '/').replace(/\.[^/.]+$/, '').toLowerCase().trim();
    const nameOnly = clean.split('/').pop().trim();
    if (this.knownFileToSubfolder.has(clean)) {
      return this.knownFileToSubfolder.get(clean);
    }
    if (this.knownFileToSubfolder.has(nameOnly)) {
      return this.knownFileToSubfolder.get(nameOnly);
    }
    const stripped = nameOnly.replace(/^\d{1,4}_/, '');
    if (this.knownFileToSubfolder.has(stripped)) {
      return this.knownFileToSubfolder.get(stripped);
    }
    return '';
  }

  /**
   * Парсит текст скрипта в структурированные данные
   * @param {string} text - Исходный текст файла скрипта
   * @param {Iterable|Map|Set} [optionalKnownFiles=null]
   * @returns {Object} Структурированные данные скрипта
   */
  parse(text, optionalKnownFiles = null) {
    if (optionalKnownFiles) {
      this.setKnownFiles(optionalKnownFiles);
    }

    // Предварительно извлекаем knownFiles из 【OVERLAY_DATA】, если они сохранены в скрипте
    const overlayIdx = text.indexOf('【OVERLAY_DATA】');
    if (overlayIdx !== -1) {
      try {
        const jsonPart = text.substring(overlayIdx + '【OVERLAY_DATA】'.length).trim();
        if (jsonPart) {
          const preOverlay = JSON.parse(jsonPart);
          if (preOverlay && preOverlay.knownFiles && Array.isArray(preOverlay.knownFiles)) {
            this.setKnownFiles(preOverlay.knownFiles);
          }
        }
      } catch (e) {}
    }
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const result = {
      titleMarker: '',
      titleContent: [],
      languages: [],
      entries: {},
      overlayData: null
    };
    
    let state = 'title_marker'; // 'title_marker' -> 'title_content' -> 'language_entries'
    let currentLang = null;
    let currentSubfolder = '';
    let currentEntry = null;
    let expectingFile = true;
    
    // Регулярное выражение для маркера языка: 【LANG】 с возможными пробелами по краям
    const langRegex = /^\s*【([A-Za-zА-Яа-яёЁ]+)】\s*$/;
    const overlayMarker = '【OVERLAY_DATA】';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Проверка на маркер данных наложения (overlay data)
      if (trimmed === overlayMarker || trimmed.startsWith(overlayMarker)) {
        const jsonStart = lines.slice(i + 1).join('\n').trim();
        if (jsonStart) {
          try { 
            result.overlayData = JSON.parse(jsonStart); 
          } catch(e) {
            console.error('Ошибка парсинга overlayData:', e);
          }
        }
        break; // Остаток файла - это JSON
      }
      
      const langMatch = trimmed.match(langRegex);
      const isLang = langMatch && this._isLanguageMarker(langMatch[1]);
      
      if (state === 'title_marker') {
        result.titleMarker = trimmed;
        state = 'title_content';
        continue;
      }
      
      if (state === 'title_content') {
        if (isLang) {
          currentLang = langMatch[1].trim();
          result.languages.push(currentLang);
          result.entries[currentLang] = [];
          state = 'language_entries';
          currentSubfolder = (result.allowedSubfolders && result.allowedSubfolders.length > 0) ? result.allowedSubfolders[0] : '';
          expectingFile = true;
          
          // Separate technical metadata lines and comments from Title dialogue lines
          const rawHeaderLines = result.headerRawLines || [];
          let emptyLineFound = false;
          const techLines = [];
          const dialogLines = [];

          for (const line of rawHeaderLines) {
            const trimmed = line.trim();
            if (!emptyLineFound) {
              if (trimmed === '') {
                emptyLineFound = true;
              } else {
                techLines.push(line);
              }
            } else {
              if (trimmed.startsWith('#')) {
                techLines.push(line);
              } else {
                dialogLines.push(line);
              }
            }
          }

          result.techHeaderLines = techLines;
          result.titleContent = dialogLines;

          // Extract allowed subfolders declared in technical header lines
          result.allowedSubfolders = [];
          techLines.forEach(l => {
            const trimmed = l.trim();
            if (trimmed.endsWith('\\') || trimmed.endsWith('/')) {
              const folderName = trimmed.replace(/[\\/]+$/, '').trim();
              if (folderName && !result.allowedSubfolders.includes(folderName)) {
                result.allowedSubfolders.push(folderName);
              }
            }
          });

          if (result.allowedSubfolders.length > 0) {
            currentSubfolder = result.allowedSubfolders[0];
          }
          continue;
        }

        if (!result.headerRawLines) result.headerRawLines = [];
        result.headerRawLines.push(line);
        continue;
      }
      
      if (state === 'language_entries') {
        if (isLang) {
          // Сохраняем текущую запись перед сменой языка
          if (currentEntry) {
            currentEntry.text = currentEntry.text.trimEnd();
            result.entries[currentLang].push(currentEntry);
            currentEntry = null;
          }
          currentLang = langMatch[1].trim();
          if (!result.languages.includes(currentLang)) {
            result.languages.push(currentLang);
          }
          if (!result.entries[currentLang]) {
             result.entries[currentLang] = [];
          }
          currentSubfolder = (result.allowedSubfolders && result.allowedSubfolders.length > 0) ? result.allowedSubfolders[0] : '';
          expectingFile = true;
          continue;
        }

        // Если строка пустая — переключаем expectingFile в true (следующая строка может быть именем файла)
        if (trimmed === '') {
          expectingFile = true;
          if (currentEntry) {
            currentEntry.text += line + '\n';
          }
          continue;
        }
        
        // Очищаем строку от комментариев для проверки
        const cleanTrimmed = ScriptParser.stripComments(trimmed);
        const folderOnly = cleanTrimmed.replace(/[\\/]+$/, '').trim();
        
        // Если строка является объявлением папки (например "Image\" или "キャラ紹介\")
        if (expectingFile && (cleanTrimmed.endsWith('\\') || cleanTrimmed.endsWith('/') || (result.allowedSubfolders && result.allowedSubfolders.includes(folderOnly)))) {
          if (folderOnly) {
            currentSubfolder = folderOnly;
          }
          expectingFile = true;
          continue;
        }

        const isKnown = this._isKnownFile(cleanTrimmed);
        const isFileRef = (expectingFile || isKnown) && cleanTrimmed !== '' && this._isFileReference(cleanTrimmed);
        
        if (isFileRef) {
          // Это ссылка на файл
          if (currentEntry) {
            currentEntry.text = currentEntry.text.trimEnd();
            result.entries[currentLang].push(currentEntry);
          }
          
          let fileRefStr = cleanTrimmed;
          let aliasStr = null;
          if (cleanTrimmed.includes('=')) {
            const parts = cleanTrimmed.split('=');
            fileRefStr = parts[0].trim();
            aliasStr = parts[1].trim();
          }

          let subfolder, filename;
          const hasBackslash = fileRefStr.includes('\\');
          const hasSlash = fileRefStr.includes('/');
          if (hasBackslash || hasSlash) {
            const normalized = fileRefStr.replace(/\\+/g, '/');
            const lastSlash = normalized.lastIndexOf('/');
            subfolder = normalized.substring(0, lastSlash);
            filename = normalized.substring(lastSlash + 1);
            currentSubfolder = subfolder;
          } else {
            const knownSub = this._getKnownSubfolder(fileRefStr);
            if (knownSub) {
              subfolder = knownSub;
              currentSubfolder = knownSub;
            } else {
              subfolder = currentSubfolder;
            }
            filename = fileRefStr;
          }
          
          const key = subfolder ? subfolder + '/' + filename : filename;
          let targetKey = null;

          if (aliasStr) {
            if (aliasStr.includes('\\') || aliasStr.includes('/')) {
              targetKey = aliasStr.replace(/\\+/g, '/');
            } else {
              targetKey = subfolder ? subfolder + '/' + aliasStr : aliasStr;
            }
          }

          currentEntry = { key, subfolder, filename, alias: aliasStr, targetKey, rawLine: line, text: '' };
          expectingFile = false;
          continue;
        }
        
        // Обычная строка текста (включая строки с описаниями параметров, рост, и т.д.)
        if (currentEntry) {
          currentEntry.text += line + '\n';
        }
        expectingFile = false;
      }
    }
    
    // Сохраняем последнюю запись
    if (currentEntry) {
      currentEntry.text = currentEntry.text.trimEnd();
      if (currentLang && result.entries[currentLang]) {
          result.entries[currentLang].push(currentEntry);
      }
    }
    
    // Удаляем завершающие пустые строки из titleContent
    while (result.titleContent.length > 0 && result.titleContent[result.titleContent.length - 1].trim() === '') {
      result.titleContent.pop();
    }

    // Если указан titleMarker (например, "Title"), добавляем его как первую запись для каждого языка
    if (result.titleMarker) {
      for (const lang of result.languages) {
        if (!result.entries[lang]) result.entries[lang] = [];
        const hasTitle = result.entries[lang].some(e => e.key.toLowerCase() === result.titleMarker.toLowerCase());
        if (!hasTitle) {
          result.entries[lang].unshift({
            key: result.titleMarker,
            subfolder: '',
            filename: result.titleMarker,
            isTitle: true,
            rawLine: result.titleMarker,
            text: result.titleContent.join('\n')
          });
        }
      }
    }
    
    return result;
  }

  /**
   * Получить ключи изображений для конкретного языка
   * @param {Object} parsed 
   * @param {string} lang 
   * @returns {string[]}
   */
  getImageKeys(parsed, lang) {
    if (!parsed || !parsed.entries) return [];
    const entries = parsed.entries[lang] || [];
    return entries.map(e => e.key);
  }

  /**
   * Проверяет, является ли метка языка действительно маркером языка (RUS, JAP, ENG, JPN и т.д.),
   * а не заголовочным блоком вида 【Заголовок】 или 【СЮЖЕТ】
   * @param {string} str 
   * @returns {boolean}
   */
  _isLanguageMarker(str) {
    if (!str) return false;
    const s = str.trim().toUpperCase();
    const known = [
      'RUS', 'JAP', 'JPN', 'ENG', 'RU', 'JP', 'EN', 'KOR', 'CHI', 'ZH', 
      'ESP', 'GER', 'FRA', 'ITA', 'UKR', 'POR', 'CYS', 'LAT', 'FRE'
    ];
    if (known.includes(s)) return true;
    return /^[A-Z]{2,4}$/.test(s);
  }

  /**
   * Проверяет, является ли строка ссылкой на файл изображения
   * @param {string} line 
   * @returns {boolean}
   */
  _isFileReference(line) {
    if (!line) return false;
    const clean = ScriptParser.stripComments(line).trim();
    if (!clean) return false;

    // Содержит пробелы -> точно не ссылка на файл
    if (/\s/.test(clean)) return false;

    // Содержит русский текст или знаки пунктуации предложений -> не файл
    if (/[а-яА-ЯёЁ:;!?()\[\]{}"'«»]/.test(clean)) return false;

    const target = clean.includes('=') ? clean.split('=')[0].trim() : clean;
    if (!target) return false;

    // 0. ПРОВЕРКА ПО СПИСКУ ИЗВЕСТНЫХ ФАЙЛОВ ПРОЕКТА (ТРИГГЕРЫ ИМЁН ФАЙЛОВ)
    if (this._isKnownFile(target) || this._isKnownFile(clean)) {
      return true;
    }

    // 1. Содержит слэш или бэкслеш (например, ImageM\06-01A или vol1のキャラ紹介\01_ChichibuHasami)
    if (target.includes('\\') || target.includes('/')) {
      const targetNorm = target.replace(/\\/g, '/');
      const filenamePart = targetNorm.split('/').pop().trim();
      if (this._isKnownFile(filenamePart) || this._isKnownFile(targetNorm)) return true;
      if (filenamePart && this._isFileReference(filenamePart)) return true;
      if (/\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(filenamePart)) return true;
    }

    // 2. Расширение файла (например, 06-01A.png, 01_ChichibuHasami.jpg)
    if (/\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(target)) {
      return true;
    }

    // 3. Алиас (например, 00-02=00-01)
    if (clean.includes('=')) {
      return /^[a-zA-Z0-9_.\-]+=[a-zA-Z0-9_.\-\\/]+$/.test(clean);
    }

    // 4. Форматы нумерации кадров и карточек персонажей/сцен:
    // - "00-01", "01-01-02", "01-03-01Z", "02-02-11", "002_01_03" (любое количество цифровых блоков через - или _)
    if (/^(\d+[-_])+\d+[a-zA-Z0-9_]*$/i.test(target)) return true;

    // - "scene01-02-03", "cg_01-01", "c01-p02-03" (префиксы сцен с разделителями)
    if (/^[a-zA-Z]+[-_]?\d+([-_]\d+)+[a-zA-Z0-9_]*$/i.test(target)) return true;

    // - "page-01", "scene-01", "cg-01", "bg-01"
    if (/^[a-zA-Z]{2,10}[-_]\d{1,4}[a-zA-Z0-9_]*$/i.test(target)) return true;

    // - "01_ChichibuHasami", "002_01_ChichibuHasami", "02_Kureha"
    if (/^\d{1,4}_[a-zA-Z0-9_]+$/i.test(target)) return true;

    // - "cg01_hasami", "ev01_scene"
    if (/^[a-zA-Z]{1,6}\d{1,4}_[a-zA-Z0-9_]+$/i.test(target)) return true;

    // - "01-02Z", "02-00" (двухблочные с буквенными суффиксами)
    if (/^\d+[-_]\d+[a-zA-Z0-9_]*$/i.test(target)) return true;

    // - Обобщенный паттерн идентификатора кадра: буквенно-цифровые токены, разделенные дефисами или подчеркиваниями
    if (/^[a-zA-Z0-9]+([-_][a-zA-Z0-9]+)+$/i.test(target)) return true;

    return false;
  }

  /**
   * Сериализует распарсенные данные и данные наложения обратно в текст скрипта
   * @param {Object} parsed - Распарсенные данные скрипта
   * @param {Object} overlayData - Настройки наложения для добавления
   * @returns {string} Полный текст скрипта с добавленными данными наложения
   */
  serialize(parsed, overlayData) {
    let out = [];
    
    // Синхронизируем titleContent с записью Title, если она была отредактирована
    let titleContentLines = parsed.titleContent || [];
    if (parsed.languages && parsed.languages.length > 0) {
      const firstLang = parsed.languages[0];
      const titleEntry = (parsed.entries[firstLang] || []).find(e => e.isTitle || (parsed.titleMarker && e.key.toLowerCase() === parsed.titleMarker.toLowerCase() && !e.subfolder));
      if (titleEntry && typeof titleEntry.text === 'string') {
        titleContentLines = titleEntry.text.split('\n');
      }
    }

    if (parsed.titleMarker) {
      out.push(parsed.titleMarker);
    }
    if (parsed.techHeaderLines && parsed.techHeaderLines.length > 0) {
      out.push(...parsed.techHeaderLines);
    }
    if (titleContentLines && titleContentLines.length > 0) {
      out.push('');
      out.push(...titleContentLines);
    }
    out.push('');
    
    for (const lang of parsed.languages) {
      out.push(` 【${lang}】`);
      out.push('');
      
      const entries = parsed.entries[lang] || [];
      
      for (const entry of entries) {
        // Пропускаем запись Title внутри языковой секции, так как она выводится в начале файла
        if (entry.isTitle || (parsed.titleMarker && entry.key.toLowerCase() === parsed.titleMarker.toLowerCase() && !entry.subfolder)) {
          continue;
        }

        let fileRef = entry.filename;
        if (entry.alias) {
          fileRef += '=' + entry.alias;
        }

        out.push(fileRef);
        out.push(entry.text);
        out.push('');
      }
    }
    
    let result = out.join('\n').trim() + '\n\n';
    
    if (overlayData) {
      const cleanData = { ...overlayData };
      if (cleanData.portraits && Array.isArray(cleanData.portraits)) {
        cleanData.portraits = cleanData.portraits.map(p => ({
          name: p.name,
          sourceImage: p.sourceImage || '',
          crop: p.crop || null
        }));
      }
      result += '【OVERLAY_DATA】\n' + JSON.stringify(cleanData, null, 2) + '\n';
    }
    
    return result;
  }

  /**
   * Получает все уникальные ключи изображений из всех языков
   * @param {Object} parsed - Распарсенные данные скрипта
   * @returns {string[]} Массив ключей изображений (например, ["ImageM/00-01", "ImageM/00-02"])
   */
  getImageKeys(parsed, lang) {
    if (!parsed || !parsed.entries) return [];
    const entries = parsed.entries[lang] || [];
    return entries.map(e => e.key);
  }

  stringify(parsed, overlayData) {
    return this.serialize(parsed, overlayData);
  }

  /**
   * Получает упорядоченный список всех ключей изображений с сохранением повторных вхождений
   * @param {Object} parsed - Распарсенные данные скрипта
   * @param {string} [preferredLang] - Предпочтительный язык для порядка сцен
   * @returns {string[]} Массив ключей изображений
   */
  getAllImageKeys(parsed, preferredLang) {
    if (!parsed) return [];
    
    // Если передан preferredLang (или берется первый доступный язык), сохраняем последовательность с повторами
    const targetLang = preferredLang || (parsed.languages && parsed.languages.length > 0 ? parsed.languages[0] : null);
    if (targetLang && parsed.entries && parsed.entries[targetLang] && parsed.entries[targetLang].length > 0) {
      const keys = parsed.entries[targetLang].map(e => e.key);
      
      // Если в других языках есть уникальные ключи, не встречавшиеся в targetLang, добавляем их в конец
      if (parsed.languages) {
        const existingSet = new Set(keys);
        for (const lang of parsed.languages) {
          if (lang === targetLang) continue;
          const otherEntries = parsed.entries[lang] || [];
          for (const entry of otherEntries) {
            if (!existingSet.has(entry.key)) {
              existingSet.add(entry.key);
              keys.push(entry.key);
            }
          }
        }
      }
      return keys;
    }
    
    // Резервный вариант, если языковые записи отсутствуют
    const keys = [];
    const seen = new Set();
    if (parsed.titleMarker) {
      keys.push(parsed.titleMarker);
      seen.add(parsed.titleMarker);
    }
    
    for (const lang of (parsed.languages || [])) {
      const entries = (parsed.entries ? parsed.entries[lang] : []) || [];
      for (const entry of entries) {
        if (!seen.has(entry.key)) {
          seen.add(entry.key);
          keys.push(entry.key);
        }
      }
    }
    
    return keys;
  }

  /**
   * Удаляет комментарии вида #(коммент), # коммент или строки начинающиеся с #
   * @param {string} str 
   * @returns {string}
   */
  static stripComments(str) {
    if (!str) return '';
    return str
      .replace(/#\([^)]*\)/g, '')
      .split('\n')
      .filter(line => !line.trim().startsWith('#'))
      .map(line => line.replace(/(^|\s)#.*$/, '$1'))
      .join('\n')
      .trim();
  }

  /**
   * Разделяет текст записи на отдельные независимые текстовые блоки (по пустым строкам)
   * @param {string} text 
   * @returns {string[]}
   */
  static getBlocks(text) {
    if (!text) return [];
    return text
      .split(/\n\s*\n+/)
      .map(b => ScriptParser.stripComments(b))
      .filter(b => b && b.length > 0);
  }

  /**
   * Объединяет массив текстовых блоков обратно в единый текст с пустыми строками
   * @param {string[]} blocks 
   * @returns {string}
   */
  static joinBlocks(blocks) {
    if (!Array.isArray(blocks)) return '';
    return blocks.filter(b => b && b.trim()).join('\n\n');
  }


  static generatePreviewSlice(fullScriptText, previewPagesCount = 3, demoImages = []) {
    try {
      const parser = new ScriptParser();
      const parsed = parser.parse(fullScriptText);
      const keptKeys = new Set();

      const demoPageNumbers = new Set();
      const demoKeys = new Set();
      if (Array.isArray(demoImages)) {
        demoImages.forEach(item => {
          if (!item) return;
          const p = item.page !== undefined ? item.page : (item.num || item.key || '');
          if (!isNaN(Number(p)) && Number(p) > 0) {
            demoPageNumbers.add(Number(p));
          } else if (p) {
            demoKeys.add(String(p).toLowerCase().trim());
          }
          if (item.key) demoKeys.add(String(item.key).toLowerCase().trim());
        });
      } else if (demoImages && typeof demoImages === 'object') {
        Object.keys(demoImages).forEach(k => {
          if (!isNaN(Number(k)) && Number(k) > 0) {
            demoPageNumbers.add(Number(k));
          } else {
            demoKeys.add(String(k).toLowerCase().trim());
          }
        });
      }

      if (parsed.titleMarker) {
        keptKeys.add(parsed.titleMarker);
      }

      if (parsed.languages && Array.isArray(parsed.languages)) {
        for (const lang of parsed.languages) {
          if (parsed.entries && parsed.entries[lang]) {
            parsed.entries[lang] = parsed.entries[lang].filter((entry, idx) => {
              if (idx < previewPagesCount) return true;
              const pageNum = idx + 1;
              if (demoPageNumbers.has(pageNum)) return true;
              const kLower = (entry.key || '').toLowerCase();
              const targetLower = (entry.targetKey || '').toLowerCase();
              const pureLower = kLower.split(/[\/\\]/).pop().replace(/\.[^/.]+$/, '');
              return demoKeys.has(kLower) || demoKeys.has(targetLower) || demoKeys.has(pureLower);
            });
            for (const entry of parsed.entries[lang]) {
              if (entry.key) keptKeys.add(entry.key);
            }
          }
        }
      }

      let out = [];
      if (parsed.titleMarker) {
        out.push(parsed.titleMarker);
      }
      if (parsed.techHeaderLines && parsed.techHeaderLines.length > 0) {
        out.push(...parsed.techHeaderLines);
      }
      if (parsed.titleContent && parsed.titleContent.length > 0) {
        out.push('');
        out.push(...parsed.titleContent);
      }
      out.push('');

      if (parsed.languages && Array.isArray(parsed.languages)) {
        for (const lang of parsed.languages) {
          out.push(`【${lang}】`);
          out.push('');
          const entries = parsed.entries[lang] || [];
          let lastSubfolder = '';
          for (const entry of entries) {
            if (entry.isTitle || (parsed.titleMarker && entry.key.toLowerCase() === parsed.titleMarker.toLowerCase() && !entry.subfolder)) {
              continue;
            }
            let fileRef = entry.filename;
            if (entry.subfolder && entry.subfolder !== lastSubfolder) {
               fileRef = entry.subfolder.replace(/\//g, '\\') + '\\' + entry.filename;
               lastSubfolder = entry.subfolder;
            } else if (!entry.subfolder) {
               lastSubfolder = '';
            }
            if (entry.alias) {
              fileRef += '=' + entry.alias;
            }
            out.push(fileRef);
            out.push(entry.text);
            out.push('');
          }
        }
      }

      // 3. Секция OVERLAY_DATA: фильтруем, оставляя координаты только для превью-записей
      if (parsed.overlayData && typeof parsed.overlayData === 'object') {
        const rawOverlay = parsed.overlayData;
        const filteredDialogData = {};
        const usedPortraits = new Set();

        if (rawOverlay.dialogData && typeof rawOverlay.dialogData === 'object') {
          for (const [blockKey, bSettings] of Object.entries(rawOverlay.dialogData)) {
            const baseTarget = blockKey.split('_block_')[0];
            const normBase = baseTarget.replace(/\\/g, '/');
            const pureBase = normBase.split('/').pop();
            const cleanNormBase = normBase.replace(/__occ\d+$/, '');
            const cleanPureBase = pureBase.replace(/__occ\d+$/, '');

            if (
              keptKeys.has(baseTarget) ||
              keptKeys.has(normBase) ||
              keptKeys.has(pureBase) ||
              keptKeys.has(cleanNormBase) ||
              keptKeys.has(cleanPureBase)
            ) {
              filteredDialogData[blockKey] = bSettings;
              if (bSettings && bSettings.portraitName) {
                usedPortraits.add(bSettings.portraitName);
              }
              if (bSettings && bSettings.portrait2Name) {
                usedPortraits.add(bSettings.portrait2Name);
              }
            }
          }
        }

        let filteredPortraits;
        if (Array.isArray(rawOverlay.portraits)) {
          filteredPortraits = rawOverlay.portraits.filter((p, idx) => {
            if (!p) return false;
            const pName = p.name || '';
            return usedPortraits.has(pName) || idx < 30;
          });
        } else if (rawOverlay.portraits && typeof rawOverlay.portraits === 'object') {
          filteredPortraits = {};
          let portraitCount = 0;
          for (const [pName, pObj] of Object.entries(rawOverlay.portraits)) {
            const effectiveName = (pObj && pObj.name) || pName;
            if (usedPortraits.has(pName) || usedPortraits.has(effectiveName) || portraitCount < 30) {
              filteredPortraits[pName] = pObj;
              portraitCount++;
            }
          }
        } else {
          filteredPortraits = [];
        }

        const cleanOverlay = {
          ...rawOverlay,
          dialogData: filteredDialogData,
          portraits: filteredPortraits
        };

        out.push('【OVERLAY_DATA】');
        out.push(JSON.stringify(cleanOverlay, null, 2));
      }

      return out.join('\n');
    } catch (err) {
      console.warn('Ошибка нарезки превью-скрипта:', err);
      return fullScriptText.slice(0, 3000);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScriptParser;
}
if (typeof global !== 'undefined') {
  global.ScriptParser = ScriptParser;
}
if (typeof window !== 'undefined') {
  window.ScriptParser = ScriptParser;
  window.scriptParser = new ScriptParser();
}
