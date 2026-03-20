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
  // --- helpers dans le contexte navigateur ---
  const TIME_HEADERS = [/^std$/i, /^sta$/i, /heure|time/i, /sched|etd|eta/i];
  const FLIGHT_HEADERS = [/^flight$/i, /^vol$/i, /flight ?no/i, /n[°o]\.?/i];
  const DEST_HEADERS = [/^dest/i, /^to$/i, /ville|city/i, /destination/i];
  const ORIG_HEADERS = [/^from$/i, /orig/i, /provenance/i];
  const STATUS_HEADERS = [/^status/i, /statut/i];

  const isTimeLike = (s) => /^\d{1,2}:\d{2}$/.test(s||'');
  const isDateLike = (s) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s||'');
  const isFlightLike = (s) => /^[A-Z0-9]{1,3}\s?\d{1,4}[A-Z]?$/.test((s||'').replace(/\s+/g,''));
  const pickIndex = (headers, patterns) => {
    for (let i=0; i<headers.length; i++) {
      const h = (headers[i]||'').toLowerCase().trim();
      if (patterns.some(rx => rx.test(h))) return i;
    }
    return -1;
  };

  function extractFromTable(tbl) {
    const ths = Array.from(tbl.querySelectorAll('thead th')).map(th => th.innerText.trim());
    const trs = Array.from(tbl.querySelectorAll('tbody tr'));

    // détecter indexes d'après les <th>
    const idx = { time:-1, flight:-1, city:-1, status:-1 };

    if (ths.length) {
      idx.time   = pickIndex(ths, TIME_HEADERS);
      idx.flight = pickIndex(ths, FLIGHT_HEADERS);
      // On ne sait pas encore si le tableau est Arrivées ou Départs => on l’inférera
      const idxDest = pickIndex(ths, DEST_HEADERS);
      const idxOrig = pickIndex(ths, ORIG_HEADERS);
      idx.city   = (idxDest >= 0 ? idxDest : (idxOrig >= 0 ? idxOrig : -1));
      idx.status = pickIndex(ths, STATUS_HEADERS);
    }

    const rows = [];
    trs.forEach(tr => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      if (!tds.length) return;

      // Si pas d'en-tête exploitable, heuristique par motif
      let t = (idx.time>=0 ? tds[idx.time] : '');
      let f = (idx.flight>=0 ? tds[idx.flight] : '');
      let c = (idx.city>=0 ? tds[idx.city] : '');
      let s = (idx.status>=0 ? tds[idx.status] : '');

      // Heuristiques si colonnes non trouvées ou incohérentes
      const sample = tds.slice(0, Math.min(6, tds.length));
      if (!isFlightLike(f)) {
        const foundF = sample.find(x => isFlightLike(x));
        if (foundF) f = foundF;
      }
      if (!isTimeLike(t)) {
        const foundT = sample.find(x => isTimeLike(x));
        if (foundT) t = foundT;
      }
      if (!c || isFlightLike(c) || isDateLike(c)) {
        const foundC = sample.find(x => x && !isFlightLike(x) && !isDateLike(x) && !isTimeLike(x));
        if (foundC) c = foundC;
      }
      if (!s) {
        const cand = sample.find(x => /landed|atterri|on block|embarquement|boarding|delay|retard/i.test(x));
        if (cand) s = cand;
      }

      // Filtrage : ignorer les lignes qui sont des séparateurs de date
      if (isDateLike(t) && !isTimeLike(t)) t = '';
      if (!isFlightLike(f)) return; // ex: ligne "19/03/2026" seule

      rows.push({ time: t || '—', flight: f || '—', city: c || '—', status: s || '' });
    });

    return rows;
  }

  // Classification Départs/Arrivées par titre et/ou contenu
  const result = { dep: [], arr: [] };
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'));

  let usedByHeading = false;
  headings.forEach(h => {
    const t = (h.innerText||'').toLowerCase();
    const table = h.nextElementSibling && h.nextElementSibling.matches('table')
      ? h.nextElementSibling
      : (h.parentElement && h.parentElement.querySelector('table'));
    if (!table) return;
    const rows = extractFromTable(table);
    if (!rows.length) return;
    if (t.includes('depart')) result.dep = rows;
    if (t.includes('arriv'))  result.arr = rows;
    usedByHeading = true;
  });
  if (usedByHeading && (result.dep.length || result.arr.length)) return result;

  // Fallback : balayer toutes les tables et inférer
  const tables = Array.from(document.querySelectorAll('table'));
  const classified = [];
  tables.forEach(tbl => {
    const rows = extractFromTable(tbl);
    if (!rows.length) return;
    const statuses = rows.map(r => r.status.toLowerCase()).join(' ');
    const arrLike = /landed|atterri|on block/i.test(statuses);
    classified.push({ type: arrLike ? 'arr' : 'dep', rows });
  });

  // Choisir un bloc dep et un bloc arr si dispo
  const firstDep = classified.find(x => x.type==='dep');
  const firstArr = classified.find(x => x.type==='arr');
  if (firstDep) result.dep = firstDep.rows;
  if (firstArr) result.arr = firstArr.rows;

  // Dernier filet : si un seul type trouvé, utiliser le suivant comme l'autre
  if ((!result.dep.length || !result.arr.length) && classified.length >= 2) {
    if (!result.dep.length) result.dep = classified[0].rows;
    if (!result.arr.length) result.arr = classified[1].rows;
  }
  return result;
});


  function extractFromTable(tbl) {
    const ths = Array.from(tbl.querySelectorAll('thead th')).map(th => th.innerText.trim());
    const trs = Array.from(tbl.querySelectorAll('tbody tr'));

    // détecter indexes d'après les <th>
    const idx = { time:-1, flight:-1, city:-1, status:-1 };

    if (ths.length) {
      idx.time   = pickIndex(ths, TIME_HEADERS);
      idx.flight = pickIndex(ths, FLIGHT_HEADERS);
      // On ne sait pas encore si le tableau est Arrivées ou Départs => on l’inférera
      const idxDest = pickIndex(ths, DEST_HEADERS);
      const idxOrig = pickIndex(ths, ORIG_HEADERS);
      idx.city   = (idxDest >= 0 ? idxDest : (idxOrig >= 0 ? idxOrig : -1));
      idx.status = pickIndex(ths, STATUS_HEADERS);
    }

    const rows = [];
    trs.forEach(tr => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      if (!tds.length) return;

      // Si pas d'en-tête exploitable, heuristique par motif
      let t = (idx.time>=0 ? tds[idx.time] : '');
      let f = (idx.flight>=0 ? tds[idx.flight] : '');
      let c = (idx.city>=0 ? tds[idx.city] : '');
      let s = (idx.status>=0 ? tds[idx.status] : '');

      // Heuristiques si colonnes non trouvées ou incohérentes
      const sample = tds.slice(0, Math.min(6, tds.length));
      if (!isFlightLike(f)) {
        // Chercher un champ qui ressemble à un code vol
        const foundF = sample.find(x => isFlightLike(x));
        if (foundF) f = foundF;
      }
      if (!isTimeLike(t)) {
        // Chercher une heure plausible si time manquant mais présent ailleurs
        const foundT = sample.find(x => isTimeLike(x));
        if (foundT) t = foundT;
      }
      if (!c || isFlightLike(c) || isDateLike(c)) {
        // Ville (dest/orig) ne doit pas être un code vol ni une date
        // Chercher un champ texte non flight-like
        const foundC = sample.find(x => x && !isFlightLike(x) && !isDateLike(x) && !isTimeLike(x));
        if (foundC) c = foundC;
      }
      // Statut : si pas de colonne 'Status', on regarde un champ textuel restant
      if (!s) {
        const cand = sample.find(x => /landed|atterri|depart|delay|retard|on block|embarquement/i.test(x));
        if (cand) s = cand;
      }

      // Filtrage : ignorer les lignes qui sont des séparateurs de date
      if (isDateLike(t) && !isTimeLike(t)) t = '';  // une date n'est pas une heure
      if (!isFlightLike(f)) return; // ex: ligne titre "19/03/2026" etc.

      rows.push({ time: t || '—', flight: f || '—', city: c || '—', status: s || '' });
    });

    return rows;
  }

  // Classification Départs/Arrivées par titre et/ou colonnes
  const result = { dep: [], arr: [] };
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'));

  let usedByHeading = false;
  headings.forEach(h => {
    const t = (h.innerText||'').toLowerCase();
    const table = h.nextElementSibling && h.nextElementSibling.matches('table')
      ? h.nextElementSibling
      : (h.parentElement && h.parentElement.querySelector('table'));
    if (!table) return;
    const rows = extractFromTable(table);
    if (!rows.length) return;
    if (t.includes('depart')) result.dep = rows;
    if (t.includes('arriv'))  result.arr = rows;
    usedByHeading = true;
  });
  if (usedByHeading && (result.dep.length || result.arr.length)) return result;

  // Fallback : balayer toutes les tables et inférer
  const tables = Array.from(document.querySelectorAll('table'));
  const classified = [];
  tables.forEach(tbl => {
    const rows = extractFromTable(tbl);
    if (!rows.length) return;
    // heuristique : si beaucoup de statuts 'Landed/Atterri' => arrivals
    const statuses = rows.map(r => r.status.toLowerCase()).join(' ');
    const arrLike = /landed|atterri|on block/i.test(statuses);
    classified.push({ type: arrLike ? 'arr' : 'dep', rows });
  });
  // Choisir un bloc dep et un bloc arr si dispo
  const firstDep = classified.find(x => x.type==='dep');
  const firstArr = classified.find(x => x.type==='arr');
  if (firstDep) result.dep = firstDep.rows;
  if (firstArr) result.arr = firstArr.rows;

  // Dernier filet : si un seul type trouvé, prendre le suivant comme l'autre
  if ((!result.dep.length || !result.arr.length) && classified.length >= 2) {
    if (!result.dep.length) result.dep = classified[0].rows;
    if (!result.arr.length) result.arr = classified[1].rows;
  }
  return result;
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
  executablePath: puppeteer.executablePath(),  // <— utilise le Chrome téléchargé
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
