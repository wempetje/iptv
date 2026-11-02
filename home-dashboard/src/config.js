import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Vervangt ${VAR} in alle strings door de waarde uit de omgeving (bijv. uit .env). */
function substituteEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
  }
  if (Array.isArray(value)) return value.map(substituteEnv);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteEnv(v)]));
  }
  return value;
}

function slug(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

function uniqueIds(list, prefix) {
  const seen = new Set();
  return list.map((item, i) => {
    let id = item.id ? slug(item.id) : slug(item.name ?? `${prefix}-${i + 1}`);
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return { ...item, id };
  });
}

export function loadConfig() {
  const envFile = resolve(ROOT, '.env');
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

  const wanted = process.env.CONFIG_PATH ? resolve(process.env.CONFIG_PATH) : resolve(ROOT, 'config.json');
  const file = existsSync(wanted) ? wanted : resolve(ROOT, 'config.example.json');
  if (file !== wanted) console.warn(`[config] ${wanted} niet gevonden, demo-configuratie ${file} wordt gebruikt`);

  const cfg = substituteEnv(JSON.parse(readFileSync(file, 'utf8')));
  // Tijdzone bepaalt "vandaag" in de agenda en tijden in het nieuws.
  process.env.TZ = process.env.TZ || cfg.timezone || 'Europe/Amsterdam';
  return {
    title: cfg.title ?? 'Thuis',
    refreshSeconds: cfg.refreshSeconds ?? 5,
    port: Number(process.env.PORT ?? cfg.port ?? 8080),
    password: process.env.DASHBOARD_PASSWORD || cfg.auth?.password || '',
    integrations: uniqueIds(cfg.integrations ?? [], 'tegel'),
    apps: uniqueIds(cfg.apps ?? [], 'app'),
    source: file,
  };
}
