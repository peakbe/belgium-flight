import express from 'express';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());

const PORT = process.env.PORT || 8787;

/* ------------------------------------------------------------------
   Helpers
------------------------------------------------------------------ */

function normalizeStatus(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('boarding') || t.includes('embarquement'))
    return { status: 'Embarquement', statusClass: 'boarding' };
  if (t.includes('delayed') || t.includes('retard'))
    return { status: 'Retardé', statusClass: 'delayed' };
  if (t.includes('on time') || t.includes("à l'heure"))
    return { status: "À l'heure", statusClass: 'ontime' };
  return { status: text || '—', statusClass: '' };
}

function row(time, flight, city, statusText) {
  const st = normalizeStatus(statusText);
  return {
    time, flight, city,
    status: st.status,
    statusClass: st.statusClass
  };
}

/* ------------------------------------------------------------------
   LGG (Liège) — FIDS officiel
   Source : FIDS Liège affiche les tableaux en HTML côté serveur
   Réf : https://fids.liegeairport.com/  ([1](https://fids.liegeairport.com/))
         https://fids.liegeairport.com/externals ([2](https://fids.liegeairport.com/externals))
------------------------------------------------------------------ */

async function fetchLGG(type = 'departures') {
  const UA = {
    'user-agent': 'Mozilla/5.0 (BelgiumFlightDashboard)',
    'accept-language': 'fr,en;q=0.9'
  };

  // Plusieurs endpoints FIDS, on essaie chacun
  const candidates = [
    'https://fids.liegeairport.com/externals',
    'https://fids.liegeairport.com/spw',
    'https://fids.liegeairport.com/'
  ];

  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers: UA });
      const html = await r.text();
      if (!html || html.length < 500) continue;

      const $ = load(html);
      const rows = [];

      // On récupère tous les <table><tr>, puis on filtre
      $('table tbody tr').each((i, el) => {
        const tds = $(el).find('td');
        const cols = tds.map((_, c) => $(c).text().trim()).get();
        if (cols.length < 3) return;

        const time   = cols[0];
        const flight = cols[1];
        const city   = cols[2];
        const status = cols[3] || cols[4] || '';

        const okTime   = /^\d{1,2}:\d{2}/.test(time);
        const okFlight = /[A-Z]{1,3}\d+/.test(flight);

        if (okTime && okFlight && city) rows.push(row(time, flight, city, status));
      });

      if (rows.length) return rows;

    } catch (e) {
      // On continue sur l'URL suivante
    }
  }

  return [];
}

/* ------------------------------------------------------------------
   CRL (Charleroi) — FlightStats en primaire, Airportia en fallback
   FlightStats SSR : https://www.flightstats.com/v2/... ([3](https://www.airportia.com/belgium/brussels-south-charleroi-airport/departures/))
   Airportia SSR : https://www.airportia.com/...        ([3](https://www.airportia.com/belgium/brussels-south-charleroi-airport/departures/))
------------------------------------------------------------------ */

async function fetchCRL(type = 'departures') {
  const UA = {
    'user-agent': 'Mozilla/5.0 (BelgiumFlightDashboard)',
    'accept-language': 'en,fr;q=0.8'
  };

  const flightstats = type === 'departures'
    ? 'https://www.flightstats.com/v2/flight-tracker/departures/CRL/'
    : 'https://www.flightstats.com/v2/flight-tracker/arrivals/CRL/';

  const airportia = type === 'departures'
    ? 'https://www.airportia.com/belgium/brussels-south-charleroi-airport/departures/'
    : 'https://www.airportia.com/belgium/brussels-south-charleroi-airport/arrivals/';

  /* ---- 1) FlightStats -> SSR ---- */
  try {
    const r = await fetch(flightstats, { headers: UA });
    const html = await r.text();
    if (html && html.length > 500) {
      const $ = load(html);
      const rows = [];

      $('table tbody tr, .table tbody tr').each((i, el) => {
        const tds = $(el).find('td');
        const cols = tds.map((_, c) => $(c).text().trim()).get();

        if (cols.length < 3) return;

        const time   = cols[0];
        const flight = cols[1];
        const city   = cols[2];
        const status = cols[3] || cols[4] || '';

        const okTime   = /^\d{1,2}:\d{2}/.test(time);
        const okFlight = /[A-Z]{1,3}\d+/.test(flight);

        if (okTime && okFlight && city)
          rows.push(row(time, flight, city, status));
      });

      if (rows.length) return rows;
    }
  } catch (e) {}

  /* ---- 2) Airportia -> SSR souvent ---- */
  try {
    const r2 = await fetch(airportia, { headers: UA });
    const html2 = await r2.text();
    if (html2 && html2.length > 500) {
      const $ = load(html2);
      const rows = [];

      $('table tbody tr, .table tbody tr').each((i, el) => {
        const tds = $(el).find('td');
        const time   = tds.eq(0).text().trim();
        const flight = tds.eq(1).text().trim();
        const city   = tds.eq(2).text().trim();
        const status = tds.eq(3).text().trim();

        const okTime   = /^\d{1,2}:\d{2}/.test(time);
        const okFlight = /[A-Z]{1,3}\d+/.test(flight);

        if (okTime && okFlight && city)
          rows.push(row(time, flight, city, status));
      });

      if (rows.length) return rows;
    }
  } catch (e) {}

  return [];
}

/* ------------------------------------------------------------------
   API routes
------------------------------------------------------------------ */

app.get('/api/crl/departures', async (_req, res) => {
  try { res.json(await fetchCRL('departures')); }
  catch { res.json([]); }
});

app.get('/api/crl/arrivals', async (_req, res) => {
  try { res.json(await fetchCRL('arrivals')); }
  catch { res.json([]); }
});

app.get('/api/lgg/departures', async (_req, res) => {
  try { res.json(await fetchLGG('departures')); }
  catch { res.json([]); }
});

app.get('/api/lgg/arrivals', async (_req, res) => {
  try { res.json(await fetchLGG('arrivals')); }
  catch { res.json([]); }
});

/* ------------------------------------------------------------------
   Debug route: permet de voir ce que Render reçoit réellement
------------------------------------------------------------------ */

app.get('/debug/source', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send("missing ?url=");

    const r = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (BelgiumFlightDashboard)',
        'accept-language': 'en,fr;q=0.8'
      }
    });
    const html = await r.text();
    res.type('text/plain').send(html.slice(0, 4000));
  } catch (e) {
    res.status(500).send(String(e));
  }
});

/* ------------------------------------------------------------------
   Root + Health
------------------------------------------------------------------ */

app.get('/', (_req, res) => {
  res.type('text/plain').send('Belgium Flight Proxy — OK. Try /healthz or /api/... ');
});

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

/* ------------------------------------------------------------------
   Start
------------------------------------------------------------------ */

app.listen(PORT, () => {
  console.log(`Flight proxy listening on :${PORT}`);
});
