'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    projects: [],
    settings: null,
    editing: null,
    gallery: [],
    busy: false,
  };

  const els = {
    gate: $('#gate'),
    app: $('#app'),
    loginForm: $('#login-form'),
    loginPassword: $('#login-password'),
    loginError: $('#login-error'),
    loginSubmit: $('#login-submit'),
    list: $('#works-list'),
    empty: $('#works-empty'),
    count: $('#works-count'),
    demoHint: $('#demo-hint'),
    workDialog: $('#work-dialog'),
    workForm: $('#work-form'),
    workError: $('#work-error'),
    workSave: $('#work-save'),
    workDelete: $('#work-delete'),
    workTitle: $('#work-dialog-title'),
    coverPreview: $('#cover-preview'),
    coverFile: $('#cover-file'),
    coverRemove: $('#cover-remove'),
    galleryPreview: $('#gallery-preview'),
    galleryFile: $('#gallery-file'),
    linksList: $('#links-list'),
    settingsDialog: $('#settings-dialog'),
    settingsForm: $('#settings-form'),
    settingsError: $('#settings-error'),
    publishBtn: $('#publish-btn'),
    publishDialog: $('#publish-dialog'),
    publishStatus: $('#publish-status'),
    publishLog: $('#publish-log'),
    publishError: $('#publish-error'),
    toast: $('#toast'),
  };

  const plural = (n, one, few, many) => {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (last === 1 && abs !== 11) return one;
    if (last >= 2 && last <= 4 && (abs < 12 || abs > 14)) return few;
    return many;
  };

  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── Сеть ────────────────────────────────────────────────────── */

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Portfolio-CSRF': '1',
        ...(options.headers || {}),
      },
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      /* тело может быть пустым */
    }

    if (response.status === 401) {
      showGate();
      throw new Error('Сессия истекла — войдите заново');
    }

    if (!response.ok) {
      throw new Error((data && data.error) || `Ошибка ${response.status}`);
    }

    return data;
  }

  /* ── Сообщения ───────────────────────────────────────────────── */

  let toastTimer = 0;

  function toast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle('is-error', Boolean(isError));
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 3200);
  }

  function setError(element, message) {
    if (!message) {
      element.hidden = true;
      element.textContent = '';
      return;
    }
    element.hidden = false;
    element.textContent = message;
  }

  /* ── Вход ────────────────────────────────────────────────────── */

  function showGate() {
    els.app.hidden = true;
    els.gate.hidden = false;
    state.projects = [];
    state.settings = null;
    setTimeout(() => els.loginPassword.focus(), 50);
  }

  function showApp() {
    els.gate.hidden = true;
    els.app.hidden = false;
  }

  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(els.loginError, '');
    const password = els.loginPassword.value;
    if (!password) {
      setError(els.loginError, 'Введите пароль');
      return;
    }
    els.loginSubmit.disabled = true;
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
      els.loginPassword.value = '';
      showApp();
      await load();
    } catch (error) {
      setError(els.loginError, error.message);
    } finally {
      els.loginSubmit.disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (error) {
      console.warn(error);
    }
    showGate();
    toast('Вы вышли');
  });

  /* ── Данные и список ─────────────────────────────────────────── */

  async function load() {
    const data = await api('/api/works');
    state.projects = data.projects;
    state.settings = data.settings;
    renderList();
  }

  function renderList() {
    const count = state.projects.length;
    els.count.textContent = `${count} ${plural(count, 'работа', 'работы', 'работ')}`;
    els.empty.hidden = count > 0;
    els.demoHint.hidden = !state.projects.some((p) => p.demo);

    els.list.innerHTML = state.projects
      .map((project) => {
        const cover = project.cover
          ? `<img src="${escapeHtml(project.cover)}" alt="" loading="lazy">`
          : '<span class="thumb-empty">без обложки</span>';
        const photos = project.gallery.length;
        const meta = [project.year, project.category, photos ? `${photos} ${plural(photos, 'фото', 'фото', 'фото')}` : '']
          .filter(Boolean)
          .join(' · ');

        return `<li class="works-item${project.published ? '' : ' is-hidden-work'}" data-id="${escapeHtml(project.id)}">
  <a class="thumb" href="/work/${escapeHtml(project.slug)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${cover}</a>
  <div>
    <p class="work-title">${escapeHtml(project.title)}${project.published ? '' : '<span class="badge">скрыто</span>'}</p>
    <p class="work-meta">${escapeHtml(meta)}</p>
    <p class="work-slug">/work/${escapeHtml(project.slug)}</p>
  </div>
  <div class="work-actions">
    <label class="switch" title="Показывать на сайте">
      <input type="checkbox" data-action="toggle"${project.published ? ' checked' : ''} aria-label="Опубликовано: ${escapeHtml(project.title)}">
      <span class="switch-track"><span class="switch-dot"></span></span>
      <span class="switch-label">видно</span>
    </label>
    <a class="icon-btn" href="/work/${escapeHtml(project.slug)}" target="_blank" rel="noopener" aria-label="Открыть страницу работы">↗</a>
    <button class="btn btn-ghost" type="button" data-action="edit">Изменить</button>
  </div>
</li>`;
      })
      .join('');
  }

  els.list.addEventListener('click', async (event) => {
    const item = event.target.closest('.works-item');
    if (!item) return;
    const project = state.projects.find((p) => p.id === item.dataset.id);
    if (!project) return;

    if (event.target.closest('[data-action="edit"]')) {
      openWork(project);
      return;
    }

    if (event.target.closest('[data-action="toggle"]')) {
      const checkbox = event.target.closest('input[type="checkbox"]');
      await togglePublished(project, checkbox.checked);
    }
  });

  async function togglePublished(project, published) {
    if (state.busy) return;
    state.busy = true;
    try {
      const data = await api(`/api/works/${project.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: project.title,
          year: project.year,
          category: project.category,
          summary: project.summary,
          description: project.description,
          stack: project.stack,
          links: project.links,
          cover: project.cover,
          gallery: project.gallery,
          slug: project.slug,
          published,
        }),
      });
      Object.assign(project, data.project);
      renderList();
      toast(published ? 'Работа опубликована' : 'Работа скрыта с сайта');
    } catch (error) {
      toast(error.message, true);
      renderList();
    } finally {
      state.busy = false;
    }
  }

  /* ── Редактор работы ─────────────────────────────────────────── */

  const form = els.workForm;

  function openWork(project) {
    state.editing = project || null;
    state.gallery = project ? project.gallery.map((item) => ({ ...item })) : [];

    form.reset();
    form.elements.title.value = project ? project.title : '';
    form.elements.year.value = project ? project.year : String(new Date().getFullYear());
    form.elements.category.value = project ? project.category : '';
    form.elements.stack.value = project ? project.stack.join(', ') : '';
    form.elements.summary.value = project ? project.summary : '';
    form.elements.description.value = project ? project.description : '';
    form.elements.slug.value = project ? project.slug : '';
    form.elements.cover.value = project ? project.cover : '';
    form.elements.published.checked = project ? project.published : true;

    els.workTitle.textContent = project ? 'Работа' : 'Новая работа';
    els.workSave.textContent = project ? 'Сохранить изменения' : 'Добавить работу';
    els.workDelete.hidden = !project;
    setError(els.workError, '');
    renderCover();
    renderGallery();
    renderLinks(project ? project.links : []);

    els.workDialog.showModal();
    setTimeout(() => form.elements.title.focus(), 60);
  }

  function renderCover() {
    const url = form.elements.cover.value;
    els.coverPreview.hidden = !url;
    els.coverPreview.style.backgroundImage = url ? `url("${url}")` : '';
    els.coverRemove.hidden = !url;
  }

  function renderGallery() {
    els.galleryPreview.innerHTML = state.gallery
      .map(
        (item, index) => `<div class="upload-item">
  <img src="${escapeHtml(item.src)}" alt="">
  <button class="upload-remove" type="button" data-remove-photo="${index}" aria-label="Удалить изображение">×</button>
</div>`,
      )
      .join('');
  }

  els.galleryPreview.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-photo]');
    if (!button) return;
    state.gallery.splice(Number(button.dataset.removePhoto), 1);
    renderGallery();
  });

  function renderLinks(links) {
    els.linksList.innerHTML = '';
    links.forEach((link) => els.linksList.appendChild(linkRow(link.label, link.url)));
    if (!links.length) els.linksList.appendChild(linkRow('', ''));
  }

  function linkRow(label, url) {
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `<input name="linkLabel" placeholder="Подпись — Демо" value="${escapeHtml(label)}" maxlength="60">
<input name="linkUrl" placeholder="https://…" value="${escapeHtml(url)}" maxlength="500">
<button class="icon-btn" type="button" data-remove-link aria-label="Удалить ссылку">×</button>`;
    row.querySelector('[data-remove-link]').addEventListener('click', () => {
      row.remove();
      if (!els.linksList.children.length) els.linksList.appendChild(linkRow('', ''));
    });
    return row;
  }

  $('#add-link').addEventListener('click', () => els.linksList.appendChild(linkRow('', '')));

  function collectLinks() {
    return $$('.link-row', els.linksList)
      .map((row) => ({ label: row.querySelector('[name="linkLabel"]').value.trim(), url: row.querySelector('[name="linkUrl"]').value.trim() }))
      .filter((link) => link.url);
  }

  async function uploadImage(file) {
    if (!file) return '';
    if (file.size > 8 * 1024 * 1024) throw new Error('Файл больше 8 МБ');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
    const data = await api('/api/upload', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    return data.url;
  }

  els.coverFile.addEventListener('change', async () => {
    const file = els.coverFile.files && els.coverFile.files[0];
    els.coverFile.value = '';
    if (!file) return;
    try {
      toast('Загружаю обложку…');
      form.elements.cover.value = await uploadImage(file);
      renderCover();
      toast('Обложка загружена');
    } catch (error) {
      toast(error.message, true);
    }
  });

  els.coverRemove.addEventListener('click', () => {
    form.elements.cover.value = '';
    renderCover();
  });

  els.galleryFile.addEventListener('change', async () => {
    const files = Array.from(els.galleryFile.files || []);
    els.galleryFile.value = '';
    if (!files.length) return;
    try {
      toast(files.length > 1 ? `Загружаю изображения: ${files.length}` : 'Загружаю изображение…');
      for (const file of files) {
        const src = await uploadImage(file);
        state.gallery.push({ src, alt: '' });
        renderGallery();
      }
      toast('Готово');
    } catch (error) {
      toast(error.message, true);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(els.workError, '');

    const payload = {
      title: form.elements.title.value.trim(),
      year: form.elements.year.value.trim(),
      category: form.elements.category.value.trim(),
      summary: form.elements.summary.value.trim(),
      description: form.elements.description.value.trim(),
      stack: form.elements.stack.value.split(',').map((s) => s.trim()).filter(Boolean),
      links: collectLinks(),
      cover: form.elements.cover.value,
      gallery: state.gallery,
      slug: form.elements.slug.value.trim(),
      published: form.elements.published.checked,
    };

    if (!payload.title) {
      setError(els.workError, 'Укажите название работы');
      form.elements.title.focus();
      return;
    }
    if (payload.year && !/^[0-9]{4}$/.test(payload.year)) {
      setError(els.workError, 'Год указывается четырьмя цифрами');
      form.elements.year.focus();
      return;
    }

    els.workSave.disabled = true;
    try {
      if (state.editing) {
        const data = await api(`/api/works/${state.editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        Object.assign(state.editing, data.project);
        toast('Изменения сохранены');
      } else {
        await api('/api/works', { method: 'POST', body: JSON.stringify(payload) });
        toast('Работа добавлена');
      }
      els.workDialog.close();
      await load();
    } catch (error) {
      setError(els.workError, error.message);
    } finally {
      els.workSave.disabled = false;
    }
  });

  els.workDelete.addEventListener('click', async () => {
    if (!state.editing) return;
    const confirmed = window.confirm(`Удалить «${state.editing.title}»? Это действие нельзя отменить.`);
    if (!confirmed) return;
    try {
      await api(`/api/works/${state.editing.id}`, { method: 'DELETE' });
      els.workDialog.close();
      await load();
      toast('Работа удалена');
    } catch (error) {
      setError(els.workError, error.message);
    }
  });

  $('#new-work').addEventListener('click', () => openWork(null));

  $$('[data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });

  /* ── Примеры ─────────────────────────────────────────────────── */

  $('#clear-demo').addEventListener('click', async () => {
    if (!window.confirm('Удалить три примера работ? Ваши собственные работы останутся.')) return;
    try {
      const data = await api('/api/demo', { method: 'DELETE' });
      await load();
      toast(`Удалено примеров: ${data.removed}`);
    } catch (error) {
      toast(error.message, true);
    }
  });

  /* ── Публикация ──────────────────────────────────────────────── */

  function renderPublish(result) {
    const lines = (result.steps || []).map((step) => {
      const mark = step.code === 0 ? '✓' : '✗';
      const body = step.output
        ? `\n${step.output
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n')}`
        : '';
      return `${mark} ${step.name}${body}`;
    });
    els.publishLog.textContent = lines.join('\n\n') || 'Вывода нет.';
    els.publishLog.scrollTop = 0;
  }

  async function publish() {
    els.publishBtn.disabled = true;
    els.publishBtn.textContent = 'Публикую…';
    els.publishLog.textContent = '';
    els.publishStatus.textContent = 'Собираю сайт и отправляю на GitHub…';
    setError(els.publishError, '');
    els.publishDialog.showModal();

    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Portfolio-CSRF': '1' },
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        showGate();
        throw new Error('Сессия истекла — войдите заново');
      }

      renderPublish(data);

      if (response.ok && data.ok) {
        els.publishStatus.textContent = data.url
          ? `Готово. GitHub Pages обновит сайт за минуту: ${data.url}`
          : 'Готово. GitHub Pages обновит сайт за минуту.';
      } else {
        els.publishStatus.textContent = 'Публикация не прошла.';
        setError(els.publishError, data.error || `Ошибка ${response.status}`);
      }
    } catch (error) {
      els.publishStatus.textContent = 'Публикация не прошла.';
      setError(els.publishError, error.message);
    } finally {
      els.publishBtn.disabled = false;
      els.publishBtn.textContent = 'Опубликовать';
    }
  }

  els.publishBtn.addEventListener('click', () => {
    if (els.publishDialog.open) return;
    publish();
  });

  /* ── Настройки ───────────────────────────────────────────────── */

  function openSettings() {
    if (!state.settings) return;
    const s = state.settings;
    const formEl = els.settingsForm;
    formEl.reset();
    formEl.elements.siteName.value = s.siteName || '';
    formEl.elements.role.value = s.role || '';
    formEl.elements.lead.value = s.lead || '';
    formEl.elements.status.value = s.status || '';
    formEl.elements.city.value = s.city || '';
    formEl.elements.stack.value = s.stack || '';
    formEl.elements.email.value = s.email || '';
    formEl.elements.telegram.value = s.telegram || '';
    formEl.elements.whatsapp.value = s.whatsapp || '';
    formEl.elements.max.value = s.max || '';
    formEl.elements.mailSubject.value = s.mailSubject || '';
    formEl.elements.waText.value = s.waText || '';
    formEl.elements.about.value = (s.about || []).join('\n\n');
    setError(els.settingsError, '');
    els.settingsDialog.showModal();
  }

  $('#open-settings').addEventListener('click', openSettings);

  els.settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(els.settingsError, '');
    const formEl = els.settingsForm;
    const payload = {
      siteName: formEl.elements.siteName.value.trim(),
      role: formEl.elements.role.value.trim(),
      lead: formEl.elements.lead.value.trim(),
      status: formEl.elements.status.value.trim(),
      city: formEl.elements.city.value.trim(),
      stack: formEl.elements.stack.value.trim(),
      email: formEl.elements.email.value.trim(),
      telegram: formEl.elements.telegram.value.trim(),
      whatsapp: formEl.elements.whatsapp.value.trim(),
      max: formEl.elements.max.value.trim(),
      mailSubject: formEl.elements.mailSubject.value.trim(),
      waText: formEl.elements.waText.value.trim(),
      about: formEl.elements.about.value,
    };
    if (!payload.siteName) {
      setError(els.settingsError, 'Укажите имя или название');
      return;
    }
    const button = $('#settings-save');
    button.disabled = true;
    try {
      const data = await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      state.settings = data.settings;
      els.settingsDialog.close();
      toast('Настройки сохранены');
    } catch (error) {
      setError(els.settingsError, error.message);
    } finally {
      button.disabled = false;
    }
  });

  $('#change-password').addEventListener('click', async () => {
    const formEl = els.settingsForm;
    const current = formEl.elements.currentPassword.value;
    const next = formEl.elements.nextPassword.value;
    setError(els.settingsError, '');
    if (!current || !next) {
      setError(els.settingsError, 'Введите текущий и новый пароль');
      return;
    }
    try {
      await api('/api/password', { method: 'POST', body: JSON.stringify({ current, next }) });
      formEl.elements.currentPassword.value = '';
      formEl.elements.nextPassword.value = '';
      toast('Пароль изменён');
    } catch (error) {
      setError(els.settingsError, error.message);
    }
  });

  /* ── Запуск ──────────────────────────────────────────────────── */

  (async function init() {
    try {
      const session = await api('/api/session');
      if (!session.authed) {
        showGate();
        return;
      }
      showApp();
      await load();
    } catch (error) {
      showGate();
      if (error.name !== 'TypeError') setError(els.loginError, error.message);
    }
  })();
})();
