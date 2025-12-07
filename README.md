# SerpApi Google Events Toolkit

Lightweight Node/Express proxy plus scripts to fetch SerpApi `google_events` data into CSV/ICS. API key is read from `SERPAPI_API_KEY` in the environment (not committed).

## Setup

```bash
cd serpapi-events-repo
npm install
cp .env.example .env   # set SERPAPI_API_KEY
npm start              # http://localhost:3001
```

## Proxy

- Forces `engine=google_events`, injects `SERPAPI_API_KEY` server-side.
- Health: `GET /health`
- Example: `curl "http://localhost:3001/search?q=events"`

## CSV

```bash
# default query/output
SERPAPI_API_KEY=... node scripts/fetch-events.js

# custom query/output
SERPAPI_API_KEY=... node scripts/fetch-events.js --query "events in CITY, STATE" --out data/events.csv
```

Columns: idx, title, start_date, start_time, end_date, end_time, when_raw, address_line, city, state, link.

## ICS

```bash
SERPAPI_API_KEY=... node scripts/generate-ics.js --query "events in CITY, STATE" --out data/events.ics
```

After pushing, subscribe to the hosted ICS URL you publish (e.g., raw GitHub URL if public).

## Deploying

- Keep `SERPAPI_API_KEY` as an env var/secret in your host.
- Optional: set `PORT` for the proxy.

## Automation

- `.github/workflows/daily-refresh.yml` runs daily (08:00 UTC) and on manual dispatch:
  - Uses `EVENT_QUERY` env (set in the workflow) and `SERPAPI_API_KEY` secret
  - Regenerates `data/events.csv` and `data/events.ics`
  - Commits/pushes changes if files differ
