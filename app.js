'use strict';

const APP_VERSION = '0.9.0';

/* ---------- Armazenamento local (IndexedDB) ---------- */
const DB_NAME = 'receitas';
const DB_VERSION = 3;
const STORE = 'recipes';
const SETTINGS = 'settings';
const PHOTOS = 'photos'; // fotografias à parte, para a lista carregar depressa

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbReady = openDB();

async function tx(mode, fn, store = STORE) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
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

/* ---------- Fotografias ---------- */
const getPhoto = (id) => tx('readonly', (s) => s.get(id), PHOTOS).then((p) => (p ? p.data : null));
const getAllPhotos = () => tx('readonly', (s) => s.getAll(), PHOTOS).then((r) => r || []);
const putPhoto = (id, data) => tx('readwrite', (s) => { s.put({ id, data }); }, PHOTOS);
const deletePhoto = (id) => tx('readwrite', (s) => { s.delete(id); }, PHOTOS);
const isImageData = (v) => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
    img.src = url;
  });
}

// Reduz a imagem: lado maior até `max` px (ou recorte quadrado para miniaturas)
function resizeImage(img, max, square = false, quality = 0.82) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  let sx = 0; let sy = 0; let sw = w; let sh = h;
  if (square) {
    const side = Math.min(w, h);
    sx = (w - side) / 2; sy = (h - side) / 2; sw = side; sh = side;
  }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function processPhoto(file) {
  const img = await loadImage(file);
  return {
    data: resizeImage(img, 1280),           // ~150–300 KB
    thumb: resizeImage(img, 160, true, 0.75), // ~8 KB, guardada na receita
  };
}

/* ---------- Pratos e categorias ---------- */
const DEFAULT_DISHES = ['Entradas', 'Sopas', 'Prato Principal', 'Sobremesa', 'Bebidas'];
const DEFAULT_CATEGORIES = ['Carne', 'Peixe', 'Vegetariano', 'Arroz', 'Massa', 'Batata', 'Italiano', 'Bolo'];

// Comparação sem acentos nem maiúsculas ("Sopa" = "sopa", "Pão" = "pao")
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const sameName = (a, b) => norm(a) === norm(b);
const byName = (a, b) => a.localeCompare(b, 'pt', { sensitivity: 'base' });

let taxonomy = { dishes: [...DEFAULT_DISHES], categories: [...DEFAULT_CATEGORIES] };

async function loadTaxonomy() {
  try {
    const saved = await tx('readonly', (s) => s.get('taxonomy'), SETTINGS);
    if (saved) taxonomy = { dishes: saved.dishes || [], categories: saved.categories || [], capitalized: Boolean(saved.capitalized) };
    else await saveTaxonomy(); // primeira vez: grava as listas iniciais
    if (!saved || !saved.capitalized) await capitalizeDefaults();
  } catch (e) { console.error(e); }
}

// v0.6.0: as categorias base passam a começar por maiúscula ("carne" → "Carne"),
// tanto na lista como nas receitas que já as usam. Corre uma única vez.
async function capitalizeDefaults() {
  const rename = new Map();
  for (const def of DEFAULT_CATEGORIES) {
    const old = def.toLowerCase();
    if (taxonomy.categories.includes(old)) rename.set(old, def);
  }
  if (rename.size) {
    taxonomy.categories = taxonomy.categories.map((c) => rename.get(c) || c);
    const recipes = await getAllRecipes();
    const changed = recipes
      .filter((r) => (r.categories || []).some((c) => rename.has(c)))
      .map((r) => ({ ...r, categories: r.categories.map((c) => rename.get(c) || c).sort(byName) }));
    if (changed.length) await saveMany(changed);
  }
  taxonomy.capitalized = true;
  await saveTaxonomy();
}

function saveTaxonomy() {
  return tx('readwrite', (s) => { s.put({ key: 'taxonomy', ...taxonomy }); }, SETTINGS);
}

