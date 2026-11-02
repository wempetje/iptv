import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DemoIntegration } from '../src/integrations/demo.js';
import { HttpJsonIntegration } from '../src/integrations/http-json.js';
import { parseDomainObjects } from '../src/integrations/plugwise.js';
import { parsePowerFlow } from '../src/integrations/solaredge.js';
import { hexToTuyaHsv, tuyaHsvToHex, tuyaSign } from '../src/integrations/tuya.js';
import { IntegrationManager } from '../src/manager.js';
import { getPath } from '../src/util.js';

const PLUGWISE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<domain_objects>
  <location id="home1"><name>Home</name><logs>
    <point_log id="p1"><type>electricity_consumed</type><unit>W</unit><period><measurement tariff="nl_peak">512.00</measurement><measurement tariff="nl_offpeak">0.00</measurement></period></point_log>
    <point_log id="p2"><type>electricity_produced</type><unit>W</unit><period><measurement tariff="nl_peak">0.00</measurement></period></point_log>
  </logs></location>
  <location id="zone1"><name>Woonkamer</name>
    <logs><point_log id="t1"><type>temperature</type><unit>C</unit><period><measurement>20.37</measurement></period></point_log></logs>
    <actuator_functionalities><thermostat_functionality id="th1"><setpoint>21.0</setpoint><lower_bound>4.0</lower_bound><upper_bound>30.0</upper_bound><resolution>0.5</resolution></thermostat_functionality></actuator_functionalities>
  </location>
  <appliance id="plug1"><name>Wasmachine</name><type>washingmachine</type>
    <logs><point_log id="e1"><type>electricity_consumed</type><unit>W</unit><period><measurement>415.2</measurement></period></point_log></logs>
    <actuator_functionalities><relay_functionality id="r1"><state>on</state><lock>false</lock></relay_functionality></actuator_functionalities>
  </appliance>
  <appliance id="gw"><name>Gateway</name><type>gateway</type></appliance>
</domain_objects>`;

test('Plugwise XML wordt omgezet naar zones, stekkers en P1-waarden', () => {
  const { data, thermostats } = parseDomainObjects(PLUGWISE_XML);
  assert.deepEqual(thermostats, { zone1: 'th1' });
  assert.equal(data.items.length, 2);
  const zone = data.items.find((i) => i.id === 'loc:zone1');
  assert.equal(zone.metrics[0].value, 20.4);
  assert.deepEqual(zone.controls[0], { key: 'setpoint', type: 'range', label: 'Ingesteld', unit: '°C', stepper: true, value: 21, min: 4, max: 30, step: 0.5 });
  const plug = data.items.find((i) => i.id === 'app:plug1');
  assert.equal(plug.controls[0].value, true);
  assert.equal(plug.metrics[0].value, 415);
  assert.deepEqual(data.metrics[0], { label: 'Afname net', icon: 'zap', value: 512, unit: 'W' });
  assert.equal(data.summary.value, 20.4);
});

test('SolarEdge power flow: richting en eenheden', () => {
  const flow = parsePowerFlow({
    unit: 'kW', connections: [{ from: 'PV', to: 'Load' }, { from: 'LOAD', to: 'Grid' }],
    PV: { currentPower: 3.2 }, LOAD: { currentPower: 0.8 }, GRID: { currentPower: 2.4 },
  });
  assert.equal(flow.pv, 3200);
  assert.equal(flow.grid, 2400);
  assert.equal(flow.gridDirection, 'export');
});

test('Tuya-handtekening is deterministisch en hoofdletter-hex', () => {
  const args = { clientId: 'id', secret: 's', t: '1', nonce: 'n', method: 'GET', path: '/v1.0/token?grant_type=1' };
  const sign = tuyaSign(args);
  assert.match(sign, /^[0-9A-F]{64}$/);
  assert.equal(sign, tuyaSign(args));
  assert.notEqual(sign, tuyaSign({ ...args, accessToken: 'tok' }));
});

test('Tuya kleurconversie heen en terug', () => {
  for (const hex of ['#ff0000', '#00ff00', '#6c5ce7']) {
    const back = tuyaHsvToHex(hexToTuyaHsv(hex));
    const diff = [1, 3, 5].map((i) => Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)));
    assert.ok(Math.max(...diff) <= 2, `${hex} -> ${back}`);
  }
});

test('getPath ondersteunt punten en indexen', () => {
  assert.equal(getPath({ a: { b: [{ c: 5 }] } }, 'a.b[0].c'), 5);
  assert.equal(getPath({ a: 1 }, 'x.y'), undefined);
});

test('http-json koppelt velden via paden', async () => {
  const integ = new HttpJsonIntegration({ id: 'c', url: 'http://x', summary: { label: 'Totaal', path: 'total', unit: '€' }, metrics: [{ label: '24u', path: 'change', unit: '%', colorBySign: true }] });
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ total: '1234.5', change: -1.2 }));
  try {
    const data = await integ.fetchStatus();
    assert.equal(data.summary.value, 1234.5);
    assert.equal(data.metrics[0].trend, 'down');
  } finally {
    globalThis.fetch = orig;
  }
});

test('Manager: bediening van een demo-integratie ververst de status', async () => {
  const m = new IntegrationManager([{ id: 'l', type: 'tuya', demo: true }, { id: 'x', type: 'bestaatniet' }]);
  await m.refresh('l');
  const res = await m.control('l', 'lamp-3', 'on', true);
  assert.equal(res.data.items.find((i) => i.id === 'lamp-3').controls[0].value, true);
  assert.equal(m.snapshot().find((s) => s.id === 'x').status, 'error');
});

test('Demo bestaat voor elk type', async () => {
  for (const type of ['plugwise', 'tuya', 'solaredge', 'http-json']) {
    const data = await new DemoIntegration({ id: type, type }).fetchStatus();
    assert.ok(data.summary, type);
  }
});
