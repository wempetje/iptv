/**
 * Basis voor elke integratie.
 *
 * fetchStatus() levert een genormaliseerd object dat de frontend generiek kan tonen:
 * {
 *   summary?: { label, value, unit, trend? },          // grote kop-waarde
 *   metrics?: [{ label, value, unit, icon?, trend? }],  // kleine kerncijfers
 *   flow?:    { pv, load, grid, gridDirection, storage?, chargeLevel?, unit } // energiestroom
 *   items?:   [{ id, name, icon?, online?, metrics?: [...], controls?: [...] }]
 * }
 *
 * Een control is één van:
 *   { key, type: 'toggle', value: boolean, disabled? }
 *   { key, type: 'range',  value, min, max, step, unit?, label?, stepper? }
 *   { key, type: 'color',  value: '#rrggbb', label? }
 *   { key, type: 'button', label }
 */
export class Integration {
  static defaultPollSeconds = 30;
  static controlRefreshDelayMs = 800;

  constructor(cfg) {
    this.cfg = cfg;
    this.id = cfg.id;
  }

  get pollSeconds() {
    return this.cfg.pollSeconds ?? this.constructor.defaultPollSeconds;
  }

  async fetchStatus() {
    throw new Error('fetchStatus() niet geïmplementeerd');
  }

  // eslint-disable-next-line no-unused-vars
  async control(deviceId, key, value) {
    throw new Error('Deze integratie ondersteunt geen bediening');
  }

  require(...keys) {
    const missing = keys.filter((k) => this.cfg[k] == null || this.cfg[k] === '');
    if (missing.length) throw new Error(`Configuratie mist: ${missing.join(', ')}`);
  }
}
