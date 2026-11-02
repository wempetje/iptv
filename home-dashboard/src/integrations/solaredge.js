import { Integration } from './base.js';
import { energy, httpRequest, power } from '../util.js';

/** Zet een SolarEdge currentPowerFlow-antwoord om naar het flow-formaat. Geëxporteerd voor tests. */
export function parsePowerFlow(flow) {
  if (!flow) return null;
  const factor = flow.unit === 'kW' ? 1000 : flow.unit === 'MW' ? 1e6 : 1;
  const w = (node) => (typeof node?.currentPower === 'number' ? node.currentPower * factor : null);
  const links = (flow.connections ?? []).map((c) => `${c.from}>${c.to}`.toLowerCase());
  let gridDirection = 'none';
  if (links.includes('grid>load')) gridDirection = 'import';
  else if (links.includes('load>grid') || links.includes('pv>grid')) gridDirection = 'export';
  return {
    pv: w(flow.PV),
    load: w(flow.LOAD),
    grid: w(flow.GRID),
    gridDirection,
    storage: w(flow.STORAGE),
    chargeLevel: flow.STORAGE?.chargeLevel ?? null,
    unit: 'W',
  };
}

/**
 * SolarEdge Monitoring API. Let op: max. 300 verzoeken per dag per site,
 * daarom standaard elke 10 minuten (2 verzoeken per keer = 288 per dag).
 * Config: siteId, apiKey, powerFlow? (default true)
 */
export class SolarEdgeIntegration extends Integration {
  static defaultPollSeconds = 600;

  async get(path) {
    this.require('siteId', 'apiKey');
    const url = `https://monitoringapi.solaredge.com/site/${encodeURIComponent(this.cfg.siteId)}/${path}?api_key=${encodeURIComponent(this.cfg.apiKey)}`;
    return (await httpRequest(url)).json();
  }

  async fetchStatus() {
    const [overviewRes, flowRes] = await Promise.all([
      this.get('overview'),
      this.cfg.powerFlow === false ? null : this.get('currentPowerFlow').catch(() => null),
    ]);
    const o = overviewRes.overview ?? {};
    const flow = parsePowerFlow(flowRes?.siteCurrentPowerFlow);
    const current = flow?.pv ?? o.currentPower?.power ?? null;

    return {
      summary: { label: 'Opwek nu', ...power(current) },
      metrics: [
        { label: 'Vandaag', ...energy(o.lastDayData?.energy) },
        { label: 'Deze maand', ...energy(o.lastMonthData?.energy) },
        { label: 'Dit jaar', ...energy(o.lastYearData?.energy) },
        { label: 'Totaal', ...energy(o.lifeTimeData?.energy) },
      ],
      flow: flow && (flow.load != null || flow.grid != null) ? flow : undefined,
      note: o.lastUpdateTime ? `Omvormer bijgewerkt ${o.lastUpdateTime}` : undefined,
    };
  }
}
