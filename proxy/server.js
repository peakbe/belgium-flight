import express from 'express';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import cors from 'cors';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';

dotenv.config();
const app = express();
app.use(cors());

const PORT = process.env.PORT || 8787;

// ------- Mémoire (actualisé en tâche de fond) -------
let LGG_DEPARTURES = [];
let LGG_ARRIVALS   = [];

// ------- Helpers communs -------
function statusToClass(t) {
  const s = (t || '').toLowerCase();
  if (s.includes('retard') || s.includes('delay')) return 'delayed';
  if (s.includes('boarding') || s.includes('embarquement')) return 'boarding';
  if (s.includes("à l'heure") || s.includes('on time')) return 'ontime';
  if (s.includes('atterri') || s.includes('landed')) return 'ontime';
  return '';
}
function trimAll(arr) { return arr.map(x => (x||'').trim()); }

// ------- LGG (Liège) — FIDS via navigateur headless -------
// Stratégie : ouvrir la page FIDS (externals -> spw en fallback), attendre <table> rempli,
// repérer les sections "Departures"/"Arrivals", extraire les lignes et remplir les caches.
const FIDS_CANDIDATES = [
  'https://fids.liegeairport.com/externals',
  'https://fids.liegeairport.com/spw',
  'https://fids.liegeairport.com/'
];

async function scrapeLGGWithBrowser(page) {
  for (const url of FIDS_CANDIDATES) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // attendre que des <tr> apparaissent (post-JS)
      await page.waitForSelector('table tbody tr', { timeout: 20000 });

      // extraire Départs / Arrivées en privilégiant les titres s'ils existent
      const data = await page.evaluate(() => {
        function rowsOfTable(tbl) {
          const out = [];
          const trs = tbl.querySelectorAll('tbody tr');
          trs.forEach(tr => {
            const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
            if (tds.length >= 3) {
              // Heuristique : [Heure, Vol, Ville, Statut?]
              const time = tds[0] || '—';
              const flight = tds[1] || '—';
              const city = tds[2] || '—';
              const status = tds[3] || tds[4] || '';
              if (time && flight && city) out.push({ time, flight, city, status });
            }
          });
          return out;
        }

        const result = { dep: [], arr: [] };

        // 1) Essayer via les en-têtes
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'));
        headings.forEach(h => {
          const t = (h.innerText || '').toLowerCase();
          const nextTable = h.nextElementSibling && h.nextElementSibling.matches('table')
            ? h.nextElementSibling
            : (h.parentElement && h.parentElement.querySelector('table'));
          if (!nextTable) return;

          const rows = rowsOfTable(nextTable);
          if (!rows.length) return;

          if (t.includes('depart')) result.dep = rows;
          if (t.includes('arriv'))  result.arr = rows;
        });

        // 2) Fallback : si aucun titre clair, prendre les deux premiers tableaux
        if (!result.dep.length || !result.arr.length) {
          const allTables = Array.from(document.querySelectorAll('table'));
          if (!result.dep.length && allTables[0]) result.dep = rowsOfTable(allTables[0]);
          if (!result.arr.length && allTables[1]) result.arr = rowsOfTable(allTables[1]);
        }

        return result;
      });

      // Mapper + classes
      const dep = (data.dep || []).map(r => ({ ...r, statusClass: '' }));
      const arr = (data.arr || []).map(r => ({ ...r, statusClass: '' }));
      dep.forEach(r => r.statusClass = statusToClass(r.status));
      arr.forEach(r => r.statusClass = statusToClass(r.status));

      if (dep.length || arr.length) {
        LGG_DEPARTURES = dep;
        LGG_ARRIVALS   = arr;
        return true;
      }
    } catch (e) {
      // essayer la candidate suivante
    }
  }
  return false;
}

async function startLGGJob() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (BelgiumFlightDashboard)');

  // premier run + cron toutes les 60s
  const run = async () => {
    const ok = await scrapeLGGWithBrowser(page);
    console.log(`[LGG] refresh ${ok ? 'OK' : 'KO'} — dep:${LGG_DEPARTURES.length} arr:${LGG_ARRIVALS.length}`);
  };

  await run();
  setInterval(run, 60_000);
}

// ------- CRL (Charleroi) — Scraping SSR (AirportInfo.live) -------
const CRL_URLS = {
  dep: [
    'https://airportinfo.live/fr/departs/crl/aeroport-bruxelles-charleroi-bruxelles-sud',
    'https://airportinfo.live/departures/crl/airport-brussels-south-charleroi'
  ],
  arr: [
    'https://airportinfo.live/fr/arrivees/crl/aeroport-bruxelles-charleroi-bruxelles-sud',
    'https://airportinfo.live/arrivals/crl/airport-brussels-south-charleroi'
  ]
};
// Réf. AirportInfo.live (CRL) : pages SSR consultables publiquement. [4](https://airportinfo.live/fr/departs/crl/aeroport-bruxelles-charleroi-bruxelles-sud)[3](https://airportinfo.live/departures/crl/airport-brussels-south-charleroi)

async function scrapeCRL(kind = 'dep') {
  const list = CRL_URLS[kind] || [];
  for (const url of list) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
      const html = await r.text();
      if (!html || html.length < 500) continue;

      const $ = load(html);
      const out = [];

      $('table tbody tr').each((i, el) => {
        const tds = $(el).find('td');
        if (tds.length < 3) return;
        const [time, flight, city, status] = trimAll([
          tds.eq(0).text(), tds.eq(1).text(), tds.eq(2).text(), tds.eq(3).text()
        ]);

        if (time && flight && city) {
          out.push({ time, flight, city, status, statusClass: statusToClass(status) });
        }
      });

      if (out.length) return out;
    } catch (e) {
      // try next
    }
  }
  return [];
}

// ------- API routes -------
app.get('/api/lgg/departures', (_req, res) => res.json(LGG_DEPARTURES));
app.get('/api/lgg/arrivals',   (_req, res) => res.json(LGG_ARRIVALS));

app.get('/api/crl/departures', async (_req, res) => res.json(await scrapeCRL('dep')));
app.get('/api/crl/arrivals',   async (_req, res) => res.json(await scrapeCRL('arr')));

// Health + Root
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.type('text/plain').send('Belgium Flight Proxy — OK. Try /api/...'));

// Start
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
  // Lancer le job LGG (browser headless)
  startLGGJob().catch(e => console.error('LGG job failed to start:', e));
});