// Junta nomes a uma lista sem duplicar; devolve o nome tal como ficou guardado
function addName(list, name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) return null;
  const found = list.find((x) => sameName(x, clean));
  if (found) return found;
  list.push(clean);
  return clean;
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
  const t = totalTime(r);
  const parts = r.dish
    ? [r.dish, t ? formatMinutes(t) : plural(r.ingredients.length, 'ingrediente', 'ingredientes')]
    : [plural(r.ingredients.length, 'ingrediente', 'ingredientes'), t ? formatMinutes(t) : plural(r.steps.length, 'passo', 'passos')];
  return parts.join(' · ');
}

/* ---------- Ajuste de porções ---------- */
const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const NICE = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
const FR = '½⅓⅔¼¾⅛⅜⅝⅞';
// Uma quantidade: "2", "1,5", "0.5", "1/2", "½", "1 ½", "1 1/2", e intervalos "2-3" / "2 a 3"
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[${FR}])?|[${FR}])`;
const QTY_RE = new RegExp(`(^|[^\\p{L}\\d.,/])(${NUM})(?:(\\s*(?:-|–|a)\\s*)(${NUM}))?(?![\\d/]|[.,]\\d)`, 'u');

function parseNum(t) {
  t = t.trim();
  let total = 0;
  const frac = t.match(new RegExp(`[${FR}]$`));
  if (frac) { total += FRACTIONS[frac[0]]; t = t.slice(0, -1).trim(); }
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return total + Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const simple = t.match(/^(\d+)\/(\d+)$/);
  if (simple) return total + Number(simple[1]) / Number(simple[2]);
  if (t) total += Number(t.replace(',', '.'));
  return total;
}

function formatNum(v, decimal = false) {
  if (v >= 10) return String(Math.round(v));
  if (decimal) return String(Math.round(v * 100) / 100).replace('.', ',');
  const whole = Math.floor(v);
  const rest = v - whole;
  if (rest < 0.03) return String(whole);
  if (rest > 0.97) return String(whole + 1);
  for (const [n, sym] of NICE) {
    if (Math.abs(rest - n) < 0.04) return whole ? `${whole} ${sym}` : sym;
  }
  return (Math.round(v * 10) / 10).toString().replace('.', ',');
}

// Devolve a linha dividida em [antes, quantidade, depois] já ajustada ao fator
function scaleLine(line, factor) {
  if (factor === 1) return [line, '', ''];
  const m = line.match(QTY_RE);
  if (!m) return [line, '', ''];
  const start = m.index + m[1].length;
  const a = parseNum(m[2]);
  if (!a && a !== 0) return [line, '', ''];
  const dec = /[.,]/.test(m[2]); // "1,5 kg" continua em decimal
  let qty = formatNum(a * factor, dec);
  if (m[4]) qty += m[3] + formatNum(parseNum(m[4]) * factor, dec);
  return [line.slice(0, start), qty, line.slice(m.index + m[0].length)];
}

// Preenche um elemento com a linha, destacando a quantidade ajustada
function fillLine(el, line, factor) {
  const [before, qty, after] = scaleLine(line, factor);
  if (!qty) { el.textContent = line; return; }
  const strong = document.createElement('strong');
  strong.className = 'qty';
  strong.textContent = qty;
  el.replaceChildren(before, strong, after);
}

let viewServings = null; // porções escolhidas para a receita aberta
const scaleFactor = (r) => (r && r.servings && viewServings ? viewServings / r.servings : 1);

// Controlo − N +
function servingsStepper(r, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'stepper';
  const minus = document.createElement('button');
  minus.type = 'button';
  minus.textContent = '−';
  minus.setAttribute('aria-label', 'Menos porções');
  const value = document.createElement('strong');
  value.textContent = viewServings;
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.textContent = '+';
  plus.setAttribute('aria-label', 'Mais porções');
  minus.disabled = viewServings <= 1;
  plus.disabled = viewServings >= 99;
  minus.addEventListener('click', () => { viewServings = Math.max(1, viewServings - 1); onChange(); });
  plus.addEventListener('click', () => { viewServings = Math.min(99, viewServings + 1); onChange(); });
  wrap.append(minus, value, plus);
  wrap.classList.toggle('changed', viewServings !== r.servings);
  return wrap;
}

// Botão "chip" reutilizável
function chip(text, { active = false, cls = '', data = {} } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip ${cls}`.trim();
  b.textContent = text;
  b.setAttribute('aria-pressed', String(active));
  if (active) b.classList.add('on');
  Object.entries(data).forEach(([k, v]) => { b.dataset[k] = v; });
  return b;
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- Lista, pesquisa e filtros ---------- */
const filters = { q: '', dish: null, cat: null, fav: false };
let allRecipes = [];

