import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventsToData, expandCalendar } from '../src/integrations/calendar.js';
import { articlesToData, parseFeed } from '../src/integrations/rss.js';

process.env.TZ = 'Europe/Amsterdam';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VTIMEZONE
TZID:Europe/Amsterdam
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:training@test
DTSTART;TZID=Europe/Amsterdam:20260105T193000
DTEND;TZID=Europe/Amsterdam:20260105T210000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Europe/Amsterdam:20261109T193000
SUMMARY:Voetbal training
LOCATION:Sportpark
END:VEVENT
BEGIN:VEVENT
UID:training@test
RECURRENCE-ID;TZID=Europe/Amsterdam:20261116T193000
DTSTART;TZID=Europe/Amsterdam:20261117T200000
DTEND;TZID=Europe/Amsterdam:20261117T213000
SUMMARY:Voetbal training (verplaatst)
END:VEVENT
BEGIN:VEVENT
UID:papier@test
DTSTART;VALUE=DATE:20261103
DTEND;VALUE=DATE:20261104
SUMMARY:Oud papier
END:VEVENT
BEGIN:VEVENT
UID:afgezegd@test
DTSTART:20261104T090000Z
DTEND:20261104T100000Z
STATUS:CANCELLED
SUMMARY:Afgezegd overleg
END:VEVENT
END:VCALENDAR`;

test('iCal: herhaling, EXDATE, verplaatste en geannuleerde afspraken, tijdzone', () => {
  const from = new Date('2026-11-02T00:00:00+01:00');
  const to = new Date('2026-11-24T00:00:00+01:00');
  const events = expandCalendar(ICS, { from, to, calendar: { name: 'Privé', color: '#4f8cff' } });
  const titles = events.map((e) => `${e.start.toISOString()} ${e.title}`);
  assert.deepEqual(titles, [
    '2026-11-02T18:30:00.000Z Voetbal training',        // 19:30 CET
    '2026-11-02T23:00:00.000Z Oud papier',               // hele dag 3 nov
    // 9 nov is uitgezonderd (EXDATE)
    '2026-11-17T19:00:00.000Z Voetbal training (verplaatst)',
    '2026-11-23T18:30:00.000Z Voetbal training',
  ]);
  assert.equal(events[1].allDay, true);
  assert.equal(events[0].location, 'Sportpark');
});

test('Afspraken worden gegroepeerd per dag met volgende afspraak bovenaan', () => {
  const now = new Date('2026-11-02T12:00:00+01:00');
  const events = expandCalendar(ICS, { from: new Date('2026-11-02T00:00:00+01:00'), to: new Date('2026-11-09T00:00:00+01:00'), calendar: { name: 'Privé' } });
  const data = eventsToData(events, { now });
  assert.deepEqual(data.summary, { label: 'Volgende afspraak', value: 'Voetbal training', unit: 'vandaag 19:30' });
  assert.deepEqual(data.items.map((i) => i.group), ['Vandaag', 'Morgen']);
  assert.equal(data.items[0].subtitle, '19:30 – 21:00 · Sportpark · Privé');
  assert.equal(data.items[1].subtitle, 'Hele dag · Privé');
});

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>NU - Algemeen</title><link>https://www.nu.nl</link>
<item>
  <title>Kabinet &amp; Kamer eens over &#8216;energiewet&#8217;</title>
  <link>https://www.nu.nl/politiek/1/kabinet.html</link>
  <description><![CDATA[<p>Het kabinet en de Kamer zijn het eens.</p>]]></description>
  <pubDate>Mon, 02 Nov 2026 09:30:00 +0100</pubDate>
  <guid isPermaLink="false">1</guid>
  <category>Politiek</category>
  <enclosure url="https://media.nu.nl/m/abc.jpg" length="0" type="image/jpeg"/>
</item>
<item>
  <title>Ouder bericht</title>
  <link>javascript:alert(1)</link>
  <pubDate>Sun, 01 Nov 2026 20:00:00 +0100</pubDate>
  <guid>2</guid>
</item>
</channel></rss>`;

test('RSS (nu.nl-formaat) wordt geparsed en gesorteerd', () => {
  const articles = parseFeed(RSS, 'Algemeen');
  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, 'Kabinet & Kamer eens over ‘energiewet’');
  assert.equal(articles[0].image, 'https://media.nu.nl/m/abc.jpg');
  assert.equal(articles[0].category, 'Politiek');
  const data = articlesToData(articles, { now: new Date('2026-11-02T10:00:00+01:00') });
  assert.equal(data.items[0].subtitle, '09:30 · Politiek');
  assert.equal(data.items[1].name, 'Ouder bericht');
});

test('Atom-feeds worden ook ondersteund', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Hallo</title><link rel="alternate" href="https://x.nl/a"/><updated>2026-11-02T08:00:00Z</updated><id>a</id></entry></feed>`;
  const [a] = parseFeed(atom);
  assert.equal(a.link, 'https://x.nl/a');
  assert.equal(a.title, 'Hallo');
});
