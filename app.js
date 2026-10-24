'use strict';

const APP_VERSION = '0.1.0';

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

async function getAllRecipes() {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function saveRecipe(recipe) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(recipe);
    tx.oncomplete = () => resolve(recipe);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

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
    meta.textContent = `${plural(r.ingredients.length, 'ingrediente', 'ingredientes')} · ${plural(r.steps.length, 'passo', 'passos')}`;
    text.append(title, meta);

    li.append(avatar, text);
    list.append(li);
  }

  $('empty').hidden = recipes.length > 0;
  $('count').hidden = recipes.length === 0;
  $('count').textContent = plural(recipes.length, 'receita', 'receitas');
}

/* ---------- Formulário (folha) ---------- */
const sheet = $('sheet');
const form = $('form');
const titleInput = $('title');
const saveBtn = $('saveBtn');

function isDirty() {
  return [titleInput, $('ingredients'), $('steps')].some((el) => el.value.trim() !== '');
}

function openSheet() {
  form.reset();
  saveBtn.disabled = true;
  sheet.hidden = false;
  void sheet.offsetHeight; // força reflow para a animação
  sheet.classList.add('open');
  setTimeout(() => titleInput.focus(), 320);
}

function closeSheet() {
  document.activeElement && document.activeElement.blur();
  sheet.classList.remove('open');
  setTimeout(() => { sheet.hidden = true; }, 320);
}

function requestClose() {
  if (isDirty() && !confirm('Descartar esta receita?')) return;
  closeSheet();
}

titleInput.addEventListener('input', () => {
  saveBtn.disabled = titleInput.value.trim() === '';
});

titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('ingredients').focus();
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;
  const now = Date.now();
  const recipe = {
    id: newId(),
    title,
    ingredients: toLines($('ingredients').value),
    steps: toLines($('steps').value),
    createdAt: now,
    updatedAt: now,
  };
  saveBtn.disabled = true;
  try {
    await saveRecipe(recipe);
    closeSheet();
    await render();
    toast('Receita guardada');
  } catch (err) {
    console.error(err);
    saveBtn.disabled = false;
    toast('Não foi possível guardar');
  }
});

$('addBtn').addEventListener('click', openSheet);
$('cancelBtn').addEventListener('click', requestClose);
sheet.querySelector('[data-close]').addEventListener('click', requestClose);

/* ---------- Arranque ---------- */
$('version').textContent = `v${APP_VERSION}`;
render();

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