/* Ordenação (guardada neste telemóvel) */
const SORT_KEY = 'receitas.sort';
const SORTS = {
  az: (a, b) => byName(a.title, b.title),
  recent: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  quick: (a, b) => {
    const ta = totalTime(a) || Infinity;
    const tb = totalTime(b) || Infinity;
    return ta === tb ? byName(a.title, b.title) : ta - tb;
  },
};
let sortBy = 'az';
try { const v = localStorage.getItem(SORT_KEY); if (SORTS[v]) sortBy = v; } catch { /* ignora */ }

function matches(r) {
  if (filters.fav && !r.favorite) return false;
  if (filters.dish && r.dish !== filters.dish) return false;
  const cats = r.categories || [];
  if (filters.cat && !cats.includes(filters.cat)) return false;
  if (filters.q) {
    const words = norm(filters.q).split(/\s+/).filter(Boolean);
    const hay = norm([r.title, r.dish || '', cats.join(' '), r.ingredients.join(' ')].join(' '));
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

function renderFilters() {
  const usedDishes = new Set(allRecipes.map((r) => r.dish).filter(Boolean));
  const usedCats = new Set(allRecipes.flatMap((r) => r.categories || []));
  // Limpa filtros que deixaram de existir
  if (filters.dish && !usedDishes.has(filters.dish)) filters.dish = null;
  const hasFav = allRecipes.some((r) => r.favorite);
  if (!hasFav) filters.fav = false;
  if (filters.cat && !usedCats.has(filters.cat)) filters.cat = null;

  const dishes = taxonomy.dishes.filter((d) => usedDishes.has(d));
  const cats = taxonomy.categories.filter((c) => usedCats.has(c)).sort(byName);

  const dRow = $('dishFilters');
  dRow.replaceChildren(
    ...(hasFav ? [chip('♥ Favoritas', { active: filters.fav, cls: 'fav', data: { fav: '1' } })] : []),
    ...(dishes.length ? [chip('Todos', { active: !filters.dish, data: { dish: '' } })] : []),
    ...dishes.map((d) => chip(d, { active: filters.dish === d, data: { dish: d } })),
  );
  dRow.hidden = dishes.length === 0 && !hasFav;

  const cRow = $('catFilters');
  cRow.replaceChildren(
    chip('Todas', { active: !filters.cat, cls: 'tag', data: { cat: '' } }),
    ...cats.map((c) => chip(c, { active: filters.cat === c, cls: 'tag', data: { cat: c } })),
  );
  cRow.hidden = cats.length === 0;
}

function renderList() {
  const shown = allRecipes.filter(matches).sort(SORTS[sortBy]);
  const list = $('list');
  list.replaceChildren();

  for (const r of shown) {
    const li = document.createElement('li');
    li.className = 'row';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.dataset.id = r.id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    if (isImageData(r.thumb)) {
      avatar.classList.add('photo');
      const im = document.createElement('img');
      im.src = r.thumb;
      im.alt = '';
      im.loading = 'lazy';
      avatar.append(im);
    } else {
      avatar.textContent = (r.title.trim()[0] || '?').toUpperCase();
    }

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

    if (r.favorite) {
      const heart = document.createElement('span');
      heart.className = 'row-fav';
      heart.setAttribute('aria-label', 'Favorita');
      heart.textContent = '♥';
      li.append(avatar, text, heart, chev);
    } else {
      li.append(avatar, text, chev);
    }
    list.append(li);
  }

  const total = allRecipes.length;
  const filtering = Boolean(filters.q.trim() || filters.dish || filters.cat || filters.fav);
  $('empty').hidden = total > 0;
  $('tools').hidden = total === 0;
  $('noResults').hidden = !(total > 0 && shown.length === 0);
  $('count').hidden = total === 0;
  $('count').textContent = filtering
    ? `${shown.length} de ${plural(total, 'receita', 'receitas')}`
    : plural(total, 'receita', 'receitas');
  $('clearFilters').hidden = !filtering;
  $('sort').value = sortBy;
  $('sort').parentElement.hidden = total < 2;
}

async function render() {
  try {
    allRecipes = await getAllRecipes();
  } catch (e) {
    allRecipes = [];
    toast('Erro ao ler as receitas');
    console.error(e);
  }
  renderFilters();
  renderList();
}

$('search').addEventListener('input', (e) => {
  filters.q = e.target.value;
  renderList();
});
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur();
});
$('dishFilters').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (b.dataset.fav) {
    filters.fav = !filters.fav;
  } else {
    const d = b.dataset.dish;
    filters.dish = !d || filters.dish === d ? null : d;
  }
  renderFilters();
  renderList();
});
$('catFilters').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  const c = b.dataset.cat;
  filters.cat = !c || filters.cat === c ? null : c;
  renderFilters();
  renderList();
});
function clearFilters() {
  filters.q = '';
  filters.dish = null;
  filters.cat = null;
  filters.fav = false;
  $('search').value = '';
  renderFilters();
  renderList();
}
$('clearFilters').addEventListener('click', clearFilters);
$('sort').addEventListener('change', (e) => {
  sortBy = SORTS[e.target.value] ? e.target.value : 'az';
  try { localStorage.setItem(SORT_KEY, sortBy); } catch { /* ignora */ }
  renderList();
});
$('noResultsClear').addEventListener('click', clearFilters);

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
  const hero = $('detailPhoto');
  if (isImageData(r.thumb)) {
    hero.hidden = false;
    if (hero.dataset.id !== r.id || hero.dataset.thumb !== r.thumb.slice(-32)) {
      hero.dataset.id = r.id;
      hero.dataset.thumb = r.thumb.slice(-32);
      hero.src = r.thumb; // mostra logo a miniatura e troca pela foto completa
      getPhoto(r.id).then((data) => { if (data && hero.dataset.id === r.id) hero.src = data; }).catch(() => {});
    }
  } else {
    hero.hidden = true;
    hero.removeAttribute('src');
    hero.dataset.id = '';
  }
  const favBtn = $('favBtn');
  favBtn.classList.toggle('on', Boolean(r.favorite));
  favBtn.setAttribute('aria-pressed', String(Boolean(r.favorite)));
  favBtn.setAttribute('aria-label', r.favorite ? 'Remover dos favoritos' : 'Marcar como favorita');
  $('detailMeta').textContent = summary({ ...r, dish: null }); // o prato aparece na etiqueta

  const tags = $('detailTags');
  tags.replaceChildren(
    ...(r.dish ? [Object.assign(document.createElement('span'), { className: 'pill dish', textContent: r.dish })] : []),
    ...(r.categories || []).map((c) => Object.assign(document.createElement('span'), { className: 'pill', textContent: c })),
  );
  tags.hidden = !tags.children.length;

  if (!r.servings) viewServings = null;
  else if (!viewServings) viewServings = r.servings;
  const factor = scaleFactor(r);

  const facts = [
    ['Preparação', formatMinutes(r.prepTime)],
    ['Cozedura', formatMinutes(r.cookTime)],
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
  if (r.servings) {
    const div = document.createElement('div');
    div.className = 'fact servings';
    const l = document.createElement('span');
    l.textContent = 'Porções';
    div.append(servingsStepper(r, () => fillDetail(current)), l);
    factsEl.append(div);
  }
  factsEl.hidden = !factsEl.children.length;

  const reset = $('servingsReset');
  reset.hidden = factor === 1;
  reset.textContent = `Quantidades para ${plural(viewServings || 0, 'porção', 'porções')} · repor ${r.servings}`;

  const notes = (r.notes || '').trim();
  $('notesTitle').hidden = !notes;
  $('detailNotes').hidden = !notes;
  $('detailNotes').textContent = notes;

  const ing = $('detailIngredients');
  ing.replaceChildren(...r.ingredients.map((t) => {
    const li = document.createElement('li');
    fillLine(li, t, factor);
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
  if (!current || current.id !== r.id) viewServings = null; // nova receita: porções originais
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

window.addEventListener('popstate', async () => {
  const st = history.state || {};
  if (st.recipe) {
    await showDetail(st.recipe);
    if (st.cook && current) showCook(current);
    else hideCook();
  } else {
    hideCook();
    hideDetail();
  }
});

$('backBtn').addEventListener('click', goBack);
$('servingsReset').addEventListener('click', () => {
  if (!current) return;
  viewServings = current.servings;
  fillDetail(current);
});

/* ---------- Modo cozinhar ---------- */
const cook = $('cook');
const cookState = { id: null, tab: 'ing', step: 0, checked: new Set() };
let wakeLock = null;

async function keepAwake() {
  if (!('wakeLock' in navigator)) return false;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    return true;
  } catch (e) {
    console.warn('wakeLock', e);
    return false;
  }
}
function releaseAwake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
// Ao voltar à app (ex.: depois de bloquear o ecrã), volta a manter o ecrã ligado
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !cook.hidden && !wakeLock) keepAwake();
});

