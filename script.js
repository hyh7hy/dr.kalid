(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DB_NAME = 'dr-kalid', STORE = 'images', TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 25 * 1024 * 1024;
let db, images = [], urls = new Map(), query = '', saving = false;
let pending = null, pendingUrl = null, menuId = null;
const prefs = { view: 'grid', sort: 'newest' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('drkalid-prefs') || '{}')); } catch {}
const savePrefs = () => { try { localStorage.setItem('drkalid-prefs', JSON.stringify(prefs)); } catch {} };

/* ---------- helpers ---------- */
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function toast(msg, error) {
  const t = el('div', 'toast' + (error ? ' error' : ''), msg); $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3200);
}
const urlFor = r => { if (!urls.has(r.id)) urls.set(r.id, URL.createObjectURL(r.blob)); return urls.get(r.id); };
const freeUrl = id => { if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); } };

/* ---------- IndexedDB ---------- */
function openDB() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('IndexedDB is not available in this browser.'));
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'id' });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error || new Error('Could not open storage.'));
  });
}
const tx = (mode, fn) => new Promise((res, rej) => {
  const t = db.transaction(STORE, mode), s = t.objectStore(STORE); let out;
  const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
  t.oncomplete = () => res(out); t.onerror = t.onabort = () => rej(t.error || new Error('Storage error'));
});
const dbAll = () => tx('readonly', s => s.getAll());
const dbPut = r => tx('readwrite', s => s.put(r));
const dbDel = id => tx('readwrite', s => s.delete(id));
const dbClear = () => tx('readwrite', s => s.clear());

/* ---------- render ---------- */
function visible() {
  const q = query.trim().toLowerCase();
  let list = q ? images.filter(i => i.title.toLowerCase().includes(q)) : images.slice();
  const s = $('#sortSelect').value;
  list.sort((a, b) => s === 'oldest' ? a.created - b.created : s === 'az' ? a.title.localeCompare(b.title) : s === 'za' ? b.title.localeCompare(a.title) : s === 'size' ? b.size - a.size : b.created - a.created);
  return list;
}
function render() {
  const list = visible(), grid = $('#grid'), total = images.length;
  grid.replaceChildren();
  grid.classList.toggle('is-list', prefs.view === 'list');
  $('#emptyLibrary').hidden = total > 0;
  $('#emptySearch').hidden = !(total > 0 && list.length === 0);
  grid.hidden = list.length === 0;
  for (const r of list) {
    const card = el('article', 'card');
    const th = el('button', 'thumb'); th.type = 'button'; th.setAttribute('aria-label', 'View ' + r.title);
    const img = el('img'); img.src = urlFor(r); img.alt = r.title; img.loading = 'lazy'; th.append(img);
    th.addEventListener('click', () => openViewer(r.id));
    const body = el('div', 'card-body'), txt = el('div');
    txt.append(el('h3', 'card-title', r.title), el('div', 'card-date', fmtDate(r.created)));
    const more = el('button', 'more'); more.type = 'button'; more.setAttribute('aria-label', 'Options for ' + r.title); more.setAttribute('aria-haspopup', 'menu');
    more.innerHTML = '<svg class="ic"><use href="#i-more"/></svg>';
    more.addEventListener('click', e => { e.stopPropagation(); showMenu(r.id, more); });
    body.append(txt, more); card.append(th, body); grid.append(card);
  }
  const q = query.trim();
  $('#resultCount').textContent = q ? `${list.length} of ${total} ${total === 1 ? 'image' : 'images'}` : `${total} ${total === 1 ? 'image' : 'images'}`;
  $('#searchClear').hidden = !query;
  stats();
}
function stats() {
  const bytes = images.reduce((n, i) => n + i.size, 0), week = Date.now() - 7 * 864e5;
  $('#statTotal').textContent = images.length;
  $('#statRecent').textContent = images.filter(i => i.created >= week).length;
  $('#statStorage').textContent = fmtSize(bytes);
  $('#storageText').textContent = fmtSize(bytes) + ' used';
  $('#storageBar').style.width = Math.min(100, bytes / (200 * 1048576) * 100) + '%';
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => {
    if (e.quota) { $('#storageBar').style.width = Math.max(1, bytes / e.quota * 100) + '%'; $('#storageText').textContent = `${fmtSize(bytes)} used of ~${fmtSize(e.quota)} available`; }
  }).catch(() => {});
}

