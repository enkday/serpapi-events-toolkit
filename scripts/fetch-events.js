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
  if (asArray.length > 0) {
    line1 = asArray[0] || '';
  }
  const cityStateRaw = asArray.find((entry) => entry && /,\s*[A-Z]{2}/.test(entry));
  if (cityStateRaw) {
    const m = cityStateRaw.match(/^(.*?),\s*([A-Z]{2})(?:\s+(\d{5}))?/);
    if (m) {
      city = m[1] || '';
      state = m[2] || '';
    }
  }

  return { line1, city, state };
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

  const parseTimes = (raw) => {
    if (!raw || typeof raw !== 'string') return { startTime: '', endTime: '' };
    const zoneMatch = raw.match(/\b(CST|CDT|EST|EDT|PST|PDT|MST|MDT)\b/i);
    const zone = zoneMatch ? zoneMatch[1].toUpperCase() : '';
    const m = raw.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM))(?:\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)))?/i);
    if (!m) return { startTime: '', endTime: '' };
    const start = m[1] ? m[1].replace(/\s+/g, ' ').toUpperCase() : '';
    const end = m[2] ? m[2].replace(/\s+/g, ' ').toUpperCase() : '';
    const appendZone = (t) => (t && zone ? `${t} ${zone}` : t);
    return { startTime: appendZone(start), endTime: appendZone(end) };
  };

  const translateSpanish = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
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
      dic: 'DEC'
    };

    let cleaned = raw;
    Object.entries(spanishMap).forEach(([key, val]) => {
      const pattern =
        key === 'mar_day'
          ? /\bmar\b/gi // mar can be March or Tuesday; harmless if replaced to Tue as we ignore day-of-week later
          : new RegExp(`\\b${key}\\b`, 'gi');
      cleaned = cleaned.replace(pattern, val);
    });
    return cleaned;
  };

  const normalizeMonthDay = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    const cleaned = translateSpanish(raw);
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

  const extractRange = (raw) => {
    if (!raw || typeof raw !== 'string') return [];
    const cleaned = translateSpanish(raw);
    // Collect month/day pairs from the cleaned string.
    const tokens = cleaned.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const pairs = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].toUpperCase();
      if (monthAbbrs.has(t)) {
        // Look ahead for a numeric day
        for (let j = i + 1; j < tokens.length; j++) {
          const dayCandidate = parseInt(tokens[j], 10);
          if (!Number.isNaN(dayCandidate) && dayCandidate >= 1 && dayCandidate <= 31) {
            pairs.push(`${t} ${dayCandidate}`);
            break;
          }
        }
      }
    }
    // If none found but we still have a standalone month, keep it
    if (!pairs.length && tokens.length) {
      const maybeMonth = tokens.find((t) => monthAbbrs.has(t.toUpperCase()));
      if (maybeMonth) pairs.push(maybeMonth.toUpperCase());
    }
    return pairs;
  };

  if (!dateObj) return { startDate: '', startTime: '', endDate: '', endTime: '', whenRaw: '' };
  const whenRaw = dateObj.when || '';
  let startDate = normalizeMonthDay(dateObj.start_date);
  let endDate = normalizeMonthDay(dateObj.end_date);

  // Parse range from whenRaw to correct inverted/missing dates
  const range = extractRange(whenRaw);
  if (range.length >= 2) {
    // Prefer the range ordering outright to avoid inverted values from partial attrs
    startDate = range[0];
    endDate = range[range.length - 1];
  } else if (range.length === 1) {
    if (!startDate) startDate = range[0];
    if (!endDate) endDate = range[0];
  }

  let startTime = dateObj.start_time || '';
  let endTime = dateObj.end_time || '';
  if (!startTime || !endTime) {
    const t = parseTimes(whenRaw);
    if (!startTime) startTime = t.startTime;
    if (!endTime) endTime = t.endTime;
  }
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
      'link'
    ].join(',')
  );
  events.forEach((e, i) => {
    const { startDate, startTime, endDate, endTime, whenRaw } = parseDateInfo(e.date);
    const { line1, city, state } = parseAddress(e.address, e.venue);
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { fetchEvents, parseAddress, parseDateInfo };
