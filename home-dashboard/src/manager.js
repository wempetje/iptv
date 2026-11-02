import { createIntegration } from './integrations/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Houdt per integratie de laatste status bij en pollt op de achtergrond. */
export class IntegrationManager {
  constructor(configs) {
    this.entries = new Map();
    for (const cfg of configs) {
      const entry = { cfg, instance: null, state: { status: 'loading', data: null, error: null, updatedAt: null }, timer: null, inflight: null };
      try {
        entry.instance = createIntegration(cfg);
      } catch (err) {
        entry.state = { ...entry.state, status: 'error', error: err.message };
      }
      this.entries.set(cfg.id, entry);
    }
  }

  start() {
    for (const entry of this.entries.values()) if (entry.instance) this.#loop(entry);
  }

  stop() {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
  }

  async #loop(entry) {
    clearTimeout(entry.timer);
    await this.refresh(entry.cfg.id);
    entry.timer = setTimeout(() => this.#loop(entry), entry.instance.pollSeconds * 1000);
    entry.timer.unref?.();
  }

  async refresh(id) {
    const entry = this.entries.get(id);
    if (!entry?.instance) return entry?.state;
    if (entry.inflight) return entry.inflight;
    entry.inflight = (async () => {
      try {
        const data = await entry.instance.fetchStatus();
        entry.state = { status: 'ok', data, error: null, updatedAt: Date.now() };
      } catch (err) {
        // Laatste goede data blijft zichtbaar, met foutmelding erbij.
        entry.state = { ...entry.state, status: 'error', error: err.message };
        console.warn(`[${id}] ${err.message}`);
      } finally {
        entry.inflight = null;
      }
      return entry.state;
    })();
    return entry.inflight;
  }

  async control(id, deviceId, key, value) {
    const entry = this.entries.get(id);
    if (!entry) throw Object.assign(new Error('Onbekende integratie'), { status: 404 });
    if (!entry.instance) throw new Error(entry.state.error);
    await entry.instance.control(deviceId, key, value);
    // Even wachten zodat het apparaat de nieuwe toestand rapporteert, dan opnieuw ophalen.
    await sleep(entry.cfg.controlRefreshDelayMs ?? entry.instance.constructor.controlRefreshDelayMs);
    if (entry.inflight) await entry.inflight;
    return { id, ...(await this.refresh(id)) };
  }

  snapshot() {
    return [...this.entries.values()].map((e) => ({ id: e.cfg.id, ...e.state }));
  }
}