/* ---------- search / sort / view ---------- */
$('#searchInput').addEventListener('input', e => { query = e.target.value; render(); });
$('#searchClear').addEventListener('click', () => { query = ''; $('#searchInput').value = ''; render(); $('#searchInput').focus(); });
$('#sortSelect').value = prefs.sort;
$('#sortSelect').addEventListener('change', e => { prefs.sort = e.target.value; savePrefs(); render(); });
function setView(v) { prefs.view = v; savePrefs(); $('#viewGrid').classList.toggle('is-active', v === 'grid'); $('#viewList').classList.toggle('is-active', v === 'list'); render(); }
$('#viewGrid').onclick = () => setView('grid'); $('#viewList').onclick = () => setView('list');

/* ---------- navigation ---------- */
function go(view) {
  $$('.nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  if (view === 'upload') { openUpload(); view = null; }
  if (view) {
    $('#statsSection').hidden = view !== 'dashboard';
    $('#librarySection').hidden = view === 'settings';
    $('#settingsSection').hidden = view !== 'settings';
    $('.page-head').hidden = view === 'settings';
    window.scrollTo({ top: 0 });
  }
  closeNav();
}
$$('.nav-item').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
const openNav = () => { $('#sidebar').classList.add('is-open'); $('#scrim').classList.add('is-open'); };
const closeNav = () => { $('#sidebar').classList.remove('is-open'); $('#scrim').classList.remove('is-open'); };
$('#menuBtn').onclick = openNav; $('#scrim').onclick = closeNav;
$('#topUpload').onclick = () => openUpload();
$$('[data-open-upload]').forEach(b => b.addEventListener('click', () => openUpload()));

/* ---------- upload flow ---------- */
let lastFocus = null;
function openUpload() { lastFocus = document.activeElement; resetUpload(); $('#uploadModal').hidden = false; $('#browseBtn').focus(); }
function closeUpload() { $('#uploadModal').hidden = true; resetUpload(); lastFocus && lastFocus.focus && lastFocus.focus(); }
function resetUpload() {
  if (pendingUrl) URL.revokeObjectURL(pendingUrl);
  pending = pendingUrl = null; saving = false;
  $('#previewImg').removeAttribute('src'); $('#titleInput').value = ''; $('#fileInput').value = '';
  $('#stepSelect').hidden = false; $('#stepPreview').hidden = true; $('#uploadError').hidden = true;
  $('#saveBtn').classList.remove('is-loading'); updateSave();
}
function uploadError(m) { const e = $('#uploadError'); e.textContent = m; e.hidden = !m; }
function pick(file) {
  if (!file) return;
  if (!TYPES.includes(file.type)) return uploadError('Unsupported format. Please choose a JPG, PNG or WebP image.');
  if (file.size > MAX_BYTES) return uploadError('That file is larger than 25 MB.');
  if (pendingUrl) URL.revokeObjectURL(pendingUrl);
  pending = file; pendingUrl = URL.createObjectURL(file); uploadError('');
  $('#previewImg').src = pendingUrl;
  $('#fileName').textContent = file.name; $('#fileSize').textContent = fmtSize(file.size);
  $('#stepSelect').hidden = true; $('#stepPreview').hidden = false;
  $('#titleInput').focus(); updateSave();
}
function updateSave() { $('#saveBtn').disabled = !(pending && $('#titleInput').value.trim()) || saving; }
$('#browseBtn').onclick = e => { e.stopPropagation(); $('#fileInput').click(); };
$('#dropzone').addEventListener('click', () => $('#fileInput').click());
$('#dropzone').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
$('#fileInput').addEventListener('change', e => pick(e.target.files[0]));
['dragenter', 'dragover'].forEach(n => $('#dropzone').addEventListener(n, e => { e.preventDefault(); $('#dropzone').classList.add('is-over'); }));
['dragleave', 'drop'].forEach(n => $('#dropzone').addEventListener(n, e => { e.preventDefault(); $('#dropzone').classList.remove('is-over'); }));
$('#dropzone').addEventListener('drop', e => pick(e.dataTransfer.files[0]));
$('#changeBtn').onclick = () => $('#fileInput').click();
$('#removeBtn').onclick = () => resetUpload();
$('#titleInput').addEventListener('input', updateSave);
$$('#uploadModal [data-close]').forEach(b => b.addEventListener('click', closeUpload));
$('#uploadModal').addEventListener('mousedown', e => { if (e.target.id === 'uploadModal') closeUpload(); });
$('#saveForm').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('#titleInput').value.trim();
  if (saving || !pending || !title) return;
  saving = true; $('#saveBtn').disabled = true; $('#saveBtn').classList.add('is-loading');
  const now = Date.now();
  const rec = { id: uid(), title, filename: pending.name, type: pending.type, size: pending.size, blob: pending, created: now, updated: now };
  try {
    await dbPut(rec); images.push(rec);
    $('#uploadModal').hidden = true; resetUpload(); render(); toast('Image saved successfully.');
  } catch (err) {
    saving = false; $('#saveBtn').classList.remove('is-loading'); updateSave();
    uploadError('Could not save. Browser storage may be full or blocked (' + (err && err.name || 'error') + ').');
  }
});

