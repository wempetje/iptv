import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Integration } from './base.js';
import { httpRequest, power } from '../util.js';

const HOSTS = {
  eu: 'https://openapi.tuyaeu.com',
  'eu-west': 'https://openapi-weaz.tuyaeu.com',
  us: 'https://openapi.tuyaus.com',
  'us-east': 'https://openapi-ueaz.tuyaus.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
};

const SWITCH_CODES = ['switch_led', 'switch_1', 'switch'];
const LIGHT_CATEGORIES = new Set(['dj', 'dd', 'xdd', 'fwd', 'dc', 'tgq', 'tgkg']);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Tuya OpenAPI-handtekening (HMAC-SHA256). Geëxporteerd voor tests. */
export function tuyaSign({ clientId, secret, accessToken = '', t, nonce, method, path, body = '' }) {
  const stringToSign = [method.toUpperCase(), sha256(body), '', path].join('\n');
  return createHmac('sha256', secret).update(clientId + accessToken + t + nonce + stringToSign).digest('hex').toUpperCase();
}

// ---- kleurconversie (Tuya colour_data_v2: h 0-360, s/v 0-1000) ----
export function hexToTuyaHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error('Ongeldige kleur');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(((h * 60) + 360) % 360), s: Math.round((max ? d / max : 0) * 1000), v: Math.max(10, Math.round(max * 1000)) };
}

