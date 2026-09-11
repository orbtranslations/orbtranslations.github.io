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
  }

  init() {
    this.bindEvents();
    this.renderWorksTable();
    this.loadXpubSettings();
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
  editWork(workId) {
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
    document.getElementById('admin-script-text').value = work.sampleScriptText || '';

    // Автоматический пересчет страниц
    const totalPages = work.totalPages || this.calculateTotalPagesFromScript(work.sampleScriptText);
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

  handleWorkSubmit(e) {
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
      sampleScriptText
    };

    if (this.editingWorkId) {
      // Обновление существующей работы
      const updated = this.store.updateWork(this.editingWorkId, payload);
      window.app.showToast(isEn ? `Changes in work "${payload.title.ru}" successfully saved!` : `Изменения в работе "${payload.title.ru}" надежно сохранены!`, 'success');
      this.cancelEdit();
    } else {
      // Добавление новой работы
      const newWork = this.store.addWork(payload);
      window.app.showToast(isEn ? `Work "${newWork.title.ru}" successfully registered! (pages: ${totalPages})` : `Работа "${newWork.title.ru}" успешно зарегистрирована! (страниц: ${totalPages})`, 'success');
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
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-small btn-secondary" onclick="window.admin.editWork('${w.id}')" title="${isEn ? 'Edit release' : 'Редактировать работу'}">${isEn ? '✏️ Edit' : '✏️ Правка'}</button>
            <button class="btn btn-small btn-secondary" onclick="window.reader.openPreview('${w.id}')" title="${isEn ? 'Preview' : 'Проверить превью'}">${isEn ? '👁️ Preview' : '👁️ Превью'}</button>
            <button class="btn btn-small btn-danger" onclick="window.admin.handleDeleteWork('${w.id}')" title="${isEn ? 'Delete' : 'Удалить'}">🗑️</button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  }

  handleDeleteWork(workId) {
    const work = this.store.getWorkById(workId);
    if (!work) return;

    const title = typeof work.title === 'object' ? (work.title.ru || work.title.en) : work.title;

    if (confirm(`Вы уверены, что хотите удалить работу "${title}"?`)) {
      if (this.editingWorkId === workId) {
        this.cancelEdit();
      }
      this.store.deleteWork(workId);
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
}

window.admin = new AdminService(window.store);