/* ---------- card menu ---------- */
function showMenu(id, anchor) {
  const m = $('#menu'); menuId = id; m.hidden = false;
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
  m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
  m.querySelector('button').focus();
}
const hideMenu = () => { $('#menu').hidden = true; };
document.addEventListener('click', e => { if (!e.target.closest('#menu')) hideMenu(); });
addEventListener('scroll', hideMenu, true); addEventListener('resize', hideMenu);
$('#menu').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const id = menuId; hideMenu();
  if (b.dataset.act === 'view') openViewer(id);
  if (b.dataset.act === 'rename') rename(id);
  if (b.dataset.act === 'delete') remove(id);
});

/* ---------- dialog ---------- */
function ask({ title, text = '', input, ok = 'OK', danger }) {
  return new Promise(res => {
    const d = $('#dialog'), inp = $('#dlgInput'), okb = $('#dlgOk');
    $('#dlgTitle').textContent = title; $('#dlgText').textContent = text; $('#dlgText').hidden = !text;
    inp.hidden = input == null; if (input != null) inp.value = input;
    okb.textContent = ok; okb.classList.toggle('danger-mode', !!danger);
    d.hidden = false; (input != null ? inp : okb).focus(); if (input != null) inp.select();
    const done = v => { d.hidden = true; okb.onclick = $('#dlgCancel').onclick = inp.onkeydown = null; res(v); };
    okb.onclick = () => { if (input != null && !inp.value.trim()) return inp.focus(); done(input != null ? inp.value.trim() : true); };
    $('#dlgCancel').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') okb.click(); };
  });
}
async function rename(id) {
  const r = images.find(i => i.id === id); if (!r) return;
  const t = await ask({ title: 'Rename image', input: r.title, ok: 'Save' }); if (!t || t === r.title) return;
  await updateTitle(r, t);
}
async function updateTitle(r, t) {
  const old = { title: r.title, updated: r.updated };
  r.title = t.slice(0, 120); r.updated = Date.now();
  try { await dbPut(r); render(); toast('Title updated.'); } catch { Object.assign(r, old); toast('Could not update the title.', true); render(); }
}
async function remove(id) {
  const r = images.find(i => i.id === id); if (!r) return;
  if (!await ask({ title: 'Delete this image?', text: `“${r.title}” will be permanently removed from this browser.`, ok: 'Delete', danger: true })) return;
  try { await dbDel(id); freeUrl(id); images = images.filter(i => i.id !== id); render(); toast('Image deleted.'); } catch { toast('Could not delete the image.', true); }
}