function renderCook() {
  const r = current;
  if (!r) return;
  const hasIng = r.ingredients.length > 0;
  const hasSteps = r.steps.length > 0;
  if (!hasIng) cookState.tab = 'steps';
  if (!hasSteps) cookState.tab = 'ing';

  $('cookTitle').textContent = r.title;
  $('cookTabs').hidden = !(hasIng && hasSteps);
  $('tabIng').classList.toggle('on', cookState.tab === 'ing');
  $('tabSteps').classList.toggle('on', cookState.tab === 'steps');
  $('tabIng').setAttribute('aria-selected', String(cookState.tab === 'ing'));
  $('tabSteps').setAttribute('aria-selected', String(cookState.tab === 'steps'));
  const done = r.ingredients.filter((_, i) => cookState.checked.has(i)).length;
  $('tabIng').textContent = hasIng ? `Ingredientes ${done}/${r.ingredients.length}` : 'Ingredientes';

  // Ingredientes
  $('cookIng').hidden = cookState.tab !== 'ing';
  $('cookIngList').replaceChildren(...r.ingredients.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cook-ing';
    b.dataset.i = i;
    const on = cookState.checked.has(i);
    b.classList.toggle('done', on);
    b.setAttribute('aria-pressed', String(on));
    const box = document.createElement('span');
    box.className = 'box';
    box.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('span');
    fillLine(txt, t, scaleFactor(r));
    b.append(box, txt);
    return b;
  }));
  $('toSteps').hidden = !hasSteps;
  const cs = $('cookServings');
  if (r.servings) {
    const label = document.createElement('span');
    label.textContent = 'Porções';
    cs.replaceChildren(label, servingsStepper(r, () => { renderCook(); fillDetail(current); }));
    cs.hidden = false;
  } else {
    cs.hidden = true;
  }

  // Passos
  $('cookSteps').hidden = cookState.tab !== 'steps';
  if (hasSteps) {
    const n = r.steps.length;
    cookState.step = Math.max(0, Math.min(cookState.step, n - 1));
    $('stepCount').textContent = `Passo ${cookState.step + 1} de ${n}`;
    $('stepText').textContent = r.steps[cookState.step];
    $('stepDots').replaceChildren(...r.steps.map((_, i) => {
      const d = document.createElement('span');
      d.className = 'dot' + (i === cookState.step ? ' on' : i < cookState.step ? ' past' : '');
      return d;
    }));
    $('prevStep').disabled = cookState.step === 0;
    $('nextStep').textContent = cookState.step === n - 1 ? 'Concluir' : 'Seguinte';
  }
}

