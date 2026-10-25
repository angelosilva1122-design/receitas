'use strict';

const APP_VERSION = '0.4.0';

/* ---------- Armazenamento local (IndexedDB) ---------- */
const DB_NAME = 'receitas';
const DB_VERSION = 1;
const STORE = 'recipes';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbReady = openDB();

async function tx(mode, fn) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const getAllRecipes = () => tx('readonly', (s) => s.getAll()).then((r) => r || []);
const getRecipe = (id) => tx('readonly', (s) => s.get(id));
const saveRecipe = (recipe) => tx('readwrite', (s) => { s.put(recipe); }).then(() => recipe);
const deleteRecipe = (id) => tx('readwrite', (s) => { s.delete(id); });
const saveMany = (recipes) => tx('readwrite', (s) => { recipes.forEach((r) => s.put(r)); });

// Pede ao browser para não apagar os dados automaticamente
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

/* ---------- Utilitários ---------- */
const $ = (id) => document.getElementById(id);

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function toLines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// Minutos → "45 min", "1 h", "1 h 15 min"
function formatMinutes(m) {
  if (!m) return '';
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (!h) return `${min} min`;
  return min ? `${h} h ${min} min` : `${h} h`;
}

// Texto do campo → número inteiro positivo, ou null
function parseCount(v) {
  const n = parseInt(String(v).replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : null;
}

const totalTime = (r) => (r.prepTime || 0) + (r.cookTime || 0);

function summary(r) {
  const parts = [plural(r.ingredients.length, 'ingrediente', 'ingredientes')];
  const t = totalTime(r);
  if (t) parts.push(formatMinutes(t));
  else parts.push(plural(r.steps.length, 'passo', 'passos'));
  return parts.join(' · ');
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- Lista ---------- */
async function render() {
  let recipes = [];
  try {
    recipes = await getAllRecipes();
  } catch (e) {
    toast('Erro ao ler as receitas');
    console.error(e);
  }
  recipes.sort((a, b) => a.title.localeCompare(b.title, 'pt', { sensitivity: 'base' }));

  const list = $('list');
  list.replaceChildren();

  for (const r of recipes) {
    const li = document.createElement('li');
    li.className = 'row';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.dataset.id = r.id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = (r.title.trim()[0] || '?').toUpperCase();

    const text = document.createElement('div');
    text.className = 'row-text';
    const title = document.createElement('p');
    title.className = 'row-title';
    title.textContent = r.title;
    const meta = document.createElement('p');
    meta.className = 'row-meta';
    meta.textContent = summary(r);
    text.append(title, meta);

    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('width', '18');
    chev.setAttribute('height', '18');
    chev.setAttribute('class', 'chevron');
    chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML = '<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';

    li.append(avatar, text, chev);
    list.append(li);
  }

  $('empty').hidden = recipes.length > 0;
  $('count').hidden = recipes.length === 0;
  $('count').textContent = plural(recipes.length, 'receita', 'receitas');
}

$('list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (row) openDetail(row.dataset.id);
});
$('list').addEventListener('keydown', (e) => {
  const row = e.target.closest('.row');
  if (row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openDetail(row.dataset.id);
  }
});

/* ---------- Detalhe ---------- */
const detail = $('detail');
let current = null; // receita aberta no detalhe

function fillDetail(r) {
  $('detailTitle').textContent = r.title;
  $('detailMeta').textContent = summary(r);

  const facts = [
    ['Preparação', formatMinutes(r.prepTime)],
    ['Cozedura', formatMinutes(r.cookTime)],
    ['Porções', r.servings ? String(r.servings) : ''],
  ].filter(([, v]) => v);
  const factsEl = $('detailFacts');
  factsEl.replaceChildren(...facts.map(([label, value]) => {
    const div = document.createElement('div');
    div.className = 'fact';
    const v = document.createElement('strong');
    v.textContent = value;
    const l = document.createElement('span');
    l.textContent = label;
    div.append(v, l);
    return div;
  }));
  factsEl.hidden = facts.length === 0;

  const notes = (r.notes || '').trim();
  $('notesTitle').hidden = !notes;
  $('detailNotes').hidden = !notes;
  $('detailNotes').textContent = notes;

  const ing = $('detailIngredients');
  ing.replaceChildren(...r.ingredients.map((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    return li;
  }));
  ing.hidden = r.ingredients.length === 0;
  $('noIngredients').hidden = r.ingredients.length > 0;

  const steps = $('detailSteps');
  steps.replaceChildren(...r.steps.map((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    return li;
  }));
  steps.hidden = r.steps.length === 0;
  $('noSteps').hidden = r.steps.length > 0;
}

async function showDetail(id) {
  let r;
  try { r = await getRecipe(id); } catch (e) { console.error(e); }
  if (!r) {
    hideDetail();
    return false;
  }
  current = r;
  fillDetail(r);
  if (detail.hidden) {
    detail.hidden = false;
    detail.scrollTop = 0;
    void detail.offsetHeight;
    detail.classList.add('open');
  }
  return true;
}

function hideDetail() {
  current = null;
  if (detail.hidden) return;
  detail.classList.remove('open');
  setTimeout(() => { if (!current) detail.hidden = true; }, 300);
}

// Navegação com histórico: o gesto/botão "voltar" fecha o detalhe
function openDetail(id) {
  history.pushState({ recipe: id }, '', `#r=${encodeURIComponent(id)}`);
  showDetail(id);
}

function goBack() {
  if (history.state && history.state.recipe) history.back();
  else {
    history.replaceState(null, '', location.pathname);
    hideDetail();
  }
}

window.addEventListener('popstate', () => {
  const id = history.state && history.state.recipe;
  if (id) showDetail(id);
  else hideDetail();
});

$('backBtn').addEventListener('click', goBack);
$('editBtn').addEventListener('click', () => { if (current) openSheet(current); });

$('deleteBtn').addEventListener('click', async () => {
  if (!current) return;
  if (!confirm(`Apagar "${current.title}"?\nEsta ação não pode ser desfeita.`)) return;
  try {
    await deleteRecipe(current.id);
    await render();
    goBack();
    toast('Receita apagada');
  } catch (e) {
    console.error(e);
    toast('Não foi possível apagar');
  }
});

/* ---------- Formulário (folha) ---------- */
const sheet = $('sheet');
const form = $('form');
const titleInput = $('title');
const ingInput = $('ingredients');
const stepsInput = $('steps');
const prepInput = $('prepTime');
const cookInput = $('cookTime');
const servingsInput = $('servings');
const notesInput = $('notes');
const saveBtn = $('saveBtn');
let editing = null; // receita a editar (null = nova)
let initial = '';   // estado inicial para detetar alterações

const fields = () => [titleInput, ingInput, stepsInput, prepInput, cookInput, servingsInput, notesInput];
const snapshot = () => fields().map((el) => el.value.trim()).join('\u0000');

// Campos numéricos: só dígitos
[prepInput, cookInput, servingsInput].forEach((el) => {
  el.addEventListener('input', () => {
    const clean = el.value.replace(/\D/g, '').slice(0, 4);
    if (clean !== el.value) el.value = clean;
  });
});

function openSheet(recipe = null) {
  editing = recipe;
  form.reset();
  if (recipe) {
    titleInput.value = recipe.title;
    ingInput.value = recipe.ingredients.join('\n');
    stepsInput.value = recipe.steps.join('\n');
    prepInput.value = recipe.prepTime || '';
    cookInput.value = recipe.cookTime || '';
    servingsInput.value = recipe.servings || '';
    notesInput.value = recipe.notes || '';
  }
  $('sheetTitle').textContent = recipe ? 'Editar receita' : 'Nova receita';
  initial = snapshot();
  saveBtn.disabled = titleInput.value.trim() === '';
  sheet.hidden = false;
  void sheet.offsetHeight; // força reflow para a animação
  sheet.classList.add('open');
  if (!recipe) setTimeout(() => titleInput.focus(), 320);
}

function closeSheet() {
  document.activeElement && document.activeElement.blur();
  sheet.classList.remove('open');
  setTimeout(() => { sheet.hidden = true; }, 320);
}

function requestClose() {
  if (snapshot() !== initial) {
    const msg = editing ? 'Descartar as alterações?' : 'Descartar esta receita?';
    if (!confirm(msg)) return;
  }
  closeSheet();
}

titleInput.addEventListener('input', () => {
  saveBtn.disabled = titleInput.value.trim() === '';
});

titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    ingInput.focus();
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;
  const now = Date.now();
  const recipe = {
    ...(editing || { id: newId(), createdAt: now }),
    title,
    ingredients: toLines(ingInput.value),
    steps: toLines(stepsInput.value),
    prepTime: parseCount(prepInput.value),
    cookTime: parseCount(cookInput.value),
    servings: parseCount(servingsInput.value),
    notes: notesInput.value.trim(),
    updatedAt: now,
  };
  saveBtn.disabled = true;
  try {
    await saveRecipe(recipe);
    closeSheet();
    await render();
    if (editing) {
      current = recipe;
      fillDetail(recipe);
      toast('Alterações guardadas');
    } else {
      toast('Receita guardada');
    }
  } catch (err) {
    console.error(err);
    saveBtn.disabled = false;
    toast('Não foi possível guardar');
  }
});

