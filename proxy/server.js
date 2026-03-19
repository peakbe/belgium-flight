import express from 'express';
import fetch from 'node-fetch';
import cheerio from 'cheerio';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());
const PORT = process.env.PORT || 8787;

function normalizeStatus(text) {
  const t = (text||'').toLowerCase();
  if (t.includes('boarding') || t.includes('embarquement')) return { status: 'Embarquement', statusClass:'boarding' };
  if (t.includes('delayed') || t.includes('retard'))       return { status: 'Retardé',      statusClass:'delayed' };
  if (t.includes('on time') || t.includes("à l'heure"))    return { status: "À l'heure",    statusClass:'ontime' };
  return { status: text || '—', statusClass: '' };
}
function row(time, flight, city, statusText) {
  const st = normalizeStatus(statusText);
  return { time, flight, city, status: st.status, statusClass: st.statusClass };
}

/** CRL (officiel) + fallback */
async function fetchCRL(type='departures') {
  const now = new Date(), pad = n=>String(n).padStart(2,'0');
  const datePath = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()}`;
  const url = `https://www.brussels-charleroi-airport.com/en/flights/live/${type}/${datePath}`;
  let html = '';
  try { const res = await fetch(url, { headers: { 'user-agent': 'FlightDashboard/1.0' }}); html = await res.text(); } catch(e) {}

  if (!html || html.length < 1000) {
    const alt = type==='departures'
      ? 'https://www.airportia.com/belgium/brussels-south-charleroi-airport/departures/'
      : 'https://www.airportia.com/belgium/brussels-south-charleroi-airport/arrivals/';
    try { const res = await fetch(alt); html = await res.text(); } catch(e) {}
  }

  const $ = cheerio.load(html);
  const rows = [];
  $('table tbody tr').each((i, el)=>{
    const td = $(el).find('td');
    const time = td.eq(0).text().trim();
    const flight = td.eq(1).text().trim();
    const city = td.eq(2).text().trim();
    const status = td.eq(3).text().trim();
    if (time && flight && city) rows.push(row(time, flight, city, status));
  });
  return rows;
}

/** LGG (officiel) + fallback */
async function fetchLGG(type='departures') {
  let html = '';
  try { const res = await fetch('https://www.liegeairport.com/passenger/fr/departs-arrivees/', { headers: { 'user-agent': 'FlightDashboard/1.0' }}); html = await res.text(); } catch(e) {}

  const $ = cheerio.load(html);
  const rows = [];
  ($('table tbody tr')).each((i, el)=>{
    const td = $(el).find('td');
    const time = td.eq(0).text().trim();
    const flight = td.eq(1).text().trim();
    const city = td.eq(2).text().trim();
    const status = td.eq(3).text().trim();
    if (time && flight && city) rows.push(row(time, flight, city, status));
  });
  if (rows.length) return rows;

  const alt = type==='departures'
    ? 'https://www.flightera.net/en/airport/Liege/EBLG'
    : 'https://www.airportia.com/belgium/liege-airport/arrivals/';
  try { const res = await fetch(alt); html = await res.text(); } catch(e) {}

  const $2 = cheerio.load(html);
  $2('table tbody tr').each((i, el)=>{
    const td = $2(el).find('td');
    const time = td.eq(0).text().trim();
    const flight = td.eq(1).text().trim();
    const city = td.eq(2).text().trim();
    const status = td.eq(3).text().trim();
    if (time && flight && city) rows.push(row(time, flight, city, status));
  });
  return rows;
}

app.get('/api/crl/departures', async (req, res) => { try { res.json(await fetchCRL('departures')); } catch { res.json([]); } });
app.get('/api/crl/arrivals',   async (req, res) => { try { res.json(await fetchCRL('arrivals')); }   catch { res.json([]); } });
app.get('/api/lgg/departures', async (req, res) => { try { res.json(await fetchLGG('departures')); } catch { res.json([]); } });
app.get('/api/lgg/arrivals',   async (req, res) => { try { res.json(await fetchLGG('arrivals')); }   catch { res.json([]); } });

app.listen(PORT, ()=> console.log(`Flight proxy listening on :${PORT}`));