function showCook(r) {
  if (cookState.id !== r.id) {
    cookState.id = r.id;
    cookState.step = 0;
    cookState.checked = new Set();
    cookState.tab = r.ingredients.length ? 'ing' : 'steps';
  }
  renderCook();
  if (cook.hidden) {
    cook.hidden = false;
    void cook.offsetHeight;
    cook.classList.add('open');
    keepAwake().then((ok) => { $('awakeNote').hidden = ok; });
  }
}

function hideCook() {
  if (cook.hidden) return;
  releaseAwake();
  cook.classList.remove('open');
  setTimeout(() => { if (!cook.classList.contains('open')) cook.hidden = true; }, 300);
}

function openCook() {
  if (!current) return;
  if (!current.ingredients.length && !current.steps.length) {
    toast('Esta receita ainda não tem ingredientes nem passos');
    return;
  }
  history.pushState({ recipe: current.id, cook: true }, '', `#r=${encodeURIComponent(current.id)}&cozinhar`);
  showCook(current);
}

function closeCook() {
  if (history.state && history.state.cook) history.back();
  else hideCook();
}

function goStep(delta) {
  const n = current ? current.steps.length : 0;
  const next = cookState.step + delta;
  if (next >= n) { closeCook(); toast('Bom apetite!'); return; }
  if (next < 0) return;
  cookState.step = next;
  renderCook();
}

