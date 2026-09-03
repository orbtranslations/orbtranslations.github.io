/**
 * Admin — Управление панелью администратора
 * Позволяет регистрировать новые работы, редактировать существующие,
 * задавать цены в Орбах, указывать количество страниц превью на двух языках (RU / EN),
 * загружать скрипты и настраивать xPub.
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
      window.app.showToast(`Скрипт "${file.name}" успешно прочитан`, 'success');
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
    document.getElementById('admin-work-total-pages').value = work.totalPages;
    document.getElementById('admin-preview-pages-slider').value = work.previewPagesCount;
    document.getElementById('admin-preview-pages-num').value = work.previewPagesCount;
    if (document.getElementById('admin-preview-val')) {
      document.getElementById('admin-preview-val').textContent = work.previewPagesCount;
    }
    document.getElementById('admin-work-tags').value = (work.tags || []).join(', ');
    document.getElementById('admin-work-desc-ru').value = descRu;
    document.getElementById('admin-work-desc-en').value = descEn;
    document.getElementById('admin-script-text').value = work.sampleScriptText || '';

    // Переключение внешнего вида формы
    if (formTitle) formTitle.textContent = `✏️ Редактирование работы: ${titleRu || titleEn}`;
    if (submitBtn) submitBtn.textContent = '💾 Сохранить изменения работы';
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    if (formCard) {
      formCard.style.borderColor = 'var(--accent-secondary)';
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    window.app.showToast(`Режим редактирования: "${titleRu || titleEn}"`, 'info');
  }

  cancelEdit() {
    this.editingWorkId = null;

    const form = document.getElementById('admin-add-work-form');
    if (form) form.reset();

    document.getElementById('admin-preview-pages-slider').value = 3;
    document.getElementById('admin-preview-pages-num').value = 3;
    if (document.getElementById('admin-preview-val')) {
      document.getElementById('admin-preview-val').textContent = 3;
    }

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
    const totalPages = Number(document.getElementById('admin-work-total-pages').value) || 10;
    const previewPagesCount = Number(document.getElementById('admin-preview-pages-num').value) || 3;
    const descRu = document.getElementById('admin-work-desc-ru').value.trim();
    const descEn = document.getElementById('admin-work-desc-en').value.trim();
    const tagsRaw = document.getElementById('admin-work-tags').value.trim();
    const sampleScriptText = document.getElementById('admin-script-text').value.trim();

    if (!titleRu && !titleEn) {
      window.app.showToast('Введите название работы хотя бы на одном языке', 'error');
      return;
    }

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
      window.app.showToast(`Изменения в работе "${payload.title.ru}" сохранены!`, 'success');
      this.cancelEdit();
    } else {
      // Добавление новой работы
      const newWork = this.store.addWork(payload);
      window.app.showToast(`Работа "${newWork.title.ru}" успешно зарегистрирована!`, 'success');
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
