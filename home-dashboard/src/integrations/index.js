import { DemoIntegration } from './demo.js';
import { HttpJsonIntegration } from './http-json.js';
import { PlugwiseIntegration } from './plugwise.js';
import { SolarEdgeIntegration } from './solaredge.js';
import { TuyaIntegration } from './tuya.js';

export const TYPES = {
  plugwise: { cls: PlugwiseIntegration, icon: 'flame' },
  tuya: { cls: TuyaIntegration, icon: 'bulb' },
  solaredge: { cls: SolarEdgeIntegration, icon: 'sun' },
  'http-json': { cls: HttpJsonIntegration, icon: 'coins' },
};
// "lsc" is een alias: LSC Smart Connect draait op Tuya.
TYPES.lsc = TYPES.tuya;

export function createIntegration(cfg) {
  const type = TYPES[cfg.type];
  if (!type) throw new Error(`Onbekend integratietype "${cfg.type}" (kies uit: ${Object.keys(TYPES).join(', ')})`);
  if (cfg.demo) return new DemoIntegration({ ...cfg, type: cfg.type === 'lsc' ? 'tuya' : cfg.type });
  return new type.cls(cfg);
}

export const defaultIcon = (type) => TYPES[type]?.icon ?? 'grid';