$('cookBtn').addEventListener('click', openCook);
$('cookClose').addEventListener('click', closeCook);
$('tabIng').addEventListener('click', () => { cookState.tab = 'ing'; renderCook(); });
$('tabSteps').addEventListener('click', () => { cookState.tab = 'steps'; renderCook(); });
$('toSteps').addEventListener('click', () => { cookState.tab = 'steps'; renderCook(); });
$('cookIngList').addEventListener('click', (e) => {
  const b = e.target.closest('.cook-ing');
  if (!b) return;
  const i = Number(b.dataset.i);
  if (cookState.checked.has(i)) cookState.checked.delete(i); else cookState.checked.add(i);
  renderCook();
});
$('prevStep').addEventListener('click', () => goStep(-1));
$('nextStep').addEventListener('click', () => goStep(1));

// Deslizar para o lado também muda de passo
let touchX = null;
let touchY = null;
$('stepCard').addEventListener('touchstart', (e) => {
  touchX = e.touches[0].clientX;
  touchY = e.touches[0].clientY;
}, { passive: true });
$('stepCard').addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  touchX = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx < 0 && cookState.step < current.steps.length - 1) goStep(1);
    else if (dx > 0) goStep(-1);
  }
});
$('editBtn').addEventListener('click', () => { if (current) openSheet(current); });

$('favBtn').addEventListener('click', async () => {
  if (!current) return;
  const r = { ...current, favorite: !current.favorite, updatedAt: Date.now() };
  try {
    await saveRecipe(r);
    current = r;
    fillDetail(r);
    await render();
    toast(r.favorite ? 'Adicionada aos favoritos' : 'Removida dos favoritos');
  } catch (e) {
    console.error(e);
    toast('Não foi possível guardar');
  }
});

