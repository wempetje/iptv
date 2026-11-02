import { Integration } from './base.js';
import { energy, power, round } from '../util.js';
import { eventsToData } from './calendar.js';
import { articlesToData } from './rss.js';

/**
 * Nepdata per integratietype, zodat het dashboard direct werkt zonder echte apparaten.
 * Activeer met "demo": true in de config van een integratie.
 */
const jitter = (base, spread) => base + (Math.random() - 0.5) * spread;

const SCENARIOS = {
  plugwise: {
    state: () => ({
      zones: [
        { id: 'loc:woonkamer', name: 'Woonkamer', temp: 20.4, setpoint: 21 },
        { id: 'loc:slaapkamer', name: 'Slaapkamer', temp: 17.8, setpoint: 17 },
      ],
      plugs: [
        { id: 'app:wasmachine', name: 'Wasmachine', on: true, watt: 420 },
        { id: 'app:tv', name: 'TV-meubel', on: false, watt: 85 },
        { id: 'app:koelkast', name: 'Koelkast', on: true, watt: 65, locked: true },
        { id: 'app:boiler', name: 'Close-in boiler', on: true, watt: 12 },
      ],
    }),
    status(s) {
      for (const z of s.zones) z.temp = round(z.temp + Math.sign(z.setpoint - z.temp) * 0.05 + jitter(0, 0.04), 2);
      const plugTotal = s.plugs.reduce((t, p) => t + (p.on ? jitter(p.watt, p.watt * 0.1) : 0), 0);
      return {
        summary: { label: 'Woonkamer', value: round(s.zones[0].temp, 1), unit: '°C' },
        metrics: [
          { label: 'Afname net', icon: 'zap', ...power(Math.max(0, plugTotal + jitter(250, 60) - solarNow())) },
          { label: 'Teruglevering', icon: 'sun', ...power(Math.max(0, solarNow() - plugTotal - 250)) },
          { label: 'Gas vandaag', icon: 'flame', value: 2.314, unit: 'm³' },
        ],
        items: [
          ...s.zones.map((z) => ({
            id: z.id, name: z.name, icon: 'thermometer',
            metrics: [{ label: 'Temperatuur', value: round(z.temp, 1), unit: '°C' }],
            controls: [{ key: 'setpoint', type: 'range', label: 'Ingesteld', unit: '°C', stepper: true, value: z.setpoint, min: 5, max: 30, step: 0.5 }],
          })),
          ...s.plugs.map((p) => ({
            id: p.id, name: p.name, icon: 'plug',
            metrics: [{ label: 'Verbruik', ...power(p.on ? jitter(p.watt, p.watt * 0.1) : 0) }],
            controls: [{ key: 'on', type: 'toggle', value: p.on, disabled: Boolean(p.locked) }],
          })),
        ],
      };
    },
    control(s, deviceId, key, value) {
      const zone = s.zones.find((z) => z.id === deviceId);
      if (zone && key === 'setpoint') return void (zone.setpoint = Number(value));
      const plug = s.plugs.find((p) => p.id === deviceId);
      if (plug && key === 'on' && !plug.locked) return void (plug.on = Boolean(value));
      throw new Error('Onbekende bediening');
    },
  },

  tuya: {
    state: () => ({
      lamps: [
        { id: 'lamp-1', name: 'Plafondlamp woonkamer', on: true, brightness: 80, colorTemp: 30, color: null },
        { id: 'lamp-2', name: 'LED-strip tv', on: true, brightness: 55, colorTemp: null, color: '#6c5ce7' },
        { id: 'lamp-3', name: 'Lamp keuken', on: false, brightness: 100, colorTemp: 70, color: null },
        { id: 'lamp-4', name: 'Tuinspots', on: false, brightness: 100, colorTemp: null, color: '#ffb347' },
      ],
      plugs: [{ id: 'plug-1', name: 'Stekker kerstverlichting', on: false }],
      offline: [{ id: 'lamp-5', name: 'Lamp schuur' }],
    }),
    status(s) {
      const items = [
        ...s.lamps.map((l) => ({
          id: l.id, name: l.name, icon: 'bulb', online: true, metrics: [],
          controls: [
            { key: 'on', type: 'toggle', value: l.on },
            { key: 'brightness', type: 'range', label: 'Helderheid', unit: '%', min: 1, max: 100, step: 1, value: l.brightness },
            ...(l.colorTemp != null ? [{ key: 'colorTemp', type: 'range', label: 'Warm ↔ koel', unit: '%', min: 0, max: 100, step: 1, value: l.colorTemp }] : []),
            ...(l.color ? [{ key: 'color', type: 'color', label: 'Kleur', value: l.color }] : []),
          ],
        })),
        ...s.plugs.map((p) => ({ id: p.id, name: p.name, icon: 'plug', online: true, metrics: [{ label: 'Vermogen', ...power(p.on ? 48 : 0) }], controls: [{ key: 'on', type: 'toggle', value: p.on }] })),
        ...s.offline.map((o) => ({ id: o.id, name: o.name, icon: 'bulb', online: false, metrics: [{ label: 'Status', value: 'Offline' }], controls: [{ key: 'on', type: 'toggle', value: false, disabled: true }] })),
      ];
      const on = [...s.lamps, ...s.plugs].filter((x) => x.on).length;
      return { summary: { label: 'Aan', value: on, unit: `/ ${items.length}` }, metrics: [{ label: 'Offline', value: s.offline.length }], items };
    },
    control(s, deviceId, key, value) {
      const dev = [...s.lamps, ...s.plugs].find((d) => d.id === deviceId);
      if (!dev || !(key in dev)) throw new Error('Onbekende bediening');
      dev[key] = key === 'on' ? Boolean(value) : key === 'color' ? String(value) : Number(value);
    },
  },

  solaredge: {
    state: () => ({ today: 0 }),
    status() {
      const pv = solarNow();
      const load = jitter(650, 300);
      const net = pv - load;
      const h = new Date().getHours() + new Date().getMinutes() / 60;
      const today = Math.max(0, 9000 * (Math.min(Math.max(h - 7, 0), 12) / 12));
      return {
        summary: { label: 'Opwek nu', ...power(pv) },
        metrics: [
          { label: 'Vandaag', ...energy(today) },
          { label: 'Deze maand', ...energy(48_200 + today) },
          { label: 'Dit jaar', ...energy(3_412_000) },
          { label: 'Totaal', ...energy(18_950_000) },
        ],
        flow: { pv, load, grid: Math.abs(net), gridDirection: net >= 0 ? 'export' : 'import', storage: null, chargeLevel: null, unit: 'W' },
      };
    },
  },

  'http-json': {
    state: () => ({
      bot: true,
      coins: [
        { symbol: 'BTC', amount: 0.142, price: 61250, change: 1.8 },
        { symbol: 'ETH', amount: 2.35, price: 2890, change: -0.9 },
        { symbol: 'SOL', amount: 31, price: 148.2, change: 4.2 },
        { symbol: 'ADA', amount: 2400, price: 0.41, change: -2.3 },
      ],
    }),
    status(s) {
      for (const c of s.coins) {
        const step = jitter(0, 0.4);
        c.price = c.price * (1 + step / 100);
        c.change = round(c.change + step, 2);
      }
      const total = s.coins.reduce((t, c) => t + c.amount * c.price, 0);
      const weighted = s.coins.reduce((t, c) => t + c.amount * c.price * c.change, 0) / total;
      return {
        summary: { label: 'Portfolio', value: round(total, 2), unit: '€', decimals: 0 },
        metrics: [
          { label: '24u', value: round(weighted, 2), unit: '%', trend: weighted >= 0 ? 'up' : 'down' },
          { label: 'Open orders', value: 3 },
          { label: 'Trading bot', value: s.bot ? 'Actief' : 'Gepauzeerd' },
        ],
        items: [
          { id: 'bot', name: 'Trading bot', icon: 'play', metrics: [], controls: [{ key: 'on', type: 'toggle', value: s.bot }] },
          ...s.coins.map((c) => ({
            id: c.symbol, name: c.symbol, icon: 'coins',
            metrics: [
              { label: 'Koers', value: round(c.price, c.price < 10 ? 3 : 0), unit: '€' },
              { label: 'Waarde', value: round(c.amount * c.price, 0), unit: '€' },
              { label: '24u', value: c.change, unit: '%', trend: c.change >= 0 ? 'up' : 'down' },
            ],
            controls: [],
          })),
        ],
      };
    },
    control(s, deviceId, key, value) {
      if (deviceId === 'bot' && key === 'on') return void (s.bot = Boolean(value));
      throw new Error('Onbekende bediening');
    },
  },

  calendar: {
    state: () => {
      const d = (dayOffset, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + dayOffset); x.setHours(h, m, 0, 0); return x; };
      const ev = (title, start, durMin, opts = {}) => ({ uid: title, title, start, end: new Date(start.getTime() + durMin * 60000), allDay: false, location: '', calendar: 'Privé', color: '#4f8cff', ...opts });
      const allDay = (title, dayOffset, days = 1, opts = {}) => ({ uid: title, title, start: d(dayOffset, 0), end: d(dayOffset + days, 0), allDay: true, location: '', calendar: 'Familie', color: '#e07a5f', ...opts });
      const now = new Date();
      return [
        ev('Stand-up', new Date(now.getTime() - 15 * 60000), 45, { calendar: 'Werk', color: '#3ecf8e', location: 'Teams' }),
        ev('Tandarts', d(0, Math.max(now.getHours() + 2, 15), 30), 30, { location: 'Tandartspraktijk Centrum' }),
        ev('Voetbal training', d(0, 19, 30), 90, { location: 'Sportpark' }),
        allDay('Oud papier aan de straat', 1),
        ev('Overleg energiecoöperatie', d(1, 20), 60, { calendar: 'Werk', color: '#3ecf8e' }),
        allDay('Verjaardag oma', 2, 1, { color: '#f5b942' }),
        ev('Boodschappen', d(3, 10), 60),
        allDay('Weekendje weg', 4, 2),
      ].sort((a, b) => a.start - b.start);
    },
    status: (events) => eventsToData(events),
  },

  rss: {
    state: () => {
      const ago = (min) => new Date(Date.now() - min * 60000);
      return [
        ['Kabinet presenteert plannen voor goedkopere thuisbatterijen', 6, 'Binnenland'],
        ['Storm verwacht: KNMI geeft code geel af voor kustprovincies', 18, 'Weer'],
        ['Bitcoin stijgt opnieuw boven de 60.000 euro', 34, 'Economie'],
        ['Oranje wint oefenduel na late treffer', 52, 'Sport'],
        ['Nieuwe regels voor salderen zonnepanelen vanaf 2027', 75, 'Economie'],
        ['Techbedrijven werken samen aan open standaard voor slimme lampen', 110, 'Tech'],
        ['Treinverkeer rond Utrecht weer op gang na storing', 140, 'Binnenland'],
      ].map(([title, min, category], i) => ({ id: `n${i}`, title, link: `https://www.nu.nl/#demo-${i}`, published: ago(min), category, image: null }));
    },
    status: (articles) => articlesToData(articles),
  },
};

/** Gesimuleerde zonne-opwek (W) op basis van het tijdstip. */
function solarNow() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  const curve = Math.max(0, Math.sin(((h - 7) / 12) * Math.PI));
  return Math.max(0, curve * 3800 + (curve ? jitter(0, 150) : 0));
}

export class DemoIntegration extends Integration {
  static defaultPollSeconds = 5;
  static controlRefreshDelayMs = 150;

  constructor(cfg) {
    super(cfg);
    this.scenario = SCENARIOS[cfg.type];
    if (!this.scenario) throw new Error(`Geen demo beschikbaar voor type "${cfg.type}"`);
    this.state = this.scenario.state();
  }

  async fetchStatus() {
    return { ...this.scenario.status(this.state), note: 'Demodata' };
  }

  async control(deviceId, key, value) {
    if (!this.scenario.control) throw new Error('Deze integratie ondersteunt geen bediening');
    this.scenario.control(this.state, deviceId, key, value);
  }
}
