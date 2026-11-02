import { timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './src/config.js';
import { defaultIcon } from './src/integrations/index.js';
import { IntegrationManager } from './src/manager.js';

const config = loadConfig();
const manager = new IntegrationManager(config.integrations);
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// Optioneel wachtwoord (HTTP Basic, gebruikersnaam maakt niet uit) — aan te raden zodra
// het dashboard buiten je eigen netwerk bereikbaar is.
if (config.password) {
  const expected = Buffer.from(config.password);
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    const given = scheme === 'Basic' ? Buffer.from(Buffer.from(encoded ?? '', 'base64').toString().split(':').slice(1).join(':')) : Buffer.alloc(0);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Thuisdashboard"').status(401).send('Inloggen vereist');
  });
}

app.get('/api/config', (_req, res) => {
  res.json({
    title: config.title,
    refreshSeconds: config.refreshSeconds,
    tiles: config.integrations.map((i) => ({
      id: i.id,
      type: i.type,
      name: i.name ?? i.id,
      icon: i.icon ?? defaultIcon(i.type),
      openUrl: i.openUrl ?? null,
      wide: Boolean(i.wide),
      demo: Boolean(i.demo),
    })),
    apps: config.apps.map((a) => ({ id: a.id, name: a.name ?? a.id, url: a.url, icon: a.icon ?? 'grid' })),
  });
});

app.get('/api/status', (_req, res) => res.json(manager.snapshot()));

app.post('/api/integrations/:id/control', async (req, res) => {
  const { deviceId, key, value } = req.body ?? {};
  if (typeof deviceId !== 'string' || typeof key !== 'string') return res.status(400).json({ error: 'deviceId en key zijn verplicht' });
  try {
    res.json(await manager.control(req.params.id, deviceId, key, value));
  } catch (err) {
    res.status(err.status ?? 502).json({ error: err.message });
  }
});

app.get('/healthz', (_req, res) => res.send('ok'));
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), 'public'), { extensions: ['html'] }));

manager.start();
const server = app.listen(config.port, () => {
  console.log(`Thuisdashboard draait op http://localhost:${config.port} (config: ${config.source})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    manager.stop();
    server.close(() => process.exit(0));
  });
}
