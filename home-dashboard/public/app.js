// Thuisdashboard — frontend zonder build-stap.

const ICONS = {
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  bulb: '<path d="M9 18h6M10 22h4M15 14c.2-1 .7-1.7 1.5-2.5A4.6 4.6 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.8.8 1.3 1.5 1.5 2.5"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  thermometer: '<path d="M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18M7 6h1v4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/>',
  pylon: '<path d="M8 22 12 2l4 20M6 8h12M5 14h14M9 14l6-6M15 14 9 8"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.grid}</svg>`;

const state = { config: null, status: {}, busyUntil: 0, pending: new Set(), rendered: new Map(), connected: true };
const $ = (sel, root = document) => root.querySelector(sel);

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmt(value, decimals) {
  if (typeof value !== 'number' || Number.isNaN(value)) return value == null ? '–' : esc(value);
  const abs = Math.abs(value);
  const d = decimals ?? (Number.isInteger(value) ? 0 : abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d }).format(value);
}

function valueWithUnit(m, cls = '') {
  const v = fmt(m.value, m.decimals);
  const sign = m.trend === 'up' && typeof m.value === 'number' && m.value > 0 ? '+' : '';
  const trendCls = m.trend ? ` ${m.trend === 'up' ? 'up' : 'down'}` : '';
  if (m.unit === '€') return `<span class="${cls}${trendCls}">€ ${sign}${v}</span>`;
  return `<span class="${cls}${trendCls}">${sign}${v}${m.unit ? `<small> ${esc(m.unit)}</small>` : ''}</span>`;
}

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'zojuist';
  if (s < 60) return `${s}s geleden`;
  if (s < 3600) return `${Math.round(s / 60)} min geleden`;
  return new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

async function api(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3500);
}

// ---------- rendering ----------

function renderControl(tile, item, c) {
  const data = `data-tile="${esc(tile.id)}" data-device="${esc(item.id)}" data-key="${esc(c.key)}"`;
  switch (c.type) {
    case 'toggle':
      return `<label class="switch" title="${c.value ? 'Uitzetten' : 'Aanzetten'}"><input type="checkbox" role="switch" ${data} data-type="toggle" ${c.value ? 'checked' : ''} ${c.disabled ? 'disabled' : ''} aria-label="${esc(item.name)}"><span class="track"></span></label>`;
    case 'range':
      if (c.stepper) {
        return `<div class="stepper" ${data} data-type="stepper" data-step="${c.step ?? 1}" data-min="${c.min ?? ''}" data-max="${c.max ?? ''}" data-value="${c.value ?? ''}">
          <button type="button" data-dir="-1" aria-label="Lager">−</button>
          <output>${fmt(c.value, 1)}${c.unit ? ` ${esc(c.unit)}` : ''}</output>
          <button type="button" data-dir="1" aria-label="Hoger">+</button></div>`;
      }
      return `<div class="ctl-row"><span>${esc(c.label ?? '')}</span><input type="range" ${data} data-type="range" data-unit="${esc(c.unit ?? '')}" min="${c.min ?? 0}" max="${c.max ?? 100}" step="${c.step ?? 1}" value="${c.value ?? 0}" ${c.disabled ? 'disabled' : ''} aria-label="${esc(c.label ?? c.key)}"><output>${fmt(c.value)}${esc(c.unit ?? '')}</output></div>`;
    case 'color':
      return `<div class="ctl-row"><span>${esc(c.label ?? 'Kleur')}</span><input type="color" ${data} data-type="color" value="${esc(c.value ?? '#ffffff')}"></div>`;
    case 'button':
      return `<button type="button" class="btn" ${data} data-type="button">${esc(c.label ?? c.key)}</button>`;
    default:
      return '';
  }
}

