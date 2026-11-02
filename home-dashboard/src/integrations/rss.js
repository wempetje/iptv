import { XMLParser } from 'fast-xml-parser';
import { Integration } from './base.js';
import { httpRequest } from '../util.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  htmlEntities: true,
  isArray: (name) => ['item', 'entry', 'category', 'media:content', 'enclosure', 'link'].includes(name),
});

const text = (node) => {
  if (Array.isArray(node)) return text(node[0]);
  return String(node && typeof node === 'object' ? (node['#text'] ?? '') : (node ?? '')).trim();
};
const stripHtml = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function imageOf(entry) {
  const candidates = [
    ...(entry.enclosure ?? []).filter((e) => String(e['@_type'] ?? 'image').startsWith('image')).map((e) => e['@_url']),
    ...(entry['media:content'] ?? []).map((m) => m['@_url']),
    entry['media:thumbnail']?.['@_url'],
  ];
  return candidates.find((u) => typeof u === 'string' && /^https?:\/\//.test(u)) ?? null;
}

function linkOf(entry) {
  if (!Array.isArray(entry.link)) return text(entry.link);
  const alt = entry.link.find((l) => typeof l === 'object' && (l['@_rel'] ?? 'alternate') === 'alternate') ?? entry.link[0];
  return typeof alt === 'object' && alt['@_href'] ? alt['@_href'] : text(alt);
}

/** RSS 2.0 of Atom -> lijst artikelen. Geëxporteerd voor tests. */
export function parseFeed(xml, source = '') {
  const doc = parser.parse(xml);
  const entries = doc.rss?.channel?.item ?? doc.feed?.entry ?? doc['rdf:RDF']?.item ?? [];
  return entries.map((e) => {
    const date = new Date(text(e.pubDate) || text(e.published) || text(e.updated) || text(e['dc:date']));
    return {
      id: text(e.guid) || linkOf(e),
      title: stripHtml(text(e.title)),
      link: linkOf(e),
      summary: stripHtml(text(e.description) || text(e.summary)).slice(0, 220),
      image: imageOf(e),
      category: text(e.category),
      published: Number.isNaN(date.getTime()) ? null : date,
      source,
    };
  }).filter((a) => a.title);
}

export function timeLabel(date, now = new Date()) {
  if (!date) return '';
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

export function articlesToData(articles, { maxItems = 8, showImages = true, now = new Date() } = {}) {
  const seen = new Set();
  const unique = articles
    .filter((a) => (seen.has(a.link) ? false : seen.add(a.link)))
    .sort((a, b) => (b.published ?? 0) - (a.published ?? 0))
    .slice(0, maxItems);
  return {
    items: unique.map((a) => ({
      id: a.id || a.link,
      name: a.title,
      href: a.link,
      image: showImages ? a.image : null,
      icon: 'news',
      subtitle: [timeLabel(a.published, now), a.category || a.source].filter(Boolean).join(' · '),
    })),
  };
}

const NUNL = 'https://www.nu.nl/rss/';

/**
 * Nieuws via RSS/Atom. Type "nunl" is een voorinstelling voor nu.nl.
 * Config: feeds: [{ url, name? }]  óf (nunl) categories: ["Algemeen", "Tech", ...]
 *         maxItems? (8), images? (true)
 */
export class RssIntegration extends Integration {
  static defaultPollSeconds = 600;

  get feeds() {
    if (this.cfg.feeds?.length) return this.cfg.feeds.map((f) => (typeof f === 'string' ? { url: f } : f));
    if (this.cfg.type === 'nunl') {
      return (this.cfg.categories ?? ['Algemeen']).map((c) => ({ url: NUNL + encodeURIComponent(c), name: c }));
    }
    return [];
  }

  async fetchStatus() {
    const feeds = this.feeds;
    if (!feeds.length) throw new Error('Configuratie mist: feeds');
    const errors = [];
    const lists = await Promise.all(feeds.map(async (f) => {
      try {
        const xml = await (await httpRequest(f.url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml' } })).text();
        return parseFeed(xml, f.name ?? '');
      } catch (err) {
        errors.push(`${f.name ?? f.url}: ${err.message}`);
        return [];
      }
    }));
    if (errors.length === feeds.length) throw new Error(errors.join('; '));
    const data = articlesToData(lists.flat(), { maxItems: this.cfg.maxItems ?? 8, showImages: this.cfg.images !== false });
    if (errors.length) data.note = `Niet geladen: ${errors.join('; ')}`;
    return data;
  }
}
