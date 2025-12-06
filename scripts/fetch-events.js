const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1];
}

function escapeCsv(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function fetchEvents({ query, apiKey }) {
  const baseParams = { engine: 'google_events', q: query, api_key: apiKey };
  const events = [];

  // First page with no explicit start (start=0 can return empty)
  const first = await axios.get('https://serpapi.com/search.json', {
    params: baseParams,
    timeout: 10000
  });
  events.push(...(first.data.events_results || []));

  // Subsequent pages
  for (let start = 10; start < 200; start += 10) {
    const resp = await axios.get('https://serpapi.com/search.json', {
      params: { ...baseParams, start },
      timeout: 10000
    });
    const pageEvents = resp.data.events_results || [];
    if (!pageEvents.length) break;
    events.push(...pageEvents);
  }

  return events;
}

function parseAddress(addressField, venue) {
  const asArray = Array.isArray(addressField)
    ? addressField
    : addressField
    ? [addressField]
    : venue?.address
    ? [venue.address]
    : [];

  let line1 = '';
  let city = '';
  let state = '';
  let postalCode = '';

  if (asArray.length > 0) {
    line1 = asArray[0] || '';
  }
  const cityStateRaw = asArray.find((entry) => entry && /,\s*[A-Z]{2}/.test(entry));
  if (cityStateRaw) {
    const m = cityStateRaw.match(/^(.*?),\s*([A-Z]{2})(?:\s+(\d{5}))?/);
    if (m) {
      city = m[1] || '';
      state = m[2] || '';
      postalCode = m[3] || '';
    }
  }

  return { line1, city, state, postalCode };
}

function parseDateInfo(dateObj) {
  const monthAbbrs = new Set([
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC'
  ]);

  const normalizeMonthDay = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    // Map common Spanish month/day abbreviations to English equivalents
    const spanishMap = {
      ene: 'JAN',
      feb: 'FEB',
      mar: 'MAR',
      abr: 'APR',
      may: 'MAY',
      jun: 'JUN',
      jul: 'JUL',
      ago: 'AUG',
      sep: 'SEP',
      oct: 'OCT',
      nov: 'NOV',
      dic: 'DEC',
      lun: 'Mon',
      mar_day: 'Tue',
      mié: 'Wed',
      jue: 'Thu',
      vie: 'Fri',
      sáb: 'Sat',
      dom: 'Sun'
    };

    let cleaned = raw;
    // Replace Spanish month abbreviations
    Object.entries(spanishMap).forEach(([key, val]) => {
      const pattern =
        key === 'mar_day'
          ? /\bmar\b/gi // disambiguate mar (Tue) vs Mar (March)
          : new RegExp(`\\b${key}\\b`, 'gi');
      cleaned = cleaned.replace(pattern, val);
    });

    // Tokenize and pick the first valid month token, ignoring day-of-week tokens.
    const tokens = cleaned.split(/[^A-Za-z0-9]+/).filter(Boolean);
    let monthToken = '';
    let dayToken = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].toUpperCase();
      if (monthAbbrs.has(t)) {
        monthToken = t;
        // Look ahead for a numeric day in the next token(s)
        for (let j = i + 1; j < tokens.length; j++) {
          const dayCandidate = parseInt(tokens[j], 10);
          if (!Number.isNaN(dayCandidate) && dayCandidate >= 1 && dayCandidate <= 31) {
            dayToken = String(dayCandidate);
            break;
          }
        }
        break;
      }
    }

    if (!monthToken) return '';
    if (dayToken) return `${monthToken} ${dayToken}`;
    return monthToken;
  };

  if (!dateObj) return { startDate: '', startTime: '', endDate: '', endTime: '', whenRaw: '' };
  const whenRaw = dateObj.when || '';
  let startDate = normalizeMonthDay(dateObj.start_date);
  let endDate = normalizeMonthDay(dateObj.end_date);
  // Fallback: parse from whenRaw if explicit start/end_date missing
  if (!startDate) startDate = normalizeMonthDay(whenRaw);
  if (!endDate) endDate = normalizeMonthDay(whenRaw);
  const startTime = dateObj.start_time || '';
  const endTime = dateObj.end_time || '';
  return { startDate, startTime, endDate, endTime, whenRaw };
}

async function writeCsv(events, outPath) {
  const rows = [];
  rows.push(
    [
      'idx',
      'title',
      'start_date',
      'start_time',
      'end_date',
      'end_time',
      'when_raw',
      'address_line',
      'city',
      'state',
      'postal_code',
      'link'
    ].join(',')
  );
  events.forEach((e, i) => {
    const { startDate, startTime, endDate, endTime, whenRaw } = parseDateInfo(e.date);
    const { line1, city, state, postalCode } = parseAddress(e.address, e.venue);
    rows.push(
      [
        i + 1,
        escapeCsv(e.title),
        escapeCsv(startDate),
        escapeCsv(startTime),
        escapeCsv(endDate),
        escapeCsv(endTime),
        escapeCsv(whenRaw),
        escapeCsv(line1),
        escapeCsv(city),
        escapeCsv(state),
        escapeCsv(postalCode),
        escapeCsv(e.link || '')
      ].join(',')
    );
  });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, rows.join('\n'), 'utf8');
}

async function main() {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.error('Missing SERPAPI_API_KEY in env');
    process.exit(1);
  }
  const query = getArg('--query') || 'events in Boerne, TX';
  const repoRoot = path.join(__dirname, '..');
  const out = getArg('--out') || path.join(repoRoot, 'data', 'boerne-events.csv');

  console.log(`Fetching events for query: "${query}"`);
  const events = await fetchEvents({ query, apiKey });
  console.log(`Found ${events.length} events`);
  await writeCsv(events, out);
  console.log(`CSV written to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
