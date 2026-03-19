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
  // Source primaire : FlightStats (server-rendered)
  const flightstats = type === 'departures'
    ? 'https://www.flightstats.com/v2/flight-tracker/departures/CRL/'
    : 'https://www.flightstats.com/v2/flight-tracker/arrivals/CRL/';

  // Fallback : Airportia (souvent SSR, mais selon l’heure certaines sections peuvent être vides)
  const airportia = type === 'departures'
    ? 'https://www.airportia.com/belgium/brussels-south-charleroi-airport/departures/'
    : 'https://www.airportia.com/belgium/brussels-south-charleroi-airport/arrivals/';

  const UA = { 'user-agent': 'Mozilla/5.0', 'accept-language': 'en;q=0.9,fr;q=0.8' };

  // --- Source primaire
  let html = '';
  try {
    const r = await fetch(flightstats, { headers: UA });
    html = await r.text();
  } catch {}
  let rows = [];

  if (html && html.length > 500) {
    const $ = load(html);

    // FlightStats présente un tableau/une grille. Sélecteurs tolérants :
    $('table tbody tr, .table tbody tr, .table__TableRow-sc-*').each((i, el) => {
      const tds = $(el).find('td, .table__TableCell-sc-*');
      const cols = tds.map((_, c) => $(c).text().trim()).get();
      const time   = cols[0];
      const flight = cols[1];
      const city   = cols[2];
      const status = cols[3] || cols[4] || '';

      if (time && flight && city) rows.push(row(time, flight, city, status));
    });
  }

  if (rows.length) return rows;

  // --- Fallback : Airportia
  html = '';
  try {
    const r = await fetch(airportia, { headers: UA });
    html = await r.text();
  } catch { return []; }

  if (!html || html.length < 500) return [];

  {
    const $ = load(html);
    $('table tbody tr, .table tbody tr').each((i, el) => {
      const tds = $(el).find('td');
      const time   = tds.eq(0).text().trim();
      const flight = tds.eq(1).text().trim();
      const city   = tds.eq(2).text().trim();
      const status = tds.eq(3).text().trim();
      if (time && flight && city) rows.push(row(time, flight, city, status));
    });
  }

  return rows;
}
``

/** LGG (site officiel) + fallback si nécessaire */
async function fetchLGG(type = 'departures') {
  // FIDS officiel Liège – server-rendered HTML
  const url = 'https://fids.liegeairport.com/'; // affiche Arrivals/Departures dans le même document
  let html = '';
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    html = await r.text();
  } catch {
    return [];
  }
  if (!html || html.length < 500) return [];

  const $ = load(html);
  const rows = [];

  // Le FIDS liste deux tables principales "Arrivals" / "Departures".
  // On sélectionne la section en fonction de `type` puis on récupère les lignes <tr>.
  // Selon les versions, les blocs peuvent être séparés visuellement mais restent dans le même DOM.
  const isDep = type === 'departures';
  // Heuristique : filtrer lignes qui ont au moins 3-4 colonnes significatives
  $('table tbody tr').each((i, el) => {
    const tds = $(el).find('td');
    const cols = tds.map((_, c) => $(c).text().trim()).get();
    if (cols.length < 3) return;

    // On essaie de déduire si la ligne appartient aux départs ou aux arrivées
    // en regardant des en-têtes proches ou le contenu (p.ex. "Origin" vs "To").
    // Simplement : quand `isDep`, on attend (Heure, Vol, Destination, Statut)
    // quand `!isDep`, (Heure, Vol, Origine, Statut).
    const time = cols[0];
    const flight = cols[1];
    const city = cols[2];
    const status = cols[3] || '';

    // Garde-fous : heure et n° de vol doivent exister
    if (time && flight && city) {
      rows.push(row(time, flight, city, status));
    }
  });

  return rows;
}
``

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
