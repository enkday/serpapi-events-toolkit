const fs = require('fs').promises;
const path = require('path');
const { fetchEvents, parseDateInfo, parseAddress } = require('./fetch-events');

const monthMap = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12
};

function pad(num, size = 2) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

function parseMonthDay(md, fallbackYear) {
  if (!md) return null;
  const m = md.match(/^([A-Z]{3})\s+(\d{1,2})$/i);
  if (!m) return null;
  const month = monthMap[m[1].toUpperCase()];
  if (!month) return null;
  return { year: fallbackYear, month, day: parseInt(m[2], 10) };
}

function parseTimeStr(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3].toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function toIcsDate(parts, time) {
  if (!parts) return null;
  const year = parts.year || new Date().getFullYear();
  const month = pad(parts.month);
  const day = pad(parts.day);
  if (time) {
    const hh = pad(time.hour);
    const mm = pad(time.minute);
    return `${year}${month}${day}T${hh}${mm}00`;
  }
  return `${year}${month}${day}`;
}

function buildLocation(addr, city, state) {
  const bits = [addr, city, state].filter(Boolean);
  return bits.join(', ');
}

function addDays(parts, delta) {
  if (!parts) return null;
  const year = parts.year || new Date().getFullYear();
  const d = new Date(Date.UTC(year, (parts.month || 1) - 1, parts.day || 1));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

async function main() {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.error('Missing SERPAPI_API_KEY in env');
    process.exit(1);
  }
  const query = process.argv.includes('--query')
    ? process.argv[process.argv.indexOf('--query') + 1]
    : process.env.EVENT_QUERY || 'events';
  const out = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : path.join(__dirname, '..', 'data', process.env.EVENT_ICS || 'events.ics');

  const events = await fetchEvents({ query, apiKey });
  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//serpapi-events//EN');

  events.forEach((evt, idx) => {
    const { startDate, endDate, startTime, endTime, whenRaw } = parseDateInfo(evt.date);
    const { line1, city, state } = parseAddress(evt.address, evt.venue);
    const fallbackYear =
      (whenRaw && whenRaw.match(/\b(20\d{2})\b/) && parseInt(whenRaw.match(/\b(20\d{2})\b/)[1], 10)) ||
      new Date().getFullYear();

    const startParts = parseMonthDay(startDate, fallbackYear);
    const endParts = parseMonthDay(endDate || startDate, fallbackYear);

    // All-day events: use date-only, DTEND exclusive (add 1 day)
    const dtStartDate = toIcsDate(startParts, null);
    const dtEndDate = toIcsDate(addDays(endParts, 1), null);
    if (!dtStartDate || !dtEndDate) return;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${idx}-${evt.title.replace(/[^A-Za-z0-9]+/g, '')}@serpapi-events`);
    lines.push(`DTSTAMP:${dtStartDate}`);
    lines.push(`DTSTART;VALUE=DATE:${dtStartDate}`);
    lines.push(`DTEND;VALUE=DATE:${dtEndDate}`);
    lines.push('TRANSP:TRANSPARENT'); // do not block availability
    lines.push(`SUMMARY:${(evt.title || '').replace(/,/g, '\\,')}`);
    const loc = buildLocation(line1, city, state);
    if (loc) lines.push(`LOCATION:${loc.replace(/,/g, '\\,')}`);
    const descParts = [];
    if (whenRaw) descParts.push(`When: ${whenRaw}`);
    if (evt.link) descParts.push(`Link: ${evt.link}`);
    if (descParts.length) lines.push(`DESCRIPTION:${descParts.join('\\n').replace(/,/g, '\\,')}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, lines.join('\r\n'), 'utf8');
  console.log(`ICS written to ${out}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { };
