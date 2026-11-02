import { Integration } from './base.js';
import { getPath, httpRequest, toNumber } from '../util.js';

/**
 * Generieke koppeling met een eigen app (bijvoorbeeld je crypto-applicatie).
 *
 * Twee manieren:
 *  1. Je app levert zelf het dashboard-formaat (summary/metrics/items, zie base.js).
 *     Laat dan "metrics" weg in de config. Bediening gaat als POST naar controlUrl
 *     met { deviceId, key, value }.
 *  2. Je app levert willekeurige JSON en je koppelt velden via paden in de config:
 *     summary: { label, path, unit }, metrics: [{ label, path, unit, decimals, colorBySign }],
 *     list: { path, name, metrics: [...] }, actions: [{ label, url, method, body }]
 */
export class HttpJsonIntegration extends Integration {
  static defaultPollSeconds = 30;

  get headers() {
    return { Accept: 'application/json', ...(this.cfg.headers ?? {}) };
  }

  static metric(source, m) {
    const value = toNumber(getPath(source, m.path));
    const out = { label: m.label, value: value ?? null, unit: m.unit ?? '' };
    if (m.decimals != null) out.decimals = m.decimals;
    if (m.icon) out.icon = m.icon;
    if (m.colorBySign && typeof value === 'number' && value !== 0) out.trend = value > 0 ? 'up' : 'down';
    return out;
  }

  async fetchStatus() {
    this.require('url');
    const res = await httpRequest(this.cfg.url, { headers: this.headers });
    const json = await res.json();

    const mapped = this.cfg.metrics || this.cfg.summary || this.cfg.list;
    if (!mapped) {
      // Optie 1: app levert het dashboard-formaat zelf.
      const data = this.cfg.dataPath ? getPath(json, this.cfg.dataPath) : json;
      return { summary: data.summary, metrics: data.metrics ?? [], items: data.items ?? [], note: data.note };
    }

    const result = {
      summary: this.cfg.summary ? HttpJsonIntegration.metric(json, this.cfg.summary) : undefined,
      metrics: (this.cfg.metrics ?? []).map((m) => HttpJsonIntegration.metric(json, m)),
      items: [],
    };

    if (this.cfg.list) {
      const rows = getPath(json, this.cfg.list.path);
      if (Array.isArray(rows)) {
        result.items = rows.slice(0, this.cfg.list.limit ?? 20).map((row, i) => ({
          id: String(getPath(row, this.cfg.list.id ?? this.cfg.list.name) ?? i),
          name: String(getPath(row, this.cfg.list.name) ?? `#${i + 1}`),
          icon: this.cfg.list.icon,
          metrics: (this.cfg.list.metrics ?? []).map((m) => HttpJsonIntegration.metric(row, m)),
          controls: [],
        }));
      }
    }

    if (this.cfg.actions?.length) {
      result.items.push({
        id: '__actions',
        name: 'Acties',
        icon: 'play',
        controls: this.cfg.actions.map((a, i) => ({ key: String(i), type: 'button', label: a.label })),
      });
    }
    return result;
  }

  async control(deviceId, key, value) {
    if (deviceId === '__actions') {
      const action = this.cfg.actions?.[Number(key)];
      if (!action) throw new Error('Onbekende actie');
      await httpRequest(action.url, {
        method: action.method ?? 'POST',
        headers: { ...this.headers, ...(action.body ? { 'Content-Type': 'application/json' } : {}) },
        body: action.body ? JSON.stringify(action.body) : undefined,
      });
      return;
    }
    if (!this.cfg.controlUrl) throw new Error('Geen controlUrl ingesteld voor deze app');
    await httpRequest(this.cfg.controlUrl, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, key, value }),
    });
  }
}