function renderItem(tile, item) {
  const controls = item.controls ?? [];
  const toggle = controls.find((c) => c.type === 'toggle');
  const stepper = controls.find((c) => c.stepper);
  const extra = controls.filter((c) => c !== toggle && c !== stepper);
  const buttons = extra.filter((c) => c.type === 'button');
  const sliders = extra.filter((c) => c.type !== 'button');
  // Sliders alleen tonen als de lamp aan staat — houdt de kaart rustig.
  const showSliders = sliders.length && (!toggle || toggle.value);
  const metrics = (item.metrics ?? []).map((m) => `<span>${esc(m.label)} <b>${valueWithUnit(m)}</b></span>`).join('');

  return `<div class="item${item.online === false ? ' offline' : ''}${toggle?.value ? ' is-on' : ''}">
    <div class="item-row">
      <span class="item-icon">${icon(item.icon ?? tile.icon)}</span>
      <div class="item-main">
        <div class="item-name">${esc(item.name)}</div>
        ${metrics ? `<div class="item-metrics">${metrics}</div>` : ''}
      </div>
      ${stepper ? renderControl(tile, item, stepper) : ''}
      ${toggle ? renderControl(tile, item, toggle) : ''}
    </div>
    ${showSliders ? `<div class="item-extra">${sliders.map((c) => renderControl(tile, item, c)).join('')}</div>` : ''}
    ${buttons.length ? `<div class="item-extra btn-row">${buttons.map((c) => renderControl(tile, item, c)).join('')}</div>` : ''}
  </div>`;
}

function renderFlow(f) {
  const kw = (w) => (typeof w !== 'number' ? '–' : Math.abs(w) >= 1000 ? `${fmt(w / 1000, 2)} kW` : `${fmt(Math.round(w), 0)} W`);
  const pvActive = (f.pv ?? 0) > 20;
  const gridActive = (f.grid ?? 0) > 20;
  const gridArrow = f.gridDirection === 'export' ? '→' : f.gridDirection === 'import' ? '←' : '·';
  const gridCap = f.gridDirection === 'export' ? 'Teruglevering' : f.gridDirection === 'import' ? 'Afname' : 'Net';
  return `<div class="flow">
    <div class="flow-node sun"><div class="flow-bubble">${icon('sun')}</div><div class="flow-val">${kw(f.pv)}</div><div class="flow-cap">Zon</div></div>
    <div class="flow-arrow ${pvActive ? 'active' : 'idle'}">→</div>
    <div class="flow-node home"><div class="flow-bubble">${icon('home')}</div><div class="flow-val">${kw(f.load)}</div><div class="flow-cap">Huis${f.chargeLevel != null ? ` · ${icon('battery')} ${fmt(f.chargeLevel, 0)}%` : ''}</div></div>
    <div class="flow-arrow ${gridActive ? 'active' : 'idle'}">${gridArrow}</div>
    <div class="flow-node net"><div class="flow-bubble">${icon('pylon')}</div><div class="flow-val">${kw(f.grid)}</div><div class="flow-cap">${gridCap}</div></div>
  </div>`;
}

