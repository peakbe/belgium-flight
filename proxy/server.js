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
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const datePath = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;

  // Site officiel CRL (panneau live par date) — la structure peut évoluer
  // Source: Brussels South Charleroi (live flights) 
  const primary = `https://www.brussels-charleroi-airport.com/en/flights/live/${type}/${datePath}`;
  // Fallback public si le DOM change (agrégateur)
  const fallback = type === 'departures'
    ? 'https://www.airportia.com/belgium/brussels-south-charleroi-airport/departures/'
    : 'https://www.airportia.com/belgium/brussels-south-charleroi-airport/arrivals/';

  let html = '';
  try {
    const r = await fetch(primary, { headers: { 'user-agent': 'FlightDashboard/1.0' } });
    html = await r.text();
  } catch {}

  let rows = [];
  if (html && html.length > 1000) {
    const $ = load(html);
    $('table tbody tr').each((i, el) => {
      const td = $(el).find('td');
      const time = td.eq(0).text().trim();
      const flight = td.eq(1).text().trim();
      const city = td.eq(2).text().trim();
      const status = td.eq(3).text().trim();
      if (time && flight && city) rows.push(row(time, flight, city, status));
    });
  }

  if (rows.length) return rows;

  // Fallback (structure différente possible)
  try {
    const r = await fetch(fallback, { headers: { 'user-agent': 'FlightDashboard/1.0' } });
    html = await r.text();
  } catch {}

  if (html && html.length > 1000) {
    const $ = load(html);
    $('table tbody tr, .table tbody tr').each((i, el) => {
      const td = $(el).find('td');
      const time = td.eq(0).text().trim();
      const flight = td.eq(1).text().trim();
      const city = td.eq(2).text().trim();
      const status = td.eq(3).text().trim();
      if (time && flight && city) rows.push(row(time, flight, city, status));
    });
  }

  return rows;
}

/** LGG (site officiel) + fallback si nécessaire */
async function fetchLGG(type = 'departures') {
  // Page officielle Départs & Arrivées
  // Source: Liège Airport (page Passager)
  const primary = 'https://www.liegeairport.com/passenger/fr/departs-arrivees/';
  const fallback = type === 'departures'
    ? 'https://www.flightera.net/en/airport/Liege/EBLG'
    : 'https://www.airportia.com/belgium/liege-airport/arrivals/';

  let html = '';
  try {
    const r = await fetch(primary, { headers: { 'user-agent': 'FlightDashboard/1.0' } });
    html = await r.text();
  } catch {}

  let rows = [];
  if (html && html.length > 1000) {
    const $ = load(html);
    // On racle toutes les lignes de tableaux présents sur la page
    $('table tbody tr').each((i, el) => {
      const td = $(el).find('td');
      const time = td.eq(0).text().trim();
      const flight = td.eq(1).text().trim();
      const city = td.eq(2).text().trim();
      const status = td.eq(3).text().trim();
      if (time && flight && city) rows.push(row(time, flight, city, status));
    });
  }

  if (rows.length) return rows;

  // Fallback public
  try {
    const r = await fetch(fallback, { headers: { 'user-agent': 'FlightDashboard/1.0' } });
    html = await r.text();
  } catch {}

  if (html && html.length > 1000) {
    const $ = load(html);
    $('table tbody tr, .table tbody tr').each((i, el) => {
      const td = $(el).find('td');
      const time = td.eq(0).text().trim();
      const flight = td.eq(1).text().trim();
      const city = td.eq(2).text().trim();
      const status = td.eq(3).text().trim();
      if (time && flight && city) rows.push(row(time, flight, city, status));
    });
  }

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

/* --------- Start --------- */

app.listen(PORT, () => console.log(`Flight proxy listening on :${PORT}`));
``