$('deleteBtn').addEventListener('click', async () => {
  if (!current) return;
  if (!confirm(`Apagar "${current.title}"?\nEsta ação não pode ser desfeita.`)) return;
  try {
    await deleteRecipe(current.id);
    await deletePhoto(current.id).catch(() => {});
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
let formDish = null;
let formCats = new Set();

const fields = () => [titleInput, ingInput, stepsInput, prepInput, cookInput, servingsInput, notesInput];
let formPhoto; // undefined = sem alterações, null = remover, { data, thumb } = nova
const snapshot = () => [...fields().map((el) => el.value.trim()), formDish || '', [...formCats].sort().join('|'), formPhoto === undefined ? '' : 'foto'].join('\u0000');

function renderFormPhoto() {
  const thumb = formPhoto === undefined ? (editing && editing.thumb) : formPhoto && formPhoto.thumb;
  const has = isImageData(thumb);
  $('photoPreview').hidden = !has;
  $('photoAdd').hidden = has;
  if (has) $('photoImg').src = formPhoto && formPhoto.data ? formPhoto.data : thumb;
  if (has && formPhoto === undefined && editing) {
    getPhoto(editing.id).then((d) => { if (d && formPhoto === undefined) $('photoImg').src = d; }).catch(() => {});
  }
}

function pickPhoto() { $('photoFile').click(); }
$('photoAdd').addEventListener('click', pickPhoto);
$('photoChange').addEventListener('click', pickPhoto);
$('photoRemove').addEventListener('click', () => { formPhoto = null; renderFormPhoto(); });
$('photoFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('photoAdd').classList.add('busy');
  try {
    formPhoto = await processPhoto(file);
    renderFormPhoto();
  } catch (err) {
    console.error(err);
    toast('Não foi possível usar esta imagem');
  } finally {
    $('photoAdd').classList.remove('busy');
  }
});

function renderFormChips() {
  $('formDish').replaceChildren(
    ...taxonomy.dishes.map((d) => chip(d, { active: formDish === d, data: { dish: d } })),
    chip('+ Novo', { cls: 'add', data: { add: 'dish' } }),
  );
  $('formCats').replaceChildren(
    ...[...taxonomy.categories].sort(byName).map((c) => chip(c, { active: formCats.has(c), cls: 'tag', data: { cat: c } })),
    chip('+ Nova', { cls: 'add', data: { add: 'cat' } }),
  );
}

async function askNewName(kind) {
  const isDish = kind === 'dish';
  const name = prompt(isDish ? 'Novo prato' : 'Nova categoria');
  if (name === null) return null;
  const list = isDish ? taxonomy.dishes : taxonomy.categories;
  const before = list.length;
  const saved = addName(list, name);
  if (!saved) return null;
  if (list.length !== before) {
    try { await saveTaxonomy(); } catch (e) { console.error(e); }
    renderSettings();
  }
  return saved;
}

$('formDish').addEventListener('click', async (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (b.dataset.add) {
    const name = await askNewName('dish');
    if (name) formDish = name;
  } else {
    formDish = formDish === b.dataset.dish ? null : b.dataset.dish;
  }
  renderFormChips();
});

$('formCats').addEventListener('click', async (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (b.dataset.add) {
    const name = await askNewName('cat');
    if (name) formCats.add(name);
  } else {
    const c = b.dataset.cat;
    if (formCats.has(c)) formCats.delete(c); else formCats.add(c);
  }
  renderFormChips();
});

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
  formDish = recipe && recipe.dish ? recipe.dish : null;
  formCats = new Set(recipe && recipe.categories ? recipe.categories : []);
  formPhoto = undefined;
  renderFormChips();
  renderFormPhoto();
  $('sheet').querySelector('.sheet-body').scrollTop = 0;
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
    dish: formDish,
    categories: [...formCats].sort(byName),
    ...(formPhoto === null ? { thumb: null } : formPhoto ? { thumb: formPhoto.thumb } : {}),
    updatedAt: now,
  };
  saveBtn.disabled = true;
  try {
    if (formPhoto) await putPhoto(recipe.id, formPhoto.data);
    else if (formPhoto === null) await deletePhoto(recipe.id);
    await saveRecipe(recipe);
    closeSheet();
    await render();
    if (editing) {
      current = recipe;
      viewServings = null; // depois de editar, volta às porções da receita
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
let exportPhotos = [];

async function refreshBackupInfo() {
  try { exportCache = await getAllRecipes(); } catch { exportCache = []; }
  try { exportPhotos = await getAllPhotos(); } catch { exportPhotos = []; }
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

/* ---------- Organizar: gerir pratos e categorias ---------- */
function renderSettings() {
  const make = (list, kind) => [
    ...(kind === 'cat' ? [...list].sort(byName) : list).map((name) => {
      const b = chip(name, { cls: `removable${kind === 'cat' ? ' tag' : ''}`, data: { remove: kind, name } });
      b.setAttribute('aria-label', `Remover ${name}`);
      const x = document.createElement('span');
      x.className = 'x';
      x.setAttribute('aria-hidden', 'true');
      x.textContent = '×';
      b.append(x);
      return b;
    }),
    chip(kind === 'dish' ? '+ Adicionar prato' : '+ Adicionar categoria', { cls: 'add', data: { add: kind } }),
  ];
  $('setDishes').replaceChildren(...make(taxonomy.dishes, 'dish'));
  $('setCats').replaceChildren(...make(taxonomy.categories, 'cat'));
}

async function removeName(kind, name) {
  const isDish = kind === 'dish';
  const used = allRecipes.filter((r) => (isDish ? r.dish === name : (r.categories || []).includes(name)));
  const what = isDish ? 'prato' : 'categoria';
  let msg = `Remover ${isDish ? 'o prato' : 'a categoria'} "${name}"?`;
  if (used.length) msg += `\n${plural(used.length, 'receita deixa', 'receitas deixam')} de ter ${isDish ? 'este' : 'esta'} ${what}. As receitas não são apagadas.`;
  if (!confirm(msg)) return;

  if (isDish) taxonomy.dishes = taxonomy.dishes.filter((d) => d !== name);
  else taxonomy.categories = taxonomy.categories.filter((c) => c !== name);
  const now = Date.now();
  const changed = used.map((r) => (isDish
    ? { ...r, dish: null, updatedAt: now }
    : { ...r, categories: r.categories.filter((c) => c !== name), updatedAt: now }));
  try {
    await saveTaxonomy();
    if (changed.length) await saveMany(changed);
  } catch (e) {
    console.error(e);
    toast('Não foi possível remover');
  }
  renderSettings();
  await render();
  refreshBackupInfo(); // atualiza a cópia pronta a exportar
  toast(`"${name}" removid${isDish ? 'o' : 'a'}`);
}

function onSettingsClick(e) {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (b.dataset.add) askNewName(b.dataset.add).then((n) => { if (n) toast(`"${n}" adicionad${b.dataset.add === 'dish' ? 'o' : 'a'}`); });
  else if (b.dataset.remove) removeName(b.dataset.remove, b.dataset.name);
}
$('setDishes').addEventListener('click', onSettingsClick);
$('setCats').addEventListener('click', onSettingsClick);

function openBackup() {
  renderSettings();
  refreshBackupInfo();
  backupSheet.querySelector('.sheet-body').scrollTop = 0;
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
    formatVersion: 3,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    dishes: taxonomy.dishes,
    categories: taxonomy.categories,
    recipes,
    photos: Object.fromEntries(exportPhotos.filter((p) => isImageData(p.data)).map((p) => [p.id, p.data])),
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
    dish: typeof raw.dish === 'string' && raw.dish.trim() ? raw.dish.trim() : null,
    categories: strList(raw.categories),
    favorite: raw.favorite === true,
    thumb: isImageData(raw.thumb) ? raw.thumb : null,
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

  // Junta os pratos e categorias do ficheiro às listas atuais
  if (!Array.isArray(data)) {
    strList(data.dishes).forEach((d) => addName(taxonomy.dishes, d));
    strList(data.categories).forEach((c) => addName(taxonomy.categories, c));
  }
  for (const r of incoming) {
    r.dish = r.dish ? addName(taxonomy.dishes, r.dish) : null;
    r.categories = [...new Set(r.categories.map((c) => addName(taxonomy.categories, c)).filter(Boolean))].sort(byName);
  }
  await saveTaxonomy();
  renderSettings();

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
  // Fotografias das receitas importadas
  const photos = !Array.isArray(data) && data.photos && typeof data.photos === 'object' ? data.photos : {};
  for (const r of toSave) {
    if (isImageData(photos[r.id])) await putPhoto(r.id, photos[r.id]);
    else if (!r.thumb) await deletePhoto(r.id).catch(() => {});
  }
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
loadTaxonomy().then(render).then(() => {
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
