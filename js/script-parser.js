/**
 * Парсер скриптов для приложения наложения текста
 * Обрабатывает специфичный формат текстового файла скриптов перевода.
 */
class ScriptParser {
  /**
   * Парсит текст скрипта в структурированные данные
   * @param {string} text - Исходный текст файла скрипта
   * @returns {Object} Структурированные данные скрипта
   */
  parse(text) {
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

        const isFileRef = expectingFile && cleanTrimmed !== '' && this._isFileReference(cleanTrimmed);
        
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
            subfolder = currentSubfolder;
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

    // 1. Содержит слэш или бэкслеш (например, ImageM\06-01A или Char/01_ChichibuHasami)
    if (target.includes('\\') || target.includes('/')) {
      return /^[a-zA-Z0-9_.\-\\/]+$/.test(target);
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
    // - "00-01", "00-02", "01-01A", "10_02", "02-00"
    if (/^\d+[-_]\d+[a-zA-Z0-9_]*$/i.test(target)) return true;
    // - "scene01-02", "cg_01-01", "c01-p02"
    if (/^[a-zA-Z]+[-_]?\d+[-_]\d+[a-zA-Z0-9_]*$/i.test(target)) return true;
    // - "page-01", "scene-01"
    if (/^[a-zA-Z]{2,10}[-_]\d{1,4}[a-zA-Z0-9_]*$/i.test(target)) return true;
    // - "01_ChichibuHasami", "02_Kureha"
    if (/^\d{1,3}_[a-zA-Z0-9_]+$/i.test(target)) return true;
    // - "cg01_hasami"
    if (/^[a-zA-Z]{1,6}\d{1,3}_[a-zA-Z0-9_]+$/i.test(target)) return true;

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
      let lastSubfolder = '';
      
      for (const entry of entries) {
        // Пропускаем запись Title внутри языковой секции, так как она выводится в начале файла
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

  getAllImageKeys(parsed) {
    const keys = new Set();
    if (parsed && parsed.titleMarker) {
      keys.add(parsed.titleMarker);
    }
    
    for (const lang of (parsed && parsed.languages ? parsed.languages : [])) {
      const entries = (parsed && parsed.entries ? parsed.entries[lang] : []) || [];
      for (const entry of entries) {
        keys.add(entry.key);
      }
    }
    
    return Array.from(keys);
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

  /**
   * Генерирует безопасную выжимку скрипта только для превью-страниц (первые N страниц).
   * Удаляет весь остальной текст истории и лишние координаты, защищая полный перевод от утечки.
   * @param {string} fullScriptText - Исходный полный скрипт
   * @param {number} previewPagesCount - Количество разрешенных превью страниц (по умолчанию 3)
   * @returns {string} Безопасный урезанный скрипт для публичного каталога
   */
  static generatePreviewSlice(fullScriptText, previewPagesCount = 3) {
    if (!fullScriptText || typeof fullScriptText !== 'string' || !fullScriptText.trim()) {
      return '';
    }

    try {
      const parser = new ScriptParser();
      const parsed = parser.parse(fullScriptText);

      if (!parsed || !parsed.languages || parsed.languages.length === 0) {
        // Если структура нестандартная, отдаем только первые 2000 символов
        return fullScriptText.slice(0, 2000);
      }

      const limit = Math.max(1, Number(previewPagesCount) || 3);
      const keptKeys = new Set();
      const out = [];

      // 1. Заголовок и технические строки папок
      out.push(parsed.titleMarker || 'Title');
      if (parsed.techHeaderLines && parsed.techHeaderLines.length > 0) {
        parsed.techHeaderLines.forEach(l => out.push(l));
      }
      if (parsed.titleContent && parsed.titleContent.length > 0) {
        parsed.titleContent.forEach(l => out.push(l));
      }
      out.push('');

      // 2. Для каждого языка сохраняем только первые limit записей
      parsed.languages.forEach(lang => {
        out.push(`【${lang}】`);
        out.push('');

        const entries = parsed.entries[lang] || [];
        const sliceEntries = entries.slice(0, limit);

        sliceEntries.forEach(entry => {
          // Регистрируем ключ для фильтрации OVERLAY_DATA
          const normKey = (entry.key || '').replace(/\\/g, '/');
          const pureName = normKey.split('/').pop();
          const targetNorm = (entry.targetKey || '').replace(/\\/g, '/');
          const pureTarget = targetNorm.split('/').pop();

          if (entry.key) keptKeys.add(entry.key);
          if (normKey) keptKeys.add(normKey);
          if (pureName) keptKeys.add(pureName);
          if (entry.targetKey) keptKeys.add(entry.targetKey);
          if (targetNorm) keptKeys.add(targetNorm);
          if (pureTarget) keptKeys.add(pureTarget);

          // Записываем заголовок записи
          if (entry.rawLine) {
            out.push(entry.rawLine);
          } else if (entry.alias) {
            out.push(`${entry.key}=${entry.alias}`);
          } else {
            out.push(entry.key);
          }

          // Текст диалогов текущей превью-записи
          if (entry.text) {
            out.push(entry.text.trimEnd());
          }
          out.push('');
        });
      });

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

            if (keptKeys.has(baseTarget) || keptKeys.has(normBase) || keptKeys.has(pureBase)) {
              filteredDialogData[blockKey] = bSettings;
              if (bSettings && bSettings.portraitName) {
                usedPortraits.add(bSettings.portraitName);
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

if (typeof module !== 'undefined') {
  module.exports = ScriptParser;
}
