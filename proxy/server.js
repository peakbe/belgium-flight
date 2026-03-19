import express from 'express';
import fetch from 'node-fetch';
import { load } from 'cheerio';     // ⬅️ correction ESM : utiliser { load } au lieu de import default
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());

const PORT = process.env.PORT || 8787;

/* --------- Utils --------- */

function normalizeStatus(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('boarding') || t.includes('embarquement')) return { status: 'Embarquement', statusClass: 'boarding' };
  if (t.includes('delayed')  || t.includes('retard'))       return { status: 'Retardé',      statusClass: 'delayed'  };
  if (t.includes('on time')  || t.includes("à l'heure"))    return { status: "À l'heure",    statusClass: 'ontime'   };
  return { status: text || '—', statusClass: '' };
}

function row(time, flight, city, statusText) {
  const st = normalizeStatus(statusText);
  return { time, flight, city, status: st.status, statusClass: st.statusClass };
}

/* --------- Scrapers --------- */

/** CRL (site officiel) + fallback si la page change trop */
async function fetchCRL(type = 'departures') {

  const flightera = type === 'departures'
    ? 'https://www.flightera.net/en/airport/Brussels+South+Charleroi+Airport/EBCI/departures'
    : 'https://www.flightera.net/en/airport/Brussels+South+Charleroi+Airport/EBCI/arrivals';

  let html = '';
  try {
    const r = await fetch(flightera, { headers: { 'user-agent': 'Mozilla/5.0' }});
    html = await r.text();
  } catch {
    return [];
  }

  if (!html || html.length < 500) return [];

  const $ = load(html);
  const rows = [];

  $('table tbody tr').each((i, el) => {
    const td = $(el).find('td');
    const time   = td.eq(0).text().trim();
    const flight = td.eq(1).text().trim();
    const city   = td.eq(2).text().trim();
    const status = td.eq(3).text().trim();

    if (time && flight && city) {
      rows.push(row(time, flight, city, status));
    }
  });

  return rows;
}

/** LGG (site officiel) + fallback si nécessaire */
async function fetchLGG(type = 'departures') {

  const flightera = type === 'departures'
    ? 'https://www.flightera.net/en/airport/Liege/EBLG/departures'
    : 'https://www.flightera.net/en/airport/Liege/EBLG/arrivals';

  let html = '';
  try {
    const r = await fetch(flightera, { headers: { 'user-agent': 'Mozilla/5.0' }});
    html = await r.text();
  } catch {
    return [];
  }

  if (!html || html.length < 500) return [];

  const $ = load(html);
  const rows = [];

  $('table tbody tr').each((i, el) => {
    const td = $(el).find('td');
    const time   = td.eq(0).text().trim();
    const flight = td.eq(1).text().trim();
    const city   = td.eq(2).text().trim();
    const status = td.eq(3).text().trim();

    if (time && flight && city) {
      rows.push(row(time, flight, city, status));
    }
  });

  return rows;
}

/* --------- Routes --------- */

app.get('/api/crl/departures', async (_req, res) => {
  try { res.json(await fetchCRL('departures')); } catch { res.json([]); }
});

app.get('/api/crl/arrivals', async (_req, res) => {
  try { res.json(await fetchCRL('arrivals')); } catch { res.json([]); }
});

app.get('/api/lgg/departures', async (_req, res) => {
  try { res.json(await fetchLGG('departures')); } catch { res.json([]); }
});

app.get('/api/lgg/arrivals', async (_req, res) => {
  try { res.json(await fetchLGG('arrivals')); } catch { res.json([]); }
});

// Healthcheck pratique sur Render
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Eviter le 404
app.get('/', (_req, res) => {
  res.type('text/plain').send('Belgium Flight Proxy — OK. Try /healthz or /api/... endpoints.');
});

/* --------- Start --------- */

app.listen(PORT, () => console.log(`Flight proxy listening on :${PORT}`));
``
