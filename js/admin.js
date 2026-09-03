/**
 * Admin — Управление панелью администратора
 * Позволяет регистрировать новые работы, задавать цену в Орбах,
 * указывать количество страниц превью, загружать скрипты и настраивать xPub.
 */
class AdminService {
  constructor(store) {
    this.store = store;
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

    // Связка ползунка страниц превью и текстового поля
    const previewSlider = document.getElementById('admin-preview-pages-slider');
    const previewNum = document.getElementById('admin-preview-pages-num');
    if (previewSlider && previewNum) {
      previewSlider.addEventListener('input', () => {
        previewNum.value = previewSlider.value;
      });
      previewNum.addEventListener('input', () => {
        previewSlider.value = previewNum.value;
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

  handleWorkSubmit(e) {
    e.preventDefault();

    const title = document.getElementById('admin-work-title').value.trim();
    const originalTitle = document.getElementById('admin-work-orig-title').value.trim();
    const author = document.getElementById('admin-work-author').value.trim();
    const price = Number(document.getElementById('admin-work-price').value) || 1;
    const totalPages = Number(document.getElementById('admin-work-total-pages').value) || 10;
    const previewPagesCount = Number(document.getElementById('admin-preview-pages-num').value) || 3;
    const description = document.getElementById('admin-work-desc').value.trim();
    const tagsRaw = document.getElementById('admin-work-tags').value.trim();
    const sampleScriptText = document.getElementById('admin-script-text').value.trim();

    if (!title) {
      window.app.showToast('Введите название работы', 'error');
      return;
    }

    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : ['Перевод'];

    // Создание новой работы
    const newWork = this.store.addWork({
      title,
      originalTitle,
      author: author || 'Администратор',
      price: Math.max(1, price),
      totalPages: Math.max(1, totalPages),
      previewPagesCount: Math.min(totalPages, Math.max(1, previewPagesCount)),
      description: description || 'Описание отсутствует',
      tags,
      sampleScriptText,
      coverUrl: 'assets/demo/cover-1.svg',
      previewImages: [
        'assets/demo/page-1.svg',
        'assets/demo/page-2.svg',
        'assets/demo/page-3.svg'
      ]
    });

    window.app.showToast(`Работа "${newWork.title}" успешно зарегистрирована!`, 'success');
    e.target.reset();
    document.getElementById('admin-preview-pages-num').value = 3;
    document.getElementById('admin-preview-pages-slider').value = 3;

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
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>#${index + 1}</strong></td>
        <td>
          <div style="font-weight: 600; color: var(--text-primary);">${w.title}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${w.originalTitle || w.author}</div>
        </td>
        <td>
          <span class="badge badge-accent">${w.price} Орб (${w.price} USDT)</span>
        </td>
        <td>
          <span class="badge badge-info">${w.previewPagesCount} из ${w.totalPages} стр.</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: var(--text-secondary);">${w.createdAt || 'Недавно'}</span>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
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

    if (confirm(`Вы уверены, что хотите удалить работу "${work.title}"?`)) {
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