/* ---------- viewer ---------- */
let vId = null, zoom = 1, px = 0, py = 0, drag = null;
function applyZoom() { $('#viewerImg').style.transform = `translate(${px}px,${py}px) scale(${zoom})`; $('#zoomVal').textContent = Math.round(zoom * 100) + '%'; }
function setZoom(z) { zoom = Math.max(.25, Math.min(8, z)); if (zoom <= 1) px = py = 0; applyZoom(); }
function openViewer(id) {
  const r = images.find(i => i.id === id); if (!r) return;
  lastFocus = document.activeElement; vId = id;
  $('#viewerImg').src = urlFor(r); $('#viewerImg').alt = r.title; $('#viewerTitle').value = r.title;
  px = py = 0; zoom = 1; applyZoom(); $('#viewer').hidden = false; document.body.style.overflow = 'hidden'; $('#vClose').focus();
}
function closeViewer() { $('#viewer').hidden = true; vId = null; $('#viewerImg').removeAttribute('src'); document.body.style.overflow = ''; lastFocus && lastFocus.focus && lastFocus.focus(); }
$('#vClose').onclick = closeViewer;
$('#zIn').onclick = () => setZoom(zoom * 1.25); $('#zOut').onclick = () => setZoom(zoom / 1.25);
$('#zReset').onclick = () => setZoom(1);
$('#zFit').onclick = () => { px = py = 0; setZoom(1); };
$('#vDownload').onclick = () => {
  const r = images.find(i => i.id === vId); if (!r) return;
  const a = el('a'); a.href = urlFor(r); a.download = r.filename || (r.title + '.png'); document.body.append(a); a.click(); a.remove();
};
$('#viewerTitle').addEventListener('change', async e => {
  const r = images.find(i => i.id === vId), t = e.target.value.trim();
  if (!r) return; if (!t) { e.target.value = r.title; return toast('Title cannot be empty.', true); }
  if (t !== r.title) await updateTitle(r, t);
});
$('#viewerTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#stage').addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
$('#stage').addEventListener('pointerdown', e => { if (zoom <= 1) return; drag = { x: e.clientX - px, y: e.clientY - py }; $('#stage').setPointerCapture(e.pointerId); $('#stage').classList.add('grabbing'); });
$('#stage').addEventListener('pointermove', e => { if (!drag) return; px = e.clientX - drag.x; py = e.clientY - drag.y; applyZoom(); });
['pointerup', 'pointercancel'].forEach(n => $('#stage').addEventListener(n, () => { drag = null; $('#stage').classList.remove('grabbing'); }));
$('#stage').addEventListener('dblclick', () => setZoom(zoom === 1 ? 2 : 1));

/* ---------- backup / restore ---------- */
const toDataURL = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
$('#exportBtn').onclick = async () => {
  if (!images.length) return toast('Nothing to export yet.', true);
  try {
    const items = []; for (const r of images) items.push({ id: r.id, title: r.title, filename: r.filename, type: r.type, size: r.size, created: r.created, updated: r.updated, data: await toDataURL(r.blob) });
    const blob = new Blob([JSON.stringify({ app: 'DR kalid', version: 1, exported: Date.now(), items })], { type: 'application/json' });
    const u = URL.createObjectURL(blob), a = el('a'); a.href = u; a.download = `dr-kalid-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); toast('Backup exported.');
  } catch { toast('Export failed.', true); }
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); if (data.app !== 'DR kalid' || !Array.isArray(data.items)) throw 0; } catch { return toast('That is not a valid DR kalid backup.', true); }
  if (!await ask({ title: 'Replace your library?', text: `This will replace all ${images.length} current image(s) with ${data.items.length} from the backup. This cannot be undone.`, ok: 'Replace', danger: true })) return;
  try {
    const recs = [];
    for (const it of data.items) {
      if (!it || !TYPES.includes(it.type) || typeof it.data !== 'string' || !String(it.title || '').trim()) continue;
      const blob = await (await fetch(it.data)).blob();
      recs.push({ id: String(it.id || uid()), title: String(it.title).trim().slice(0, 120), filename: String(it.filename || ''), type: it.type, size: blob.size, blob: new Blob([blob], { type: it.type }), created: +it.created || Date.now(), updated: +it.updated || Date.now() });
    }
    await dbClear(); for (const r of recs) await dbPut(r);
    urls.forEach((_, id) => freeUrl(id)); images = recs; render(); toast(`Restored ${recs.length} image(s).`);
  } catch { toast('Restore failed. Your browser storage may be full.', true); images = await dbAll().catch(() => images); render(); }
});

/* ---------- global keys ---------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#dialog').hidden) return $('#dlgCancel').click();
    if (!$('#menu').hidden) return hideMenu();
    if (!$('#viewer').hidden) return closeViewer();
    if (!$('#uploadModal').hidden) return closeUpload();
    closeNav();
  }
  if (!$('#viewer').hidden && e.target.tagName !== 'INPUT') {
    if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25);
    if (e.key === '-') setZoom(zoom / 1.25);
    if (e.key === '0') setZoom(1);
  }
});
addEventListener('beforeunload', () => urls.forEach(u => URL.revokeObjectURL(u)));

/* ---------- init ---------- */
(async function init() {
  setView(prefs.view);
  try { db = await openDB(); images = await dbAll(); }
  catch (err) { toast('Storage unavailable: ' + err.message, true); }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
})();