function renderCard(tile) {
  const s = state.status[tile.id] ?? { status: 'loading' };
  const d = s.data;
  const statusText = s.status === 'loading' ? 'Laden…' : s.status === 'error' ? 'Fout' : ago(s.updatedAt);
  const head = `<div class="card-head">
      <span class="card-icon">${icon(tile.icon)}</span>
      <div style="flex:1;min-width:0">
        <div class="card-title">${esc(tile.name)}</div>
        <div class="card-sub"><span class="dot ${s.status}"></span>${esc(statusText)}${tile.demo ? ' <span class="badge">demo</span>' : ''}</div>
      </div>
      ${tile.openUrl ? `<a class="icon-btn" href="${esc(tile.openUrl)}" target="_blank" rel="noopener" title="Open ${esc(tile.name)}">${icon('external')}</a>` : ''}
    </div>`;

  let body = '';
  if (s.error) body += `<div class="error-box">${esc(s.error)}</div>`;
  if (!d) {
    if (s.status === 'loading') body += '<div class="skeleton" style="width:40%;height:34px"></div><div class="skeleton"></div><div class="skeleton" style="width:70%"></div>';
  } else {
    if (d.summary) {
      body += `<div class="summary"><span class="summary-label">${esc(d.summary.label ?? '')}</span>
        ${d.summary.unit === '€' ? '<span class="summary-unit">€</span>' : ''}
        <span class="summary-value${d.summary.trend ? ` ${d.summary.trend}` : ''}">${fmt(d.summary.value, d.summary.decimals)}</span>
        ${d.summary.unit && d.summary.unit !== '€' ? `<span class="summary-unit">${esc(d.summary.unit)}</span>` : ''}</div>`;
    }
    if (d.flow) body += renderFlow(d.flow);
    if (d.metrics?.length) {
      body += `<div class="metrics">${d.metrics.map((m) => `<div class="metric"><div class="metric-label">${m.icon ? icon(m.icon) : ''}${esc(m.label)}</div><div class="metric-value">${valueWithUnit(m)}</div></div>`).join('')}</div>`;
    }
    if (d.items?.length) body += `<div class="items">${d.items.map((it) => renderItem(tile, it)).join('')}</div>`;
    if (d.note && !tile.demo) body += `<div class="note">${esc(d.note)}</div>`;
  }
  return head + body;
}

function renderCards(force = false) {
  if (!force && Date.now() < state.busyUntil) return;
  for (const tile of state.config.tiles) {
    const el = document.getElementById(`card-${tile.id}`);
    // Niet her-renderen terwijl iemand een slider vasthoudt of typt in deze kaart.
    if (!force && el.contains(document.activeElement) && document.activeElement.matches('input[type=range], input[type=color]')) continue;
    const html = renderCard(tile);
    if (state.rendered.get(tile.id) !== html) {
      el.innerHTML = html;
      state.rendered.set(tile.id, html);
    }
    el.classList.toggle('pending', [...state.pending].some((p) => p.startsWith(`${tile.id}|`)));
  }
}

// ---------- data ----------

async function refresh() {
  try {
    const list = await api('/api/status');
    for (const s of list) state.status[s.id] = s;
    setConnected(true);
    renderCards();
  } catch {
    setConnected(false);
  }
}

function setConnected(ok) {
  state.connected = ok;
  const el = $('#conn');
  el.classList.toggle('down', !ok);
  el.title = ok ? 'Verbonden' : 'Geen verbinding met de server';
}

async function sendControl(tileId, deviceId, key, value) {
  const token = `${tileId}|${deviceId}|${key}`;
  state.pending.add(token);
  renderCards(true);
  try {
    const result = await api(`/api/integrations/${encodeURIComponent(tileId)}/control`, {
      method: 'POST',
      body: JSON.stringify({ deviceId, key, value }),
    });
    state.status[tileId] = result;
  } catch (err) {
    toast(`Bediening mislukt: ${err.message}`, true);
  } finally {
    state.pending.delete(token);
    state.busyUntil = 0;
    renderCards(true);
  }
}

// ---------- events ----------

function controlTarget(el) {
  return { tile: el.dataset.tile, device: el.dataset.device, key: el.dataset.key };
}

