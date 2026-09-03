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
      window.app.showToast(`Скрипт "${file.name}" загружен! Определено страниц: ${pages}`, 'success');
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
    if (formTitle) formTitle.textContent = `✏️ Редактирование работы: ${titleRu || titleEn}`;
    if (submitBtn) submitBtn.textContent = '💾 Сохранить изменения работы';
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    if (formCard) {
      formCard.style.borderColor = 'var(--accent-secondary)';
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    window.app.showToast(`Редактирование: "${titleRu || titleEn}"`, 'info');
  }

  cancelEdit() {
    this.editingWorkId = null;

    const form = document.getElementById('admin-add-work-form');
    if (form) form.reset();

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
    const formTitle = document.getElementById('admin-form-card-title');
    const submitBtn = document.getElementById('admin-submit-work-btn');
    const cancelBtn = document.getElementById('admin-cancel-edit-btn');

    if (formTitle) formTitle.textContent = '➕ Регистрация новой работы';
    if (submitBtn) submitBtn.textContent = '✨ Зарегистрировать работу на сайте';
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
    const sampleScriptText = document.getElementById('admin-script-text').value.trim();

    if (!titleRu && !titleEn) {
      window.app.showToast('Введите название работы хотя бы на одном языке', 'error');
      return;
    }

    // Вычисляем число страниц непосредственно из скрипта
    const totalPages = this.calculateTotalPagesFromScript(sampleScriptText);
    const previewPagesCount = Number(document.getElementById('admin-preview-pages-num').value) || 3;
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : ['Перевод'];

    const payload = {
      title: {
        ru: titleRu || titleEn,
        en: titleEn || titleRu
      },
      description: {
        ru: descRu || descEn,
        en: descEn || descRu
      },
      author: author || 'Администратор',
      price: Math.max(1, price),
      totalPages: Math.max(1, totalPages),
      previewPagesCount: Math.min(totalPages, Math.max(1, previewPagesCount)),
      tags,
      sampleScriptText
    };

    if (this.editingWorkId) {
      // Обновление существующей работы
      const updated = this.store.updateWork(this.editingWorkId, payload);
      window.app.showToast(`Изменения в работе "${payload.title.ru}" надежно сохранены!`, 'success');
      this.cancelEdit();
    } else {
      // Добавление новой работы
      const newWork = this.store.addWork(payload);
      window.app.showToast(`Работа "${newWork.title.ru}" успешно зарегистрирована! (страниц: ${totalPages})`, 'success');
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

    if (works.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 2rem; color: var(--text-muted);">Работ пока нет. Зарегистрируйте первую работу в форме выше.</td></tr>`;
      return;
    }

    works.forEach((w, index) => {
      const titleRu = typeof w.title === 'object' ? (w.title.ru || '') : w.title;
      const titleEn = typeof w.title === 'object' ? (w.title.en || '') : (w.originalTitle || '');

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      tr.innerHTML = `
        <td style="padding: 0.85rem 1rem;"><strong>#${index + 1}</strong></td>
        <td style="padding: 0.85rem 1rem;">
          <div style="font-weight: 600; color: var(--text-primary);">${titleRu}</div>
          ${titleEn ? `<div style="font-size: 0.75rem; color: var(--accent-secondary); font-style: italic;">${titleEn}</div>` : ''}
          <div style="font-size: 0.75rem; color: var(--text-muted);">✍️ ${w.author}</div>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <span class="badge badge-accent">${w.price} Орб (${w.price} USDT)</span>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <span class="badge badge-info">${w.previewPagesCount} из ${w.totalPages} стр.</span>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <span style="font-size: 0.8rem; color: var(--text-secondary);">${w.updatedAt ? `Обн. ${w.updatedAt}` : (w.createdAt || 'Недавно')}</span>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-small btn-secondary" onclick="window.admin.editWork('${w.id}')" title="Редактировать работу">✏️ Правка</button>
            <button class="btn btn-small btn-secondary" onclick="window.reader.openPreview('${w.id}')" title="Проверить превью">👁️ Превью</button>
            <button class="btn btn-small btn-danger" onclick="window.admin.handleDeleteWork('${w.id}')" title="Удалить">🗑️</button>
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
    const xpubInput = document.getElementById('admin-xpub-key');
    const networkSelect = document.getElementById('admin-xpub-network');
    const orderIndexEl = document.getElementById('admin-xpub-order-idx');

    if (xpubInput) xpubInput.value = settings.masterPublicKey || '';
    if (networkSelect) networkSelect.value = settings.defaultNetwork || 'USDT (TRC-20)';
    if (orderIndexEl) orderIndexEl.textContent = settings.nextOrderIndex || 100;
  }

  handleXpubSave(e) {
    e.preventDefault();
    const xpub = document.getElementById('admin-xpub-key').value.trim();
    const network = document.getElementById('admin-xpub-network').value;

    if (!xpub) {
      window.app.showToast('Введите Master Public Key (xPub)', 'error');
      return;
    }

    this.store.updateXpubSettings({
      masterPublicKey: xpub,
      defaultNetwork: network
    });

    window.app.showToast('Настройки xPub кошелька сохранены', 'success');
  }
}

window.admin = new AdminService(window.store);
