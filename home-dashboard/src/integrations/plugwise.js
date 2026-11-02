import { XMLParser } from 'fast-xml-parser';
import { Integration } from './base.js';
import { httpRequest, power, round, toNumber } from '../util.js';

const ARRAYS = new Set(['appliance', 'location', 'point_log', 'measurement', 'relay_functionality', 'thermostat_functionality']);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  isArray: (name) => ARRAYS.has(name),
});

const text = (node) => (node && typeof node === 'object' ? node['#text'] : node);
const num = (node) => toNumber(text(node));

/** Leest de point_logs (actuele waarden) van een appliance of location. */
export function readLogs(logs) {
  const out = {};
  for (const log of logs?.point_log ?? []) {
    const period = Array.isArray(log.period) ? log.period[0] : log.period;
    const values = (period?.measurement ?? []).map(num).filter((v) => typeof v === 'number');
    if (!values.length || !log.type) continue;
    // Elektriciteit wordt per tarief (piek/dal) gelogd; de som is het actuele vermogen.
    out[log.type] = { value: values.reduce((a, b) => a + b, 0), unit: log.unit };
  }
  return out;
}

/** Zet /core/domain_objects om naar het dashboard-formaat. Los geëxporteerd zodat het testbaar is. */
export function parseDomainObjects(xml) {
  const doc = parser.parse(xml).domain_objects ?? {};
  const items = [];
  const thermostats = {};
  const metrics = [];

  for (const loc of doc.location ?? []) {
    const id = loc['@_id'];
    const logs = readLogs(loc.logs);
    const thermostat = loc.actuator_functionalities?.thermostat_functionality?.[0];

    if (thermostat) {
      thermostats[id] = thermostat['@_id'];
      const setpoint = num(thermostat.setpoint);
      items.push({
        id: `loc:${id}`,
        name: text(loc.name) ?? 'Zone',
        icon: 'thermometer',
        metrics: [
          logs.temperature && { label: 'Temperatuur', value: round(logs.temperature.value, 1), unit: '°C' },
          logs.humidity && { label: 'Luchtvochtigheid', value: Math.round(logs.humidity.value), unit: '%' },
        ].filter(Boolean),
        controls: [{
          key: 'setpoint', type: 'range', label: 'Ingesteld', unit: '°C', stepper: true,
          value: setpoint,
          min: num(thermostat.lower_bound) ?? 4,
          max: num(thermostat.upper_bound) ?? 30,
          step: num(thermostat.resolution) || 0.5,
        }],
      });
    }

    // P1 / slimme meter hangt aan de "home"-locatie van de gateway.
    const consumed = logs.electricity_consumed?.value;
    const produced = logs.electricity_produced?.value;
    if (consumed != null || produced != null) {
      if (consumed != null) metrics.push({ label: 'Afname net', icon: 'zap', ...power(consumed) });
      if (produced != null) metrics.push({ label: 'Teruglevering', icon: 'sun', ...power(produced) });
    }
    if (logs.gas_consumed) metrics.push({ label: 'Gas', icon: 'flame', value: round(logs.gas_consumed.value, 3), unit: 'm³' });
    if (logs.outdoor_temperature) metrics.push({ label: 'Buiten', icon: 'thermometer', value: round(logs.outdoor_temperature.value, 1), unit: '°C' });
  }

  let switchedOn = 0;
  let plugPower = 0;
  for (const app of doc.appliance ?? []) {
    const logs = readLogs(app.logs);
    const relay = app.actuator_functionalities?.relay_functionality?.[0];
    const consumed = logs.electricity_consumed?.value;
    if (!relay && consumed == null) continue;
    if (['gateway', 'heater_central', 'thermostat', 'zone_thermostat', 'thermostatic_radiator_valve'].includes(app.type)) continue;

    const on = relay ? text(relay.state) === 'on' : undefined;
    if (on) switchedOn += 1;
    if (typeof consumed === 'number') plugPower += consumed;
    items.push({
      id: `app:${app['@_id']}`,
      name: text(app.name) ?? 'Apparaat',
      icon: 'plug',
      metrics: consumed != null ? [{ label: 'Verbruik', ...power(consumed) }] : [],
      controls: relay ? [{ key: 'on', type: 'toggle', value: on, disabled: String(text(relay.lock)) === 'true' }] : [],
    });
  }

  const zone = items.find((i) => i.icon === 'thermometer');
  const summary = zone
    ? { label: zone.name, value: zone.metrics[0]?.value ?? null, unit: '°C' }
    : { label: 'Stekkers aan', value: switchedOn, unit: `/ ${items.length}` };
  if (plugPower && !metrics.some((m) => m.label === 'Afname net')) metrics.unshift({ label: 'Stekkers totaal', icon: 'plug', ...power(plugPower) });

  return { data: { summary, metrics, items }, thermostats };
}

/**
 * Plugwise Smile / Adam / Anna / Stretch via de lokale XML-API.
 * Config: host, password (Smile-ID van de sticker), username? ("smile", of "stretch" bij een Stretch)
 */
export class PlugwiseIntegration extends Integration {
  static defaultPollSeconds = 15;

  thermostats = {};

  async request(method, path, body) {
    this.require('host', 'password');
    const base = /^https?:\/\//.test(this.cfg.host) ? this.cfg.host : `http://${this.cfg.host}`;
    const auth = Buffer.from(`${this.cfg.username ?? 'smile'}:${this.cfg.password}`).toString('base64');
    const res = await httpRequest(`${base.replace(/\/$/, '')}${path}`, {
      method,
      body,
      headers: { Authorization: `Basic ${auth}`, ...(body ? { 'Content-Type': 'text/xml' } : {}) },
    });
    return res.text();
  }

  async fetchStatus() {
    const { data, thermostats } = parseDomainObjects(await this.request('GET', '/core/domain_objects'));
    this.thermostats = thermostats;
    return data;
  }

  async control(deviceId, key, value) {
    const [kind, id] = String(deviceId).split(':');
    if (!/^[\w-]+$/.test(id ?? '')) throw new Error('Ongeldig apparaat');

    if (kind === 'app' && key === 'on') {
      const state = value ? 'on' : 'off';
      await this.request('PUT', `/core/appliances;id=${id}/relay`,
        `<relay_functionality><state>${state}</state></relay_functionality>`);
      return;
    }
    if (kind === 'loc' && key === 'setpoint') {
      const temp = Number(value);
      if (!Number.isFinite(temp)) throw new Error('Ongeldige temperatuur');
      const thermostatId = this.thermostats[id];
      const path = thermostatId ? `/core/locations;id=${id}/thermostat;id=${thermostatId}` : `/core/locations;id=${id}/thermostat`;
      await this.request('PUT', path, `<thermostat_functionality><setpoint>${temp}</setpoint></thermostat_functionality>`);
      return;
    }
    throw new Error(`Onbekende bediening ${key} voor ${deviceId}`);
  }
}