function bindEvents() {
  const grid = $('#grid');

  grid.addEventListener('change', (e) => {
    const el = e.target;
    const t = controlTarget(el);
    if (!t.tile) return;
    if (el.dataset.type === 'toggle') sendControl(t.tile, t.device, t.key, el.checked);
    if (el.dataset.type === 'range') sendControl(t.tile, t.device, t.key, Number(el.value));
    if (el.dataset.type === 'color') sendControl(t.tile, t.device, t.key, el.value);
  });

  grid.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.type === 'range') {
      el.nextElementSibling.textContent = `${fmt(Number(el.value))}${el.dataset.unit}`;
      state.busyUntil = Date.now() + 2500;
    }
  });

  const stepTimers = new Map();
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.type === 'button') {
      const t = controlTarget(btn);
      sendControl(t.tile, t.device, t.key, true);
      return;
    }
    const stepper = btn.closest('[data-type="stepper"]');
    if (stepper && btn.dataset.dir) {
      const { step, min, max } = stepper.dataset;
      let value = Number(stepper.dataset.value) + Number(btn.dataset.dir) * Number(step);
      if (min !== '') value = Math.max(Number(min), value);
      if (max !== '') value = Math.min(Number(max), value);
      value = Math.round(value * 100) / 100;
      stepper.dataset.value = value;
      const unit = stepper.querySelector('output').textContent.replace(/^[\d.,\s-]+/, '');
      stepper.querySelector('output').textContent = `${fmt(value, 1)} ${unit}`.trim();
      state.busyUntil = Date.now() + 3000;
      // Meerdere klikken samenvoegen tot één opdracht.
      const t = controlTarget(stepper);
      const id = `${t.tile}|${t.device}`;
      clearTimeout(stepTimers.get(id));
      stepTimers.set(id, setTimeout(() => sendControl(t.tile, t.device, t.key, value), 700));
    }
  });
}

// ---------- shell / navigatie ----------

function buildShell() {
  const { config } = state;
  document.title = config.title;
  $('#title').textContent = config.title;
  for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);

  $('#grid').innerHTML = config.tiles.map((t) => `<article class="card${t.wide ? ' wide' : ''}" id="card-${esc(t.id)}"></article>`).join('');

  const tabs = [{ id: '', name: 'Overzicht', icon: 'layout' }, ...config.apps];
  $('#tabs').innerHTML = tabs.map((t) => `<a class="tab" href="#/${t.id ? `app/${esc(t.id)}` : ''}" data-view="${esc(t.id)}">${icon(t.icon)}<span>${esc(t.name)}</span></a>`).join('');
  if (!config.apps.length) $('#tabs').style.visibility = 'hidden';
}

/** Ingesloten apps worden pas geladen bij eerste bezoek en blijven daarna actief. */
function showView() {
  const appId = (location.hash.match(/^#\/app\/(.+)$/) ?? [])[1];
  const app = state.config.apps.find((a) => a.id === appId);
  for (const tab of document.querySelectorAll('.tab')) {
    tab.toggleAttribute('aria-current', (tab.dataset.view || null) === (app?.id ?? null));
    if (tab.hasAttribute('aria-current')) tab.setAttribute('aria-current', 'page');
  }
  $('#view-overview').hidden = Boolean(app);
  for (const v of document.querySelectorAll('.app-view')) v.hidden = v.dataset.app !== app?.id;

  if (app && !document.querySelector(`.app-view[data-app="${CSS.escape(app.id)}"]`)) {
    const view = document.createElement('section');
    view.className = 'view app-view';
    view.dataset.app = app.id;
    view.innerHTML = `<div class="app-bar">${icon(app.icon)} ${esc(app.name)}
        <a href="${esc(app.url)}" target="_blank" rel="noopener">Openen in nieuw tabblad ${icon('external')}</a></div>
      <iframe class="app-frame" src="${esc(app.url)}" title="${esc(app.name)}" allow="fullscreen; clipboard-write"></iframe>`;
    $('#main').append(view);
  }
}

function tickClock() {
  $('#clock').textContent = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

async function init() {
  try {
    state.config = await api('/api/config');
  } catch (err) {
    document.body.innerHTML = `<p style="padding:24px">Kan de configuratie niet laden: ${esc(err.message)}</p>`;
    return;
  }
  buildShell();
  bindEvents();
  showView();
  window.addEventListener('hashchange', showView);
  tickClock();
  setInterval(tickClock, 10_000);
  renderCards(true);
  await refresh();
  setInterval(refresh, state.config.refreshSeconds * 1000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
}

init();