$('addBtn').addEventListener('click', () => openSheet());
$('cancelBtn').addEventListener('click', requestClose);
sheet.querySelector('[data-close]').addEventListener('click', requestClose);

/* ---------- Cópia de segurança ---------- */
const BACKUP_FORMAT = 'receitas-backup';
const LAST_BACKUP_KEY = 'receitas.lastBackup';
const backupSheet = $('backupSheet');

function readLastBackup() {
  try { return Number(localStorage.getItem(LAST_BACKUP_KEY)) || 0; } catch { return 0; }
}
function writeLastBackup(ts) {
  try { localStorage.setItem(LAST_BACKUP_KEY, String(ts)); } catch { /* sem armazenamento */ }
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Receitas pré-carregadas ao abrir a folha: no iPhone a partilha tem de
// arrancar logo no toque, sem esperar pela base de dados.
let exportCache = [];

async function refreshBackupInfo() {
  try { exportCache = await getAllRecipes(); } catch { exportCache = []; }
  const count = exportCache.length;
  const last = readLastBackup();
  const el = $('lastBackup');
  el.classList.toggle('warn', !last && count > 0);
  el.textContent = last ? `Último backup: ${formatDate(last)}` : (count > 0 ? 'Ainda não fizeste nenhuma cópia.' : '');
  el.hidden = !el.textContent;
  $('exportBtn').disabled = count === 0;
  $('exportHint').textContent = count === 0
    ? 'Ainda não há receitas para exportar'
    : `Cria um ficheiro com ${plural(count, 'receita', 'receitas')}`;
}

function openBackup() {
  refreshBackupInfo();
  backupSheet.hidden = false;
  void backupSheet.offsetHeight;
  backupSheet.classList.add('open');
}

function closeBackup() {
  backupSheet.classList.remove('open');
  setTimeout(() => { backupSheet.hidden = true; }, 320);
}

function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportRecipes() {
  const recipes = exportCache;
  if (!recipes.length) return;
  const now = new Date();
  const data = {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    recipes,
  };
  const stamp = now.toISOString().slice(0, 10);
  const name = `receitas-backup-${stamp}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });

  // No iPhone abre a folha de partilha ("Guardar em Ficheiros", AirDrop, Mail…)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Backup das receitas' });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // cancelado pelo utilizador
      if (e && e.name === 'NotAllowedError') downloadFile(blob, name);
      else throw e;
    }
  } else {
    downloadFile(blob, name);
  }
  writeLastBackup(Date.now());
  refreshBackupInfo();
  toast(`${plural(recipes.length, 'receita exportada', 'receitas exportadas')}`);
}

const strList = (v) => (Array.isArray(v) ? v : [])
  .filter((x) => typeof x === 'string')
  .map((x) => x.trim())
  .filter(Boolean);

function cleanRecipe(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;
  const now = Date.now();
  const num = (v) => (Number.isFinite(v) ? v : now);
  return {
    ...raw, // mantém campos de versões futuras
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    title,
    ingredients: strList(raw.ingredients),
    steps: strList(raw.steps),
    prepTime: parseCount(raw.prepTime ?? ''),
    cookTime: parseCount(raw.cookTime ?? ''),
    servings: parseCount(raw.servings ?? ''),
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
  };
}

async function importRecipes(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('Ficheiro inválido');
    return;
  }
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.recipes) ? data.recipes : null);
  if (!list) {
    toast('Este ficheiro não é um backup de receitas');
    return;
  }
  const incoming = list.map(cleanRecipe).filter(Boolean);
  if (!incoming.length) {
    toast('O ficheiro não tem receitas');
    return;
  }
  if (!confirm(`Importar ${plural(incoming.length, 'receita', 'receitas')}?\nAs receitas que já tens mantêm-se.`)) return;

  const current = await getAllRecipes();
  const existing = new Map(current.map((r) => [r.id, r]));
  // Receitas sem id (ex.: ficheiros feitos à mão) comparam-se pelo conteúdo
  const contentKey = (r) => JSON.stringify([r.title.toLocaleLowerCase('pt'), r.ingredients, r.steps]);
  const known = new Set(current.map(contentKey));
  const toSave = [];
  let added = 0;
  let updated = 0;
  for (const r of incoming) {
    const cur = existing.get(r.id);
    const key = contentKey(r);
    if (!cur && known.has(key)) continue; // já existe igual
    if (!cur) { added++; toSave.push(r); known.add(key); }
    else if (r.updatedAt > (cur.updatedAt || 0)) { updated++; toSave.push(r); }
  }
  const skipped = incoming.length - added - updated;

  if (toSave.length) await saveMany(toSave);
  await render();
  refreshBackupInfo();

  const parts = [];
  if (added) parts.push(plural(added, 'nova', 'novas'));
  if (updated) parts.push(plural(updated, 'atualizada', 'atualizadas'));
  if (!parts.length) toast('Já tinhas todas estas receitas');
  else toast(parts.join(' · ') + (skipped ? ` · ${skipped} iguais` : ''));
}

$('backupBtn').addEventListener('click', openBackup);
$('backupClose').addEventListener('click', closeBackup);
backupSheet.querySelector('[data-close]').addEventListener('click', closeBackup);
$('exportBtn').addEventListener('click', () => {
  exportRecipes().catch((e) => { console.error(e); toast('Não foi possível exportar'); });
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) importRecipes(file).catch((err) => { console.error(err); toast('Não foi possível importar'); });
});

/* ---------- Arranque ---------- */
$('version').textContent = `v${APP_VERSION}`;
render().then(() => {
  // Ao reabrir a app com uma receita aberta, volta à lista
  if (location.hash) history.replaceState(null, '', location.pathname);
});

/* ---------- Offline / atualizações ---------- */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  });
}