export function tuyaHsvToHex({ h = 0, s = 0, v = 1000 }) {
  const S = s / 1000;
  const V = v / 1000;
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((V - V * S * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function parseColour(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

/**
 * LSC Smart Connect (Action) lampen en stekkers draaien op het Tuya-platform.
 * Bediening via de Tuya Cloud OpenAPI (iot.tuya.com, gratis ontwikkelaarsaccount).
 * Config: accessId, accessSecret, region (eu), devices? [{ id, name? }]
 */
export class TuyaIntegration extends Integration {
  static defaultPollSeconds = 30;
  static controlRefreshDelayMs = 1200;

  token = null;
  tokenExpires = 0;
  meta = {}; // deviceId -> { switchCode, brightCode, brightRange, tempCode }

  get host() {
    return HOSTS[this.cfg.region ?? 'eu'] ?? this.cfg.region;
  }

  async request(method, path, body) {
    this.require('accessId', 'accessSecret');
    const isTokenCall = path.startsWith('/v1.0/token');
    if (!isTokenCall) await this.ensureToken();

    const bodyStr = body ? JSON.stringify(body) : '';
    const t = Date.now().toString();
    const nonce = randomUUID();
    const accessToken = isTokenCall ? '' : this.token;
    const sign = tuyaSign({ clientId: this.cfg.accessId, secret: this.cfg.accessSecret, accessToken, t, nonce, method, path, body: bodyStr });

    const res = await httpRequest(this.host + path, {
      method,
      body: bodyStr || undefined,
      headers: {
        client_id: this.cfg.accessId,
        sign, t, nonce,
        sign_method: 'HMAC-SHA256',
        ...(accessToken ? { access_token: accessToken } : {}),
        ...(bodyStr ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const json = await res.json();
    if (!json.success) {
      if ([1010, 1011, 1012].includes(json.code)) this.token = null; // token verlopen/ongeldig
      throw new Error(`Tuya: ${json.msg ?? 'onbekende fout'} (code ${json.code})`);
    }
    return json.result;
  }

  async ensureToken() {
    if (this.token && Date.now() < this.tokenExpires) return;
    const result = await this.request('GET', '/v1.0/token?grant_type=1');
    this.token = result.access_token;
    this.tokenExpires = Date.now() + (result.expire_time - 60) * 1000;
  }

  async listDevices() {
    if (Array.isArray(this.cfg.devices) && this.cfg.devices.length) {
      return Promise.all(this.cfg.devices.map(async (d) => {
        const id = typeof d === 'string' ? d : d.id;
        try {
          const dev = await this.request('GET', `/v1.0/devices/${encodeURIComponent(id)}`);
          return { ...dev, name: d.name ?? dev.name };
        } catch (err) {
          return { id, name: d.name ?? id, online: false, status: [], error: err.message };
        }
      }));
    }
    // Alle apparaten van het gekoppelde LSC Smart Connect / Smart Life account.
    const devices = [];
    let lastRowKey = '';
    for (let page = 0; page < 10; page++) {
      const q = `/v1.0/iot-01/associated-users/devices?size=50${lastRowKey ? `&last_row_key=${lastRowKey}` : ''}`;
      const result = await this.request('GET', q);
      devices.push(...(result.devices ?? []));
      if (!result.has_more) break;
      lastRowKey = result.last_row_key;
    }
    return devices;
  }

  toItem(dev) {
    const status = Object.fromEntries((dev.status ?? []).map((s) => [s.code, s.value]));
    const meta = {};
    const controls = [];
    const metrics = [];

    meta.switchCode = SWITCH_CODES.find((c) => c in status);
    if (meta.switchCode) controls.push({ key: 'on', type: 'toggle', value: Boolean(status[meta.switchCode]), disabled: dev.online === false });

    if ('bright_value_v2' in status) Object.assign(meta, { brightCode: 'bright_value_v2', brightRange: [10, 1000] });
    else if ('bright_value' in status) Object.assign(meta, { brightCode: 'bright_value', brightRange: [25, 255] });
    if (meta.brightCode) {
      const [lo, hi] = meta.brightRange;
      const pct = Math.round(((status[meta.brightCode] - lo) / (hi - lo)) * 99 + 1);
      controls.push({ key: 'brightness', type: 'range', label: 'Helderheid', unit: '%', min: 1, max: 100, step: 1, value: Math.max(1, Math.min(100, pct)) });
    }

    meta.tempCode = ['temp_value_v2', 'temp_value'].find((c) => c in status);
    if (meta.tempCode) {
      const max = meta.tempCode === 'temp_value_v2' ? 1000 : 255;
      controls.push({ key: 'colorTemp', type: 'range', label: 'Warm ↔ koel', unit: '%', min: 0, max: 100, step: 1, value: Math.round((status[meta.tempCode] / max) * 100) });
      meta.tempMax = max;
    }

    meta.colourCode = ['colour_data_v2', 'colour_data'].find((c) => c in status);
    const colour = meta.colourCode && parseColour(status[meta.colourCode]);
    if (colour && meta.colourCode === 'colour_data_v2') {
      controls.push({ key: 'color', type: 'color', label: 'Kleur', value: tuyaHsvToHex(colour) });
    }

    if (typeof status.cur_power === 'number') metrics.push({ label: 'Vermogen', ...power(status.cur_power / 10) });
    if (dev.online === false) metrics.push({ label: 'Status', value: dev.error ? 'Fout' : 'Offline' });

    this.meta[dev.id] = meta;
    const isLight = LIGHT_CATEGORIES.has(dev.category) || Boolean(meta.brightCode);
    return { id: dev.id, name: dev.name ?? dev.id, icon: isLight ? 'bulb' : 'plug', online: dev.online !== false, metrics, controls };
  }

  async fetchStatus() {
    const items = (await this.listDevices()).map((d) => this.toItem(d));
    const on = items.filter((i) => i.controls.find((c) => c.key === 'on')?.value).length;
    const offline = items.filter((i) => !i.online).length;
    return {
      summary: { label: 'Aan', value: on, unit: `/ ${items.length}` },
      metrics: offline ? [{ label: 'Offline', value: offline }] : [],
      items,
    };
  }

  async control(deviceId, key, value) {
    const meta = this.meta[deviceId];
    if (!meta) throw new Error('Onbekend apparaat; ververs eerst de status');
    let command;
    if (key === 'on' && meta.switchCode) command = { code: meta.switchCode, value: Boolean(value) };
    else if (key === 'brightness' && meta.brightCode) {
      const [lo, hi] = meta.brightRange;
      command = { code: meta.brightCode, value: Math.round(lo + ((Number(value) - 1) / 99) * (hi - lo)) };
    } else if (key === 'colorTemp' && meta.tempCode) command = { code: meta.tempCode, value: Math.round((Number(value) / 100) * meta.tempMax) };
    else if (key === 'color' && meta.colourCode) {
      const commands = [{ code: 'work_mode', value: 'colour' }, { code: meta.colourCode, value: JSON.stringify(hexToTuyaHsv(value)) }];
      await this.request('POST', `/v1.0/devices/${encodeURIComponent(deviceId)}/commands`, { commands });
      return;
    } else throw new Error(`Bediening ${key} niet beschikbaar voor dit apparaat`);

    const commands = [command];
    // Kleurtemperatuur aanpassen werkt alleen in witte modus.
    if (key === 'colorTemp' && meta.colourCode) commands.unshift({ code: 'work_mode', value: 'white' });
    await this.request('POST', `/v1.0/devices/${encodeURIComponent(deviceId)}/commands`, { commands });
  }
}
