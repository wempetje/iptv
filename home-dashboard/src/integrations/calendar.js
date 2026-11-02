import ICAL from 'ical.js';
import { Integration } from './base.js';
import { httpRequest } from '../util.js';

const DAY = 86_400_000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function dayLabel(date, now = new Date()) {
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / DAY);
  if (diff === 0) return 'Vandaag';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gisteren';
  const label = date.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const hhmm = (d) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

/**
 * Zet een iCalendar-bestand (.ics) om naar losse afspraken binnen [from, to),
 * inclusief herhalende afspraken, uitzonderingen en tijdzones.
 */
export function expandCalendar(icsText, { from, to, calendar = {} }) {
  const root = new ICAL.Component(ICAL.parse(icsText));
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const masters = [];
  const exceptions = [];
  for (const ve of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(ve);
    (ev.isRecurrenceException() ? exceptions : masters).push(ev);
  }
  for (const exc of exceptions) {
    const master = masters.find((m) => m.uid === exc.uid && m.isRecurring());
    if (master) master.relateException(exc);
    else masters.push(exc); // losse uitzondering zonder hoofdafspraak
  }

  const out = [];
  const add = (item, startDate, endDate) => {
    if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    const start = startDate.toJSDate();
    const end = endDate ? endDate.toJSDate() : new Date(start.getTime() + (startDate.isDate ? DAY : 0));
    if (start >= to || end <= from) return;
    out.push({
      uid: item.uid,
      title: item.summary || '(geen titel)',
      location: item.location || '',
      start,
      end,
      allDay: startDate.isDate,
      calendar: calendar.name ?? '',
      color: calendar.color ?? null,
    });
  };

  for (const ev of masters) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      add(ev, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    for (let next = it.next(), n = 0; next && n < 20_000; next = it.next(), n++) {
      if (next.toJSDate() >= to) break;
      const occ = ev.getOccurrenceDetails(next);
      add(occ.item, occ.startDate, occ.endDate);
    }
  }
  return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
}

/** Afspraken -> dashboard-formaat. Los geëxporteerd zodat demo en tests het delen. */
export function eventsToData(events, { now = new Date(), maxItems = 15, errors = [] } = {}) {
  const todayEnd = new Date(startOfDay(now).getTime() + DAY);
  const upcoming = events.filter((e) => e.end > now);
  const next = upcoming.find((e) => !e.allDay && e.start >= now) ?? upcoming[0];

  const items = upcoming.slice(0, maxItems).map((e) => {
    const multiDay = e.allDay && e.end - e.start > DAY;
    let when = e.allDay ? (multiDay ? `t/m ${dayLabel(new Date(e.end.getTime() - 1), now).toLowerCase()}` : 'Hele dag') : `${hhmm(e.start)} – ${hhmm(e.end)}`;
    if (!e.allDay && e.start < now) when = `Nu bezig · tot ${hhmm(e.end)}`;
    return {
      id: `${e.uid}|${e.start.toISOString()}`,
      name: e.title,
      icon: 'calendar',
      color: e.color,
      group: dayLabel(e.start < now ? now : e.start, now),
      subtitle: [when, e.location, e.calendar].filter(Boolean).join(' · '),
    };
  });

  return {
    summary: next
      ? { label: 'Volgende afspraak', value: next.title, unit: next.allDay ? dayLabel(next.start, now).toLowerCase() : `${dayLabel(next.start, now).toLowerCase()} ${hhmm(next.start)}` }
      : { label: 'Volgende afspraak', value: 'Niets gepland' },
    metrics: [
      { label: 'Vandaag', value: upcoming.filter((e) => e.start < todayEnd).length },
      { label: 'Komende dagen', value: upcoming.length },
    ],
    items,
    note: errors.length ? `Niet geladen: ${errors.join('; ')}` : undefined,
  };
}

/**
 * Agenda via iCal (.ics). Werkt met Google Agenda (de agenda's die DigiCal toont),
 * iCloud, Outlook/Office 365 en elke andere agenda met een iCal-link.
 * Config: calendars: [{ name, url, color? }], days? (7), maxItems? (15)
 */
export class CalendarIntegration extends Integration {
  static defaultPollSeconds = 900;

  async fetchStatus() {
    this.require('calendars');
    const now = new Date();
    const from = startOfDay(now);
    const to = new Date(from.getTime() + (this.cfg.days ?? 7) * DAY);
    const errors = [];

    const lists = await Promise.all(this.cfg.calendars.map(async (cal) => {
      try {
        const url = String(cal.url ?? '').replace(/^webcal:\/\//i, 'https://');
        if (!url) throw new Error('geen url');
        const ics = await (await httpRequest(url, { timeoutMs: 15000 })).text();
        return expandCalendar(ics, { from, to, calendar: cal });
      } catch (err) {
        errors.push(`${cal.name ?? 'agenda'} (${err.message})`);
        return [];
      }
    }));
    if (errors.length === this.cfg.calendars.length) throw new Error(errors.join('; '));

    const events = lists.flat().sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
    return eventsToData(events, { now, maxItems: this.cfg.maxItems ?? 15, errors });
  }
}
