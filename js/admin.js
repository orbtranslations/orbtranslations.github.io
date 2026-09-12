/**
 * Admin — Управление панелью администратора
 * Позволяет регистрировать новые работы, редактировать существующие,
 * автоматически определяет общее количество страниц из скрипта,
 * задает цены в Орбах, указывает количество страниц превью на двух языках (RU / EN),
 * загружает скрипты и настраивает xPub.
 */
class AdminService {
  constructor(store) {
    this.store = store;
    this.editingWorkId = null;
    this.activeDealsUserId = null;
    this.activeDealsUserName = '';
  }

  init() {
    this.bindEvents();
    this.renderWorksTable();
    this.renderUsersTable();
    this.loadXpubSettings();
    this.loadTelegramSettings();
    this.renderFeedbackTable();
    this.renderDemoImageRows([]);
  }

  bindEvents() {
    const form = document.getElementById('admin-add-work-form');
    if (form) {
      form.addEventListener('submit', (e) => this.handleWorkSubmit(e));
    }

    const cancelBtn = document.getElementById('admin-cancel-edit-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.cancelEdit());
    }

    // Связка ползунка страниц превью и текстового поля
    const previewSlider = document.getElementById('admin-preview-pages-slider');
    const previewNum = document.getElementById('admin-preview-pages-num');
    const previewValBadge = document.getElementById('admin-preview-val');

    if (previewSlider && previewNum) {
      previewSlider.addEventListener('input', () => {
        previewNum.value = previewSlider.value;
        if (previewValBadge) previewValBadge.textContent = previewSlider.value;
      });
      previewNum.addEventListener('input', () => {
        previewSlider.value = previewNum.value;
        if (previewValBadge) previewValBadge.textContent = previewNum.value;
      });
    }

    // Настройки xPub
    const xpubForm = document.getElementById('admin-xpub-form');
    if (xpubForm) {
      xpubForm.addEventListener('submit', (e) => this.handleXpubSave(e));
    }

    // Настройки Telegram
    const tgForm = document.getElementById('admin-telegram-form');
    if (tgForm) {
      tgForm.addEventListener('submit', (e) => this.handleTelegramSettingsSave(e));
    }

    const tgTestBtn = document.getElementById('admin-telegram-test-btn');
    if (tgTestBtn) {
      tgTestBtn.addEventListener('click', () => this.testTelegramNotification());
    }

    const tgToggleShowBtn = document.getElementById('admin-tg-toggle-visibility');
    if (tgToggleShowBtn) {
      tgToggleShowBtn.addEventListener('click', () => {
        const input = document.getElementById('admin-telegram-bot-token');
        if (input) {
          input.type = input.type === 'password' ? 'text' : 'password';
          tgToggleShowBtn.textContent = input.type === 'password' ? '👁️' : '🙈';
        }
      });
    }

    const fbRefreshBtn = document.getElementById('admin-feedback-refresh-btn');
    if (fbRefreshBtn) {
      fbRefreshBtn.addEventListener('click', () => this.renderFeedbackTable());
    }

    // Обработка загрузки файла скрипта
    const scriptInput = document.getElementById('admin-script-file');
    if (scriptInput) {
      scriptInput.addEventListener('change', (e) => this.handleScriptFileUpload(e));
    }

    // Слушатель ввода текста скрипта напрямую в textarea
    const scriptTextarea = document.getElementById('admin-script-text');
    if (scriptTextarea) {
      scriptTextarea.addEventListener('input', () => {
        this.updatePagesFromScript(scriptTextarea.value);
      });
    }

    // Слушатели поля обложки (ввод URL, загрузка локального файла, сброс)
    const coverUrlInput = document.getElementById('admin-work-cover-url');
    const coverFileInput = document.getElementById('admin-work-cover-file');
    const coverClearBtn = document.getElementById('admin-cover-clear-btn');

    if (coverUrlInput) {
      coverUrlInput.addEventListener('input', () => {
        this.updateCoverPreview(coverUrlInput.value.trim());
      });
    }

    if (coverFileInput) {
      coverFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          if (coverUrlInput) {
            coverUrlInput.value = dataUrl;
          }
          this.updateCoverPreview(dataUrl);
          window.app.showToast(`Файл обложки "${file.name}" загружен!`, 'success');
        };
        reader.readAsDataURL(file);
      });
    }

    if (coverClearBtn) {
      coverClearBtn.addEventListener('click', () => {
        if (coverUrlInput) coverUrlInput.value = '';
        if (coverFileInput) coverFileInput.value = '';
        this.updateCoverPreview('');
      });
    }
  }

  /**
   * Обновляет интерактивный предпросмотр обложки в форме администратора
   */
  updateCoverPreview(url) {
    const previewImg = document.getElementById('admin-cover-preview-img');
    const previewBg = document.getElementById('admin-cover-preview-bg');
    const statusBadge = document.getElementById('admin-cover-status-badge');
    const hintText = document.getElementById('admin-cover-hint-text');
    const clearBtn = document.getElementById('admin-cover-clear-btn');
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (!previewImg) return;

    if (url) {
      previewImg.src = url;
      if (previewBg) previewBg.style.backgroundImage = `url("${url}")`;
      previewImg.onerror = () => {
        previewImg.src = 'assets/demo/cover-1.svg';
        if (previewBg) previewBg.style.backgroundImage = 'url("assets/demo/cover-1.svg")';
        if (statusBadge) {
          statusBadge.className = 'badge badge-danger';
          statusBadge.textContent = isEn ? 'Load error' : 'Ошибка загрузки';
        }
        if (hintText) hintText.textContent = isEn ? 'Failed to load image from URL. Please check the link.' : 'Не удалось загрузить изображение по указанной ссылке. Проверьте правильность URL.';
      };
      if (statusBadge) {
        statusBadge.className = 'badge badge-accent';
        statusBadge.textContent = url.startsWith('data:') ? (isEn ? 'Local file' : 'Локальный файл') : (isEn ? 'Link active' : 'Ссылка активна');
      }
      if (hintText) hintText.textContent = isEn ? 'Image scaled completely (object-fit: contain) with ambient backdrop.' : 'Изображение масштабировано целиком (object-fit: contain) с атмосферным фоном.';
      if (clearBtn) clearBtn.style.display = 'inline-flex';
    } else {
      previewImg.src = 'assets/demo/cover-1.svg';
      if (previewBg) previewBg.style.backgroundImage = 'url("assets/demo/cover-1.svg")';
      previewImg.onerror = null;
      if (statusBadge) {
        statusBadge.className = 'badge badge-glass';
        statusBadge.textContent = isEn ? 'Default' : 'По умолчанию';
      }
      if (hintText) hintText.textContent = isEn ? 'This image is displayed on the work card in the catalog and purchases.' : 'Эта иллюстрация отображается на карточке работы в каталоге и в списке покупок.';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }

  /**
   * Вычисляет точное число уникальных сцен/страниц на основе скрипта перевода
   */
  calculateTotalPagesFromScript(scriptText) {
    if (!scriptText || !scriptText.trim()) return 4;
    try {
      const parser = window.scriptParser || new ScriptParser();
      const res = parser.parse(scriptText);
      const pageKeys = new Set();
      if (res.languages && res.languages.length > 0) {
        res.languages.forEach(lang => {
          (res.entries[lang] || []).forEach(e => {
            if (!e.isTitle && e.key !== 'Title') {
              pageKeys.add(e.key || e.filename);
            }
          });
        });
      }
      return Math.max(1, pageKeys.size || 1);
    } catch (e) {
      console.warn('Ошибка вычисления страниц из скрипта:', e);
      return 4;
    }
  }

  /**
   * Обновляет счетчик страниц и максимальный предел ползунка превью
   */
  updatePagesFromScript(scriptText) {
    const totalPages = this.calculateTotalPagesFromScript(scriptText);
    const displayEl = document.getElementById('admin-total-pages-display');
    const hiddenInput = document.getElementById('admin-work-total-pages');
    const slider = document.getElementById('admin-preview-pages-slider');
    const numInput = document.getElementById('admin-preview-pages-num');
    const valBadge = document.getElementById('admin-preview-val');

    if (displayEl) displayEl.textContent = totalPages;
    if (hiddenInput) hiddenInput.value = totalPages;

    if (slider) {
      slider.max = totalPages;
      if (Number(slider.value) > totalPages) {
        slider.value = Math.min(3, totalPages);
      }
    }
    if (numInput) {
      numInput.max = totalPages;
      if (Number(numInput.value) > totalPages) {
        numInput.value = Math.min(3, totalPages);
      }
    }
    if (valBadge && slider) {
      valBadge.textContent = slider.value;
    }
  }

  handleScriptFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const scriptTextarea = document.getElementById('admin-script-text');
      if (scriptTextarea) {
        scriptTextarea.value = text;
      }
      this.updatePagesFromScript(text);
      const pages = this.calculateTotalPagesFromScript(text);
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      window.app.showToast(isEn ? `Script "${file.name}" uploaded! Pages detected: ${pages}` : `Скрипт "${file.name}" загружен! Определено страниц: ${pages}`, 'success');
    };
    reader.readAsText(file);
  }

  /**
   * Вход в режим редактирования существующей работы
   */
  async editWork(workId) {
    const work = this.store.getWorkById(workId);
    if (!work) return;

    this.editingWorkId = workId;

    const formCard = document.getElementById('admin-work-form-card');
    const formTitle = document.getElementById('admin-form-card-title');
    const submitBtn = document.getElementById('admin-submit-work-btn');
    const cancelBtn = document.getElementById('admin-cancel-edit-btn');

    // Заполнение полей формы
    const titleRu = typeof work.title === 'object' ? (work.title.ru || '') : work.title;
    const titleEn = typeof work.title === 'object' ? (work.title.en || '') : (work.originalTitle || '');
    const descRu = typeof work.description === 'object' ? (work.description.ru || '') : work.description;
    const descEn = typeof work.description === 'object' ? (work.description.en || '') : '';

    document.getElementById('admin-work-title-ru').value = titleRu;
    document.getElementById('admin-work-title-en').value = titleEn;
    document.getElementById('admin-work-author').value = work.author || '';
    document.getElementById('admin-work-price').value = work.price;
    document.getElementById('admin-work-tags').value = (work.tags || []).join(', ');
    document.getElementById('admin-work-desc-ru').value = descRu;
    document.getElementById('admin-work-desc-en').value = descEn;
    const coverUrlInput = document.getElementById('admin-work-cover-url');
    if (coverUrlInput) coverUrlInput.value = work.coverUrl || '';
    this.updateCoverPreview(work.coverUrl || '');

    // Заполнение строк демо-изображений
    this.renderDemoImageRows(work.demoImages || []);

    // Загрузка полного скрипта (из памяти или закрытой таблицы Supabase work_scripts)
    const scriptTextarea = document.getElementById('admin-script-text');
    scriptTextarea.value = '⏳ Загрузка полного скрипта...';
    let fullScript = work.fullScriptText || '';
    if (!fullScript || fullScript.startsWith('[STORED_IN_IDB')) {
      fullScript = await this.store.getFullScript(workId);
    }
    if (!fullScript) {
      fullScript = work.sampleScriptText || '';
    }
    scriptTextarea.value = fullScript;

    // Автоматический пересчет страниц
    const totalPages = this.calculateTotalPagesFromScript(fullScript) || work.totalPages || 4;
    const displayEl = document.getElementById('admin-total-pages-display');
    const hiddenInput = document.getElementById('admin-work-total-pages');
    const slider = document.getElementById('admin-preview-pages-slider');
    const numInput = document.getElementById('admin-preview-pages-num');
    const valBadge = document.getElementById('admin-preview-val');

    if (displayEl) displayEl.textContent = totalPages;
    if (hiddenInput) hiddenInput.value = totalPages;

    if (slider) {
      slider.max = totalPages;
      slider.value = Math.min(work.previewPagesCount || 3, totalPages);
    }
    if (numInput) {
      numInput.max = totalPages;
      numInput.value = Math.min(work.previewPagesCount || 3, totalPages);
    }
    if (valBadge && slider) valBadge.textContent = slider.value;

    // Переключение визуального состояния формы
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    if (formTitle) formTitle.textContent = isEn ? `✏️ Edit work: ${titleRu || titleEn}` : `✏️ Редактирование работы: ${titleRu || titleEn}`;
    if (submitBtn) submitBtn.textContent = isEn ? '💾 Save work changes' : '💾 Сохранить изменения работы';
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-flex';
      cancelBtn.textContent = isEn ? '✕ Cancel editing' : '✕ Отмена редактирования';
    }
    if (formCard) {
      formCard.style.borderColor = 'var(--accent-secondary)';
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    window.app.showToast(isEn ? `Editing: "${titleRu || titleEn}"` : `Редактирование: "${titleRu || titleEn}"`, 'info');
  }

  cancelEdit() {
    this.editingWorkId = null;

    const form = document.getElementById('admin-add-work-form');
    if (form) form.reset();

    const coverUrlInput = document.getElementById('admin-work-cover-url');
    const coverFileInput = document.getElementById('admin-work-cover-file');
    if (coverUrlInput) coverUrlInput.value = '';
    if (coverFileInput) coverFileInput.value = '';
    this.updateCoverPreview('');

    // Сброс строк демо-изображений
    this.renderDemoImageRows([]);

    const displayEl = document.getElementById('admin-total-pages-display');
    const hiddenInput = document.getElementById('admin-work-total-pages');
    if (displayEl) displayEl.textContent = '4';
    if (hiddenInput) hiddenInput.value = 4;

    const slider = document.getElementById('admin-preview-pages-slider');
    const numInput = document.getElementById('admin-preview-pages-num');
    const valBadge = document.getElementById('admin-preview-val');

    if (slider) { slider.max = 15; slider.value = 3; }
    if (numInput) { numInput.max = 15; numInput.value = 3; }
    if (valBadge) valBadge.textContent = 3;

    const formCard = document.getElementById('admin-work-form-card');
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const formTitle = document.getElementById('admin-form-card-title');
    const submitBtn = document.getElementById('admin-submit-work-btn');
    const cancelBtn = document.getElementById('admin-cancel-edit-btn');

    if (formTitle) formTitle.textContent = isEn ? '➕ Register New Translation' : '➕ Регистрация новой работы';
    if (submitBtn) submitBtn.textContent = isEn ? '✨ Register Work on Site' : '✨ Зарегистрировать работу на сайте';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (formCard) formCard.style.borderColor = 'var(--border-color)';
  }

  async handleWorkSubmit(e) {
    e.preventDefault();

    const titleRu = document.getElementById('admin-work-title-ru').value.trim();
    const titleEn = document.getElementById('admin-work-title-en').value.trim();
    const author = document.getElementById('admin-work-author').value.trim();
    const price = Number(document.getElementById('admin-work-price').value) || 1;
    const descRu = document.getElementById('admin-work-desc-ru').value.trim();
    const descEn = document.getElementById('admin-work-desc-en').value.trim();
    const tagsRaw = document.getElementById('admin-work-tags').value.trim();
    const coverUrlInput = document.getElementById('admin-work-cover-url');
    const coverUrl = coverUrlInput ? coverUrlInput.value.trim() : '';
    const sampleScriptText = document.getElementById('admin-script-text').value.trim();
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (!titleRu && !titleEn) {
      window.app.showToast(isEn ? 'Enter work title in at least one language' : 'Введите название работы хотя бы на одном языке', 'error');
      return;
    }

    // Вычисляем число страниц непосредственно из скрипта
    const totalPages = this.calculateTotalPagesFromScript(sampleScriptText);
    const previewPagesCount = Number(document.getElementById('admin-preview-pages-num').value) || 3;
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [isEn ? 'Translation' : 'Перевод'];
    const demoImages = this.getDemoImagesFromForm();

    const payload = {
      title: {
        ru: titleRu || titleEn,
        en: titleEn || titleRu
      },
      description: {
        ru: descRu || descEn,
        en: descEn || descRu
      },
      author: author || (isEn ? 'Administrator' : 'Администратор'),
      price: Math.max(1, price),
      totalPages: Math.max(1, totalPages),
      previewPagesCount: Math.min(totalPages, Math.max(1, previewPagesCount)),
      tags,
      coverUrl: coverUrl || 'assets/demo/cover-1.svg',
      demoImages,
      sampleScriptText
    };

    if (this.editingWorkId) {
      // Обновление существующей работы
      const updated = this.store.updateWork(this.editingWorkId, payload);
      window.app.showToast(isEn ? `Changes in work "${payload.title.ru}" saved and secured with RLS!` : `Работа "${payload.title.ru}" сохранена, а скрипт защищен RLS!`, 'success');
      this.cancelEdit();
    } else {
      // Добавление новой работы
      const newWork = this.store.addWork(payload);
      window.app.showToast(isEn ? `Work "${newWork.title.ru}" registered and secured!` : `Работа "${newWork.title.ru}" успешно зарегистрирована и защищена RLS!`, 'success');
      this.cancelEdit();
    }

    this.renderWorksTable();
    window.app.renderStorefront();
  }

  renderWorksTable() {
    const tableBody = document.getElementById('admin-works-table-body');
    if (!tableBody) return;

    const works = this.store.getWorks();
    tableBody.innerHTML = '';

    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (works.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 2rem; color: var(--text-muted);">${isEn ? 'No works yet. Register the first work in the form above.' : 'Работ пока нет. Зарегистрируйте первую работу в форме выше.'}</td></tr>`;
      return;
    }

    works.forEach((w, index) => {
      const titleRu = typeof w.title === 'object' ? (w.title.ru || '') : w.title;
      const titleEn = typeof w.title === 'object' ? (w.title.en || '') : (w.originalTitle || '');

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      tr.style.transition = 'background 0.2s ease';

      tr.innerHTML = `
        <td style="padding: 0.85rem 1rem; font-weight: 600; font-family: monospace; color: var(--accent-secondary);">${w.id}</td>
        <td style="padding: 0.85rem 1rem;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 48px; height: 48px; border-radius: 6px; overflow: hidden; background: #070a13; border: 1px solid var(--border-color); flex-shrink: 0; display: flex; align-items: center; justify-content: center; position: relative;">
              <div style="position: absolute; inset: -4px; background-size: cover; background-position: center; filter: blur(6px) brightness(0.4); background-image: url('${w.coverUrl || 'assets/demo/cover-1.svg'}');"></div>
              <img src="${w.coverUrl || 'assets/demo/cover-1.svg'}" onerror="this.src='assets/demo/cover-1.svg'" alt="Cover" style="position: relative; z-index: 1; max-width: 100%; max-height: 100%; width: auto; height: 100%; object-fit: contain;">
            </div>
            <div>
              <div style="font-weight: 600; color: var(--text-primary);">${titleRu}</div>
              ${titleEn ? `<div style="font-size: 0.75rem; color: var(--accent-secondary); font-style: italic;">${titleEn}</div>` : ''}
              <div style="font-size: 0.75rem; color: var(--text-muted);">✍️ ${w.author}</div>
            </div>
          </div>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <span class="badge badge-accent">${w.price} ${isEn ? 'Orbs' : 'Орб'} (${w.price} USDT)</span>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <span class="badge badge-info">${isEn ? `${w.previewPagesCount} of ${w.totalPages} pages` : `${w.previewPagesCount} из ${w.totalPages} стр.`}</span>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <span style="font-size: 0.8rem; color: var(--text-secondary);">${w.updatedAt ? `${isEn ? 'Upd.' : 'Обн.'} ${w.updatedAt}` : (w.createdAt || (isEn ? 'Recently' : 'Недавно'))}</span>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-small btn-secondary" onclick="window.admin.editWork('${w.id}')" title="${isEn ? 'Edit release' : 'Редактировать работу'}">${isEn ? '✏️ Edit' : '✏️ Правка'}</button>
            <button class="btn btn-small btn-secondary" onclick="window.reader.openPreview('${w.id}')" title="${isEn ? 'Preview' : 'Проверить превью'}">${isEn ? '👁️ Preview' : '👁️ Превью'}</button>
            ${Array.isArray(w.demoImages) && w.demoImages.some(d => d && d.url) ? `<button class="btn btn-small btn-accent" onclick="window.reader.loadDemoImagesForWork('${w.id}')" title="${isEn ? 'Open Demo Preview (Web)' : 'Открыть демо-превью (веб-ссылки)'}">🌐 ${isEn ? 'Demo' : 'Демо'} (${w.demoImages.filter(d => d && d.url).length})</button>` : ''}
            <button class="btn btn-small btn-danger" onclick="window.admin.handleDeleteWork('${w.id}')" title="${isEn ? 'Delete' : 'Удалить'}">🗑️</button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  }

  async handleDeleteWork(workId) {
    const work = this.store.getWorkById(workId);
    if (!work) return;

    const title = typeof work.title === 'object' ? (work.title.ru || work.title.en) : work.title;

    if (confirm(`Вы уверены, что хотите удалить работу "${title}"?`)) {
      if (this.editingWorkId === workId) {
        this.cancelEdit();
      }
      await this.store.deleteWork(workId);
      this.renderWorksTable();
      window.app.renderStorefront();
      window.app.showToast('Работа удалена', 'info');
    }
  }

  loadXpubSettings() {
    const settings = this.store.getXpubSettings();
    const wallets = settings.wallets || {};

    const trc20Input = document.getElementById('admin-wallet-trc20');
    const polInput = document.getElementById('admin-wallet-polygon');
    const btcInput = document.getElementById('admin-wallet-btc');
    const legacyKeyInput = document.getElementById('admin-xpub-key');
    const networkSelect = document.getElementById('admin-xpub-network');
    const orderIndexEl = document.getElementById('admin-xpub-order-idx');

    const trc20Val = wallets['USDT (TRC-20)'] || settings.walletAddress || settings.masterPublicKey || 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW';
    const polVal = wallets['USDT (Polygon)'] || '0x3b890765042948355e0a2b0769119d65fdba99ab';
    const btcVal = wallets['BTC'] || '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe';

    if (trc20Input) trc20Input.value = trc20Val;
    if (polInput) polInput.value = polVal;
    if (btcInput) btcInput.value = btcVal;
    if (legacyKeyInput) legacyKeyInput.value = trc20Val;

    if (networkSelect) {
      let defNet = settings.defaultNetwork || 'USDT (TRC-20)';
      if (defNet === 'USDT (BEP-20)') defNet = 'USDT (TRC-20)';
      networkSelect.value = defNet;
    }
    if (orderIndexEl) orderIndexEl.textContent = settings.nextOrderIndex || 100;
  }

  handleXpubSave(e) {
    e.preventDefault();
    const trc20 = (document.getElementById('admin-wallet-trc20')?.value || document.getElementById('admin-xpub-key')?.value || '').trim() || 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW';
    const pol = (document.getElementById('admin-wallet-polygon')?.value || '').trim() || '0x3b890765042948355e0a2b0769119d65fdba99ab';
    const btc = (document.getElementById('admin-wallet-btc')?.value || '').trim() || '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe';
    const network = document.getElementById('admin-xpub-network')?.value || 'USDT (TRC-20)';

    this.store.updateXpubSettings({
      masterPublicKey: trc20,
      walletAddress: trc20,
      defaultNetwork: network,
      wallets: {
        'USDT (TRC-20)': trc20,
        'USDT (Polygon)': pol,
        'BTC': btc
      }
    });

    if (window.supabaseClient) {
      window.supabaseClient
        .from('wallet_settings')
        .upsert({
          id: 1,
          trc20_address: trc20,
          polygon_address: pol,
          btc_address: btc,
          default_network: network
        })
        .then(() => {})
        .catch(err => console.warn('Сохранение настроек кошельков в Supabase:', err));
    }

    window.app.showToast('Настройки адресов кошельков успешно сохранены!', 'success');
  }

  /**
   * Рендер таблицы зарегистрированных пользователей с возможностью изменения баланса
   */
  async renderUsersTable() {
    const tableBody = document.getElementById('admin-users-table-body');
    if (!tableBody) return;

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">${isEn ? '⏳ Loading users...' : '⏳ Загрузка пользователей...'}</td></tr>`;

    try {
      const users = await this.store.getRegisteredUsers();
      tableBody.innerHTML = '';

      if (!users || users.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">${isEn ? 'No registered users found.' : 'Зарегистрированные пользователи не найдены.'}</td></tr>`;
        return;
      }

      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.style.transition = 'background 0.2s ease';

        const safeId = u.id || '';
        const safeName = u.name || 'User';
        const safeEmail = u.email || '—';
        const role = u.role || 'user';
        const orbs = Number(u.orbs || 0);

        tr.innerHTML = `
          <td style="padding: 0.85rem 1rem;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, rgba(108, 92, 231, 0.3), rgba(0, 206, 201, 0.3)); border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0;">
                ${role === 'admin' ? '👑' : '👤'}
              </div>
              <div>
                <div style="font-weight: 600; color: var(--text-primary);">${safeName}</div>
                <div style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace;">${safeId}</div>
              </div>
            </div>
          </td>
          <td style="padding: 0.85rem 1rem; color: var(--text-secondary); font-size: 0.85rem;">
            ${safeEmail}
          </td>
          <td style="padding: 0.85rem 1rem;">
            <span class="badge ${role === 'admin' ? 'badge-accent' : 'badge-glass'}" style="font-size: 0.75rem;">
              ${role === 'admin' ? (isEn ? '👑 Admin' : '👑 Админ') : (isEn ? '🛡️ User' : '🛡️ Пользователь')}
            </span>
          </td>
          <td style="padding: 0.85rem 1rem;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="number" id="admin-user-orbs-${safeId}" class="input-styled" min="0" step="1" value="${Math.floor(orbs)}" oninput="this.value = this.value.replace(/[^0-9]/g, '')" style="width: 95px; padding: 0.35rem 0.6rem; font-size: 0.85rem; font-weight: 600; text-align: right; color: var(--accent-gold);">
              <span style="font-size: 0.82rem; color: var(--text-muted);">🪙</span>
              <button type="button" class="btn btn-secondary btn-small" onclick="window.admin.handleUserBalanceSave('${safeId}')" style="padding: 0.35rem 0.65rem; font-size: 0.8rem;" title="${isEn ? 'Save balance' : 'Сохранить баланс'}">
                💾
              </button>
            </div>
          </td>
          <td style="padding: 0.85rem 1rem;">
            <button type="button" class="btn btn-secondary btn-small" onclick="window.admin.openUserDealsModal('${safeId}', '${safeName.replace(/'/g, "\\'")}')" style="padding: 0.35rem 0.75rem; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 5px;">
              📜 ${isEn ? 'Deals' : 'Сделки'}
            </button>
          </td>
        `;
        tableBody.appendChild(tr);
      });
    } catch (err) {
      console.error('Ошибка рендера таблицы пользователей:', err);
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #ff6b6b;">${isEn ? 'Failed to load users' : 'Не удалось загрузить список пользователей'}</td></tr>`;
    }
  }

  /**
   * Сохранение нового баланса пользователя
   */
  async handleUserBalanceSave(userId) {
    const input = document.getElementById(`admin-user-orbs-${userId}`);
    if (!input) return;

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const rawVal = input.value.trim();
    const num = Number(rawVal);

    if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
      window.app.showToast(isEn ? 'Orbs cannot be divided! Please enter a whole positive integer (e.g. 10, 50, 100).' : 'Орбы не делятся! Укажите целое неотрицательное число (например, 10, 50, 100).', 'error');
      input.value = Math.max(0, Math.floor(num || 0));
      return;
    }

    const val = Math.floor(num);
    input.value = val;

    try {
      await this.store.updateUserOrbs(userId, val);

      // Если обновился баланс текущего пользователя, обновляем шапку профиля
      if (this.store.data.currentUser && this.store.data.currentUser.id === userId) {
        if (window.app && window.app.renderUserHeader) {
          window.app.renderUserHeader();
        }
      }

      window.app.showToast(isEn ? 'User balance updated successfully!' : 'Баланс пользователя успешно обновлен!', 'success');
    } catch (err) {
      console.error('Ошибка сохранения баланса пользователя:', err);
      window.app.showToast(isEn ? `Failed to update balance: ${err.message}` : `Ошибка сохранения баланса: ${err.message}`, 'error');
    }
  }

  /**
   * Открытие модального окна просмотра сделок конкретного пользователя
   */
  async openUserDealsModal(userId, userName = '') {
    this.activeDealsUserId = userId;
    this.activeDealsUserName = userName || userId;

    const modal = document.getElementById('admin-user-deals-modal');
    const nameEl = document.getElementById('admin-deals-modal-username');
    if (nameEl) {
      nameEl.textContent = this.activeDealsUserName;
    }

    if (modal) {
      modal.classList.add('active');
      document.body.classList.add('modal-open');
    }

    await this.renderUserDealsTable(userId);
  }

  refreshCurrentDealsModal() {
    if (this.activeDealsUserId) {
      this.renderUserDealsTable(this.activeDealsUserId);
    }
  }

  /**
   * Рендер таблицы сделок выбранного пользователя
   */
  async renderUserDealsTable(userId) {
    const tableBody = document.getElementById('admin-user-deals-table-body');
    if (!tableBody) return;

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">${isEn ? '⏳ Loading deals...' : '⏳ Загрузка сделок...'}</td></tr>`;

    try {
      const orders = await this.store.getUserOrders(userId);
      tableBody.innerHTML = '';

      if (!orders || orders.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">${isEn ? 'No deals found for this user.' : 'У этого пользователя пока нет сделок.'}</td></tr>`;
        return;
      }

      orders.forEach(ord => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.style.transition = 'background 0.2s ease';

        const isPurchase = ord.type === 'purchase' || ord.orbs < 0 || String(ord.id).startsWith('ORD-P-');

        // Форматирование даты
        let dateStr = '—';
        if (ord.date) {
          try {
            const d = new Date(ord.date);
            dateStr = d.toLocaleDateString(isEn ? 'en-US' : 'ru-RU', {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit'
            });
          } catch (_) {
            dateStr = String(ord.date).slice(0, 16);
          }
        }

        // Сеть и значок
        let netHtml = '';
        if (isPurchase) {
          netHtml = `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); font-size: 0.72rem; padding: 2px 7px;">🪙 ${isEn ? 'Orb Balance' : 'Баланс Орб'}</span>`;
        } else {
          const net = ord.network || 'USDT';
          let netBadge = 'badge-glass';
          let netIcon = '🔴';
          if (net.includes('Polygon') || net.includes('POL')) {
            netBadge = 'badge-info';
            netIcon = '🟣';
          } else if (net.includes('BTC') || net.includes('Bitcoin')) {
            netBadge = 'badge-gold';
            netIcon = '🟠';
          }
          netHtml = `<span class="badge ${netBadge}" style="font-size: 0.72rem;">${netIcon} ${net}</span>`;
        }

        // Статус
        let statusBadge = '';
        if (isPurchase) {
          statusBadge = `<span class="badge badge-success" style="font-size: 0.75rem;">${isEn ? '✅ Debited' : '✅ Списано'}</span>`;
        } else if (ord.status === 'completed' || ord.status === 'success') {
          statusBadge = `<span class="badge badge-success" style="font-size: 0.75rem;">${isEn ? '✅ Completed' : '✅ Завершено'}</span>`;
        } else if (ord.status === 'cancelled' || ord.status === 'expired') {
          statusBadge = `<span class="badge badge-glass" style="font-size: 0.75rem; color: #ff7675;">${isEn ? '✕ Cancelled' : '✕ Отменена'}</span>`;
        } else if (ord.status === 'awaiting_confirmations') {
          statusBadge = `<span class="badge badge-warning" style="font-size: 0.75rem;">${isEn ? '⛓️ Confirmations' : '⛓️ Подтверждения'}</span>`;
        } else {
          statusBadge = `<span class="badge badge-warning" style="font-size: 0.75rem;">${isEn ? '⏳ Pending' : '⏳ Ожидание'}</span>`;
        }

        // Ссылка на хэш или название работы
        let txHtml = '<span style="color: var(--text-muted);">—</span>';
        if (isPurchase) {
          const work = (this.store && ord.workId) ? this.store.getWorkById(ord.workId) : null;
          let workTitle = '';
          if (work && window.i18n) {
            workTitle = window.i18n.getWorkTitle(work);
          }
          if (!workTitle) {
            if (typeof ord.workTitle === 'object' && ord.workTitle !== null) {
              workTitle = isEn ? (ord.workTitle.en || ord.workTitle.ru) : (ord.workTitle.ru || ord.workTitle.en);
            } else if (typeof ord.workTitle === 'string' && ord.workTitle) {
              workTitle = ord.workTitle;
            }
          }
          if (!workTitle) {
            workTitle = ord.workId || (isEn ? 'Novel Translation' : 'Перевод визуальной новеллы');
          }
          txHtml = `
            <div style="display: flex; flex-direction: column; gap: 2px; max-width: 250px;">
              <span style="color: #60a5fa; font-weight: 600; font-size: 0.8rem; line-height: 1.25; word-break: break-word;" title="${workTitle}">
                📖 ${workTitle}
              </span>
              <span style="color: var(--text-muted); font-size: 0.7rem;">
                ${isEn ? 'Access to full translation' : 'Полный доступ к переводу'}
              </span>
            </div>
          `;
        } else if (ord.txHash) {
          const shortHash = ord.txHash.slice(0, 8) + '...' + ord.txHash.slice(-6);
          if (ord.explorerUrl) {
            txHtml = `<a href="${ord.explorerUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-secondary); font-family: monospace; text-decoration: underline; font-size: 0.78rem;">${shortHash} ↗</a>`;
          } else {
            txHtml = `<span style="font-family: monospace; font-size: 0.78rem;">${shortHash}</span>`;
          }
        }

        // Сумма и Орбы
        const amountStr = isPurchase
          ? `<span style="color: var(--text-secondary); font-weight: 600;">$${Math.abs(Number(ord.amountUsdt || 0)).toFixed(2)}</span>`
          : `<span style="font-weight: 600;">${ord.amountUsdt || '0'}</span>`;

        const orbsStr = isPurchase
          ? `<span style="color: #f87171; font-weight: 700;">-${Math.abs(Math.floor(Number(ord.orbs || 0)))} 🪙</span>`
          : `<span style="color: var(--accent-gold); font-weight: 700;">+${ord.orbs || '0'} 🪙</span>`;

        const typeBadge = isPurchase
          ? `<span class="badge" style="background: rgba(236, 72, 153, 0.15); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.3); font-size: 0.68rem; padding: 1px 6px; margin-top: 2px; display: inline-block;">${isEn ? '📚 Purchase' : '📚 Покупка'}</span>`
          : '';

        tr.innerHTML = `
          <td style="padding: 0.65rem 0.6rem; color: var(--text-secondary); white-space: nowrap;">${dateStr}</td>
          <td style="padding: 0.65rem 0.6rem; font-family: monospace; font-size: 0.75rem; color: var(--accent-secondary); white-space: nowrap;">
            <div>#${ord.id}</div>
            ${typeBadge}
          </td>
          <td style="padding: 0.65rem 0.6rem; white-space: nowrap;">
            ${netHtml}
          </td>
          <td style="padding: 0.65rem 0.6rem; white-space: nowrap;">${amountStr}</td>
          <td style="padding: 0.65rem 0.6rem; white-space: nowrap;">${orbsStr}</td>
          <td style="padding: 0.65rem 0.6rem; white-space: nowrap;">${txHtml}</td>
          <td style="padding: 0.65rem 0.6rem; white-space: nowrap;">${statusBadge}</td>
          <td style="padding: 0.65rem 0.6rem; text-align: center; white-space: nowrap;">
            <button type="button" class="btn btn-secondary btn-small" style="color: #ff6b6b; padding: 2px 7px; font-size: 0.75rem;" onclick="window.admin.handleDeleteSingleDeal('${ord.id}', '${userId}', '${ord.workId || ''}', '${ord.dbId || ''}')" title="${isPurchase ? (isEn ? 'Delete purchase & revoke access' : 'Аннулировать покупку и закрыть доступ') : (isEn ? 'Delete deal' : 'Удалить сделку')}">
              🗑️
            </button>
          </td>
        `;
        tableBody.appendChild(tr);
      });
    } catch (err) {
      console.error('Ошибка загрузки сделок пользователя:', err);
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #ff6b6b;">${isEn ? 'Failed to load deals' : 'Не удалось загрузить историю сделок'}</td></tr>`;
    }
  }

  /**
   * Выборочное удаление одной сделки (с закрытием доступа при покупке)
   */
  async handleDeleteSingleDeal(orderId, userId, workId = '', dbId = '') {
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const isPurchase = String(orderId).startsWith('ORD-P-') || Boolean(workId);
    const confirmMsg = isPurchase
      ? (isEn
          ? 'Delete this purchase deal? This will REVOKE user access to the translation and require repurchasing.'
          : 'Удалить эту сделку о покупке? Это ЗАКРОЕТ полный доступ к работе для пользователя, и её снова нужно будет купить.')
      : (isEn ? 'Delete this deal from history?' : 'Удалить эту сделку из истории?');
    if (!confirm(confirmMsg)) return;

    try {
      if (isPurchase) {
        await this.store.revokeUserPurchase(userId, workId, orderId, dbId);
        window.app.showToast(
          isEn ? 'Purchase deal deleted & translation access revoked' : 'Сделка покупки удалена, доступ к переводу закрыт',
          'info'
        );
      } else {
        await this.store.deleteCryptoOrder(orderId);
        window.app.showToast(isEn ? 'Deal removed from history' : 'Сделка удалена из истории', 'info');
      }
      await this.renderUserDealsTable(userId);
    } catch (err) {
      console.error('Ошибка удаления сделки:', err);
      window.app.showToast(isEn ? 'Failed to delete deal' : 'Не удалось удалить сделку', 'error');
    }
  }

  /**
   * Полное стирание всей истории сделок пользователя (и пополнений, и покупок с закрытием доступа)
   */
  async handleClearAllUserDeals() {
    if (!this.activeDealsUserId) return;

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const confirmMsg = isEn 
      ? 'Are you sure you want to permanently delete ALL deals and REVOKE all purchased access for this user?' 
      : 'Вы уверены, что хотите безвозвратно удалить ВСЮ историю сделок и ЗАКРЫТЬ доступ ко всем купленным работам этого пользователя?';
    if (!confirm(confirmMsg)) return;

    try {
      await this.store.clearUserOrders(this.activeDealsUserId);
      window.app.showToast(
        isEn ? 'All user deals deleted & purchased access revoked' : 'Вся история сделок стёрта, доступ к купленным работам закрыт',
        'info'
      );
      await this.renderUserDealsTable(this.activeDealsUserId);
    } catch (err) {
      console.error('Ошибка очистки сделок:', err);
      window.app.showToast(isEn ? 'Failed to clear deals' : 'Не удалось очистить историю сделок', 'error');
    }
  }

  /**
   * Добавление строки привязки веб-изображения к номеру страницы превью
   */
  addDemoImageRow(page = '', url = '') {
    const container = document.getElementById('admin-demo-images-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'demo-image-row';
    row.style.cssText = 'display: flex; gap: 8px; align-items: center; background: rgba(255, 255, 255, 0.02); padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.05);';

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const pagePlaceholder = window.i18n ? window.i18n.t('admin_demo_page_placeholder') : 'Стр. № (1, 2...)';
    const urlPlaceholder = window.i18n ? window.i18n.t('admin_demo_url_placeholder') : 'https://... прямая ссылка на изображение';

    row.innerHTML = `
      <span style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap;">📄 ${isEn ? 'Page #' : 'Стр. №'}:</span>
      <input type="text" class="input-styled demo-page-num" style="width: 80px; text-align: center; padding: 4px 8px; font-size: 0.82rem;" placeholder="${pagePlaceholder}" value="${page || ''}">
      <span style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap;">🌐 URL:</span>
      <input type="text" class="input-styled demo-image-url" style="flex: 1; padding: 4px 10px; font-size: 0.82rem;" placeholder="${urlPlaceholder}" value="${url || ''}">
      <button type="button" class="btn btn-secondary btn-small" style="padding: 4px 8px; color: var(--accent-danger);" onclick="this.closest('.demo-image-row').remove()" title="${isEn ? 'Remove' : 'Удалить'}">🗑️</button>
    `;

    container.appendChild(row);
  }

  /**
   * Отрисовка всех строк демо-изображений
   */
  renderDemoImageRows(demoImages = []) {
    const container = document.getElementById('admin-demo-images-container');
    if (!container) return;
    container.innerHTML = '';

    if (Array.isArray(demoImages) && demoImages.length > 0) {
      demoImages.forEach(item => {
        if (item) {
          const page = item.page !== undefined ? item.page : (item.num || '');
          const url = item.url || '';
          this.addDemoImageRow(page, url);
        }
      });
    } else if (typeof demoImages === 'object' && demoImages !== null && Object.keys(demoImages).length > 0) {
      Object.entries(demoImages).forEach(([page, url]) => {
        this.addDemoImageRow(page, url);
      });
    } else {
      // По умолчанию создаем 3 пустые строки для удобства (стр. 1, 2, 3)
      this.addDemoImageRow('1', '');
      this.addDemoImageRow('2', '');
      this.addDemoImageRow('3', '');
    }
  }

  /**
   * Сбор списка демо-изображений из полей формы
   */
  getDemoImagesFromForm() {
    const container = document.getElementById('admin-demo-images-container');
    if (!container) return [];

    const rows = container.querySelectorAll('.demo-image-row');
    const result = [];

    rows.forEach((row, idx) => {
      const pageInput = row.querySelector('.demo-page-num');
      const urlInput = row.querySelector('.demo-image-url');

      const rawPage = pageInput ? pageInput.value.trim() : '';
      const url = urlInput ? urlInput.value.trim() : '';

      if (url) {
        const pageNum = rawPage ? (isNaN(Number(rawPage)) ? rawPage : Number(rawPage)) : (idx + 1);
        result.push({
          page: pageNum,
          url: url
        });
      }
    });

    return result;
  }

  /**
   * Мгновенный предпросмотр демо-сцен прямо из полей формы (без сохранения работы)
   */
  testDemoPreviewFromForm() {
    const demoImages = this.getDemoImagesFromForm();
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (!demoImages || demoImages.length === 0) {
      window.app.showToast(
        isEn ? 'Specify at least one demo image URL in the form' : 'Укажите хотя бы одну ссылку на изображение в форме',
        'warning'
      );
      return;
    }

    const scriptText = (document.getElementById('admin-script-text')?.value || '').trim();
    const titleRu = document.getElementById('admin-work-title-ru')?.value.trim() || '';
    const titleEn = document.getElementById('admin-work-title-en')?.value.trim() || '';

    const tempWork = {
      id: this.editingWorkId || 'form-preview',
      title: { ru: titleRu || 'Демо-превью', en: titleEn || 'Demo Preview' },
      previewPagesCount: demoImages.length,
      demoImages: demoImages,
      fullScriptText: scriptText,
      sampleScriptText: scriptText
    };

    window.reader.loadDemoImagesWithData(tempWork, demoImages, scriptText);
  }

  /**
   * Загрузка настроек Telegram в форму панели администратора
   */
  async loadTelegramSettings() {
    const tokenInput = document.getElementById('admin-telegram-bot-token');
    const chatIdInput = document.getElementById('admin-telegram-chat-id');
    const enabledCheckbox = document.getElementById('admin-telegram-enabled');

    if (!tokenInput || !chatIdInput) return;

    try {
      const settings = await this.store.getSiteSettings();
      if (settings) {
        tokenInput.value = settings.telegramBotToken || '';
        chatIdInput.value = settings.telegramChatId || '276204182';
        if (enabledCheckbox) {
          enabledCheckbox.checked = settings.telegramEnabled !== false;
        }
      }
    } catch (err) {
      console.warn('Ошибка загрузки настроек Telegram:', err);
    }
  }

  /**
   * Сохранение настроек Telegram из панели администратора
   */
  async handleTelegramSettingsSave(e) {
    if (e) e.preventDefault();

    const tokenInput = document.getElementById('admin-telegram-bot-token');
    const chatIdInput = document.getElementById('admin-telegram-chat-id');
    const enabledCheckbox = document.getElementById('admin-telegram-enabled');

    const botToken = tokenInput ? tokenInput.value.trim() : '';
    const chatId = chatIdInput ? chatIdInput.value.trim() : '276204182';
    const enabled = enabledCheckbox ? enabledCheckbox.checked : true;

    await this.store.saveSiteSettings({
      telegramBotToken: botToken,
      telegramChatId: chatId,
      telegramEnabled: enabled
    });

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    window.app.showToast(
      isEn ? 'Telegram settings saved successfully!' : 'Настройки Telegram успешно сохранены!',
      'success'
    );
  }

  /**
   * Тестовая отправка сообщения в Telegram для проверки связи
   */
  async testTelegramNotification() {
    const tokenInput = document.getElementById('admin-telegram-bot-token');
    const chatIdInput = document.getElementById('admin-telegram-chat-id');
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    const botToken = tokenInput ? tokenInput.value.trim() : '';
    const chatId = chatIdInput ? chatIdInput.value.trim() : '276204182';

    if (!botToken || !chatId) {
      window.app.showToast(
        isEn ? 'Please enter Bot Token and Chat ID before testing' : 'Пожалуйста, укажите Bot Token и Chat ID перед проверкой',
        'warning'
      );
      return;
    }

    const testBtn = document.getElementById('admin-telegram-test-btn');
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = isEn ? '⏳ Sending test message...' : '⏳ Отправка тестового сообщения...';
    }

    try {
      const testMsg = 
`<b>🧪 Тестовое уведомление из Orb Translations!</b>

✅ Telegram-бот успешно подключен и настроен для приёма обращений пользователей.
🕒 <i>${new Date().toLocaleString('ru-RU')}</i>`;

      const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: testMsg,
          parse_mode: 'HTML'
        })
      });

      const data = await resp.json();
      if (data && data.ok) {
        window.app.showToast(
          isEn ? '✅ Test message successfully delivered to Telegram!' : '✅ Тестовое сообщение успешно доставлено в Telegram!',
          'success'
        );
      } else {
        const errMsg = data?.description || 'Unknown error';
        window.app.showToast(
          (isEn ? '❌ Telegram API Error: ' : '❌ Ошибка Telegram API: ') + errMsg,
          'error'
        );
      }
    } catch (err) {
      window.app.showToast(
        (isEn ? '❌ Network Error: ' : '❌ Сетевая ошибка: ') + (err.message || ''),
        'error'
      );
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.textContent = isEn ? '🧪 Send Test Message to Telegram' : '🧪 Отправить тестовое сообщение в Telegram';
      }
    }
  }

  /**
   * Рендеринг таблицы обращений и тикетов пользователей в панели администратора
   */
  async renderFeedbackTable() {
    const tbody = document.getElementById('admin-feedback-table-body');
    const badgeEl = document.getElementById('admin-feedback-count-badge');
    if (!tbody) return;

    const isEn = window.i18n && window.i18n.getLang() === 'en';
    tbody.innerHTML = `<tr><td colspan="6" style="padding: 1.5rem; text-align: center; color: var(--text-muted);">${isEn ? '⏳ Loading inquiries...' : '⏳ Загрузка обращений...'}</td></tr>`;

    try {
      const list = await this.store.getFeedbackMessages();

      if (badgeEl) {
        const newCount = list.filter(m => m.status === 'new').length;
        badgeEl.textContent = newCount > 0 
          ? (isEn ? `${newCount} new` : `${newCount} нов.`)
          : (isEn ? `${list.length} total` : `Всего: ${list.length}`);
        badgeEl.className = newCount > 0 ? 'badge badge-warning' : 'badge badge-info';
      }

      if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 1.5rem; text-align: center; color: var(--text-muted);">${isEn ? 'No feedback messages found' : 'Обращений пользователей пока нет'}</td></tr>`;
        return;
      }

      const categoryLabels = {
        payment: isEn ? '🪙 Payment & Orbs' : '🪙 Оплата и Орбы',
        reader: isEn ? '📖 Reader / Script Bug' : '📖 Ошибка читалки',
        request: isEn ? '💡 Translation Request' : '💡 Запрос перевода',
        general: isEn ? '❓ General Inquiry' : '❓ Общий вопрос',
        other: isEn ? '📝 Other' : '📝 Другое'
      };

      tbody.innerHTML = list.map(item => {
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleString() : '—';
        const catName = categoryLabels[item.category] || item.category || '—';
        const contact = item.contact_info || item.user_email || '—';
        
        let tgLink = '';
        if (contact.startsWith('@')) {
          tgLink = `https://t.me/${contact.replace('@', '')}`;
        } else if (contact.includes('t.me/')) {
          tgLink = contact.startsWith('http') ? contact : `https://${contact}`;
        }

        const isNew = item.status === 'new' || !item.status;
        const isProgress = item.status === 'in_progress';
        const isResolved = item.status === 'resolved';

        const statusBadge = isNew
          ? `<span class="badge-ticket-new">${isEn ? '🟡 New' : '🟡 Новое'}</span>`
          : isProgress
          ? `<span class="badge-ticket-progress">${isEn ? '🔵 In Progress' : '🔵 В работе'}</span>`
          : `<span class="badge-ticket-resolved">${isEn ? '🟢 Resolved' : '🟢 Решено'}</span>`;

        return `
          <tr style="border-bottom: 1px solid var(--border-color); vertical-align: top;">
            <td style="padding: 0.85rem 1rem; font-size: 0.8rem; color: var(--text-muted); white-space: nowrap;">
              ${dateStr}
            </td>
            <td style="padding: 0.85rem 1rem;">
              <div style="font-weight: 600; color: #f8fafc; word-break: break-all;">
                ${window.ScriptParser?.escapeHtml ? window.ScriptParser.escapeHtml(contact) : contact}
              </div>
              ${item.user_email && item.user_email !== contact ? `<div style="font-size: 0.75rem; color: var(--text-muted);">${item.user_email}</div>` : ''}
              ${item.user_id ? `<span style="font-size: 0.7rem; color: #a78bfa;">👤 ID: ${item.user_id.slice(0, 8)}...</span>` : `<span style="font-size: 0.7rem; color: var(--text-muted);">👤 ${isEn ? 'Guest' : 'Гость'}</span>`}
            </td>
            <td style="padding: 0.85rem 1rem; font-size: 0.82rem; white-space: nowrap;">
              ${catName}
            </td>
            <td style="padding: 0.85rem 1rem; font-size: 0.85rem; color: var(--text-primary); max-width: 340px; word-break: break-word;">
              <div style="white-space: pre-wrap; line-height: 1.45;">${window.ScriptParser?.escapeHtml ? window.ScriptParser.escapeHtml(item.message) : item.message}</div>
            </td>
            <td style="padding: 0.85rem 1rem; white-space: nowrap;">
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <div>${statusBadge}</div>
                <select class="select-styled" style="padding: 3px 6px; font-size: 0.75rem;" onchange="window.admin.handleFeedbackStatusChange('${item.id}', this.value)">
                  <option value="new" ${isNew ? 'selected' : ''}>${isEn ? 'New' : 'Новое'}</option>
                  <option value="in_progress" ${isProgress ? 'selected' : ''}>${isEn ? 'In Progress' : 'В работе'}</option>
                  <option value="resolved" ${isResolved ? 'selected' : ''}>${isEn ? 'Resolved' : 'Решено'}</option>
                </select>
              </div>
            </td>
            <td style="padding: 0.85rem 1rem; white-space: nowrap;">
              <div style="display: flex; gap: 6px; align-items: center;">
                ${tgLink ? `<a href="${tgLink}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-small" style="padding: 3px 8px; font-size: 0.75rem; color: #38bdf8;" title="Написать в Telegram">✈️ TG</a>` : ''}
                <button type="button" class="btn btn-secondary btn-small" style="padding: 3px 8px; font-size: 0.75rem; color: #ff6b6b; border-color: rgba(255, 107, 107, 0.3);" onclick="window.admin.handleFeedbackDelete('${item.id}')" title="Удалить тикет">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Ошибка рендера таблицы обращений:', err);
      tbody.innerHTML = `<tr><td colspan="6" style="padding: 1.5rem; text-align: center; color: #ef4444;">${err.message || 'Ошибка загрузки обращений'}</td></tr>`;
    }
  }

  /**
   * Смена статуса обращения администратором
   */
  async handleFeedbackStatusChange(id, newStatus) {
    if (!id || !newStatus) return;
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    try {
      await this.store.updateFeedbackStatus(id, newStatus);
      window.app.showToast(isEn ? 'Ticket status updated' : 'Статус обращения обновлен', 'success');
      this.renderFeedbackTable();
    } catch (err) {
      window.app.showToast(err.message || 'Ошибка обновления статуса', 'error');
    }
  }

  /**
   * Удаление обращения администратором
   */
  async handleFeedbackDelete(id) {
    if (!id) return;
    const isEn = window.i18n && window.i18n.getLang() === 'en';
    const confirmed = confirm(isEn ? 'Delete this inquiry from database?' : 'Удалить это обращение из базы данных?');
    if (!confirmed) return;

    try {
      await this.store.deleteFeedbackMessage(id);
      window.app.showToast(isEn ? 'Ticket deleted' : 'Обращение удалено', 'success');
      this.renderFeedbackTable();
    } catch (err) {
      window.app.showToast(err.message || 'Ошибка удаления обращения', 'error');
    }
  }
}

window.admin = new AdminService(window.store);

