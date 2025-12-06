# SerpApi Google Events Toolkit

Lightweight Node/Express proxy for SerpApi's `google_events` engine plus a CSV fetch script. API key is kept in the environment, not passed by clients.

## Setup

```bash
cd serpapi-events-repo
npm install
cp .env.example .env   # fill SERPAPI_API_KEY
npm start              # defaults to http://localhost:3001
```

## Proxy usage

```bash
curl "http://localhost:3001/search?q=concerts%20in%20Austin"
curl "http://localhost:3001/search?q=tech%20events&location=San%20Francisco%2C%20CA&hl=en&gl=us&start=10"
```

Notes:
- The proxy forces `engine=google_events` and injects `SERPAPI_API_KEY` from the server environment.
- Query params you can pass through: `q` (required), `location`, `hl`, `gl`, `start`. Additional SerpApi params can be added similarly if needed.
- Health check: `GET /health` returns `{ "status": "ok" }`.

## OpenAPI

See `openapi.json` for a minimal spec pointing at this proxy (default server http://localhost:3001).

## CSV fetch script

Fetch and save events to CSV (Excel-friendly) using SerpApi:

```bash
# fetches all pages for Boerne, TX and writes data/boerne-events.csv
SERPAPI_API_KEY=... node scripts/fetch-events.js

# custom query and output path
SERPAPI_API_KEY=... node scripts/fetch-events.js --query "events in Austin, TX" --out data/austin-events.csv
```

Notes:
- The script avoids `start=0` (which can return empty) and paginates `start=10,20,...` until no more results.
- CSV columns: idx, title, start_date, start_time, end_date, end_time, when_raw, address_line, city, state, link.

## ICS generation

Generate an iCalendar feed (ics) from SerpApi events:

```bash
SERPAPI_API_KEY=... node scripts/generate-ics.js --query "events in Boerne, TX" --out data/boerne-events.ics
```

- Uses date ranges parsed from `when` text; time is pulled from SerpApi fields or `when` text.
- Subscribe to the raw ICS URL (after pushing to GitHub): `https://raw.githubusercontent.com/enkday/serpapi-events-toolkit/main/data/boerne-events.ics`

## Deploying

- Add `SERPAPI_API_KEY` as an environment variable/secret in your hosting provider.
- Optional: adjust `PORT` via env var.
