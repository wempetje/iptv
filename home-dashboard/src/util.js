/** Kleine hulpfuncties die door meerdere integraties gebruikt worden. */

export async function httpRequest(url, { timeoutMs = 10000, ...options } = {}) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `time-out na ${timeoutMs / 1000}s` : (err.cause?.code ?? err.message);
    throw new Error(`Geen verbinding met ${new URL(url).host}: ${reason}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`HTTP ${res.status} van ${new URL(url).host}${body ? `: ${body}` : ''}`);
  }
  return res;
}

/** Haalt een waarde op via een pad als "portfolio.coins[0].value" of "data.0.price". */
export function getPath(obj, path) {
  if (path == null || path === '') return obj;
  return String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

export const round = (n, decimals = 1) => (typeof n === 'number' ? Number(n.toFixed(decimals)) : n);

/** Wh -> leesbare waarde met eenheid. */
export function energy(wh) {
  if (typeof wh !== 'number') return { value: null, unit: 'kWh' };
  if (Math.abs(wh) >= 1e6) return { value: round(wh / 1e6, 2), unit: 'MWh' };
  return { value: round(wh / 1e3, wh >= 1e5 ? 0 : 1), unit: 'kWh' };
}

/** Watt -> leesbare waarde met eenheid. */
export function power(w) {
  if (typeof w !== 'number') return { value: null, unit: 'W' };
  if (Math.abs(w) >= 1000) return { value: round(w / 1000, 2), unit: 'kW' };
  return { value: Math.round(w), unit: 'W' };
}
