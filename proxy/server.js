import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());

const PORT = process.env.PORT || 8787;
const AIRLABS_KEY = process.env.AIRLABS_API_KEY || "";

/* ----------------------------------------------------------
   Helpers
---------------------------------------------------------- */

function normalizeStatus(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('landed')) return { status: 'Atterri', statusClass: 'ontime' };
  if (t.includes('departed')) return { status: 'Parti', statusClass: 'boarding' };
  if (t.includes('cancel')) return { status: 'Annulé', statusClass: 'delayed' };
  if (t.includes('delay')) return { status: 'Retardé', statusClass: 'delayed' };
  if (t.includes('scheduled')) return { status: 'Prévu', statusClass: '' };
  if (t.includes('en-route')) return { status: 'En vol', statusClass: 'ontime' };
  return { status: text || '—', statusClass: '' };
}

function toRow(obj, mode) {
  // mode = "dep" ou "arr"
  const time = obj.dep_time || obj.arr_time || "—";
  const flight = obj.flight_iata || obj.flight_icao || obj.flight_number || "—";
  const city = (mode === 'dep')
    ? (obj.arr_city || obj.arr_iata || obj.arr_icao || "—")
    : (obj.dep_city || obj.dep_iata || obj.dep_icao || "—");

  const rawStatus = obj.status || obj.cs ?? "";
  const st = normalizeStatus(rawStatus);

  return {
    time,
    flight,
    city,
    status: st.status,
    statusClass: st.statusClass
  };
}

/* ----------------------------------------------------------
   Fetch depuis AirLabs
   Réf API: https://airlabs.co/api/v9/schedules  (horaires) [1](https://airlabs.co/brussels-south-charleroi-airport-api)
            https://airlabs.co/api/v9/flights    (statuts live)
---------------------------------------------------------- */

async function fetchSchedules(params) {
  if (!AIRLABS_KEY) return [];
  const qs = new URLSearchParams({ api_key: AIRLABS_KEY, ...params });
  const url = `https://airlabs.co/api/v9/schedules?${qs.toString()}`;

  try {
    const r = await fetch(url);
    const j = await r.json();
    if (!j.response || !Array.isArray(j.response)) return [];
    return j.response;
  } catch {
    return [];
  }
}

async function fetchFlights(params) {
  if (!AIRLABS_KEY) return [];
  const qs = new URLSearchParams({ api_key: AIRLABS_KEY, ...params });
  const url = `https://airlabs.co/api/v9/flights?${qs.toString()}`;

  try {
    const r = await fetch(url);
    const j = await r.json();
    if (!j.response || !Array.isArray(j.response)) return [];
    return j.response;
  } catch {
    return [];
  }
}

/* ----------------------------------------------------------
   CRL (passagers) -> SCHEDULES est suffisant
---------------------------------------------------------- */

async function getCRLDepartures() {
  const rows = await fetchSchedules({ dep_iata: "CRL" });
  return rows.map(x => toRow(x, "dep"));
}

async function getCRLArrivals() {
  const rows = await fetchSchedules({ arr_iata: "CRL" });
  return rows.map(x => toRow(x, "arr"));
}

/* ----------------------------------------------------------
   LGG (cargo) -> COMBO SCHEDULES + FLIGHTS pour couvrir tout
---------------------------------------------------------- */

async function getLGGDepartures() {
  const sched = await fetchSchedules({ dep_iata: "LGG" });
  const live  = await fetchFlights({ dep_iata: "LGG" });

  const combined = [...sched, ...live];

  const rows = combined.map(x => toRow(x, "dep"));

  // dédoublonner par num de vol + heure
  const dedupe = new Map();
  rows.forEach(r => {
    const key = r.flight + "__" + r.time;
    dedupe.set(key, r);
  });
  return [...dedupe.values()];
}

async function getLGGArrivals() {
  const sched = await fetchSchedules({ arr_iata: "LGG" });
  const live  = await fetchFlights({ arr_iata: "LGG" });

  const combined = [...sched, ...live];

  const rows = combined.map(x => toRow(x, "arr"));

  const dedupe = new Map();
  rows.forEach(r => {
    const key = r.flight + "__" + r.time;
    dedupe.set(key, r);
  });
  return [...dedupe.values()];
}

/* ----------------------------------------------------------
   API routes
---------------------------------------------------------- */

app.get("/api/crl/departures", async (_req, res) => {
  res.json(await getCRLDepartures());
});

app.get("/api/crl/arrivals", async (_req, res) => {
  res.json(await getCRLArrivals());
});

app.get("/api/lgg/departures", async (_req, res) => {
  res.json(await getLGGDepartures());
});

app.get("/api/lgg/arrivals", async (_req, res) => {
  res.json(await getLGGArrivals());
});

/* ----------------------------------------------------------
   Health
---------------------------------------------------------- */

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.get("/", (_req, res) => {
  res.type("text/plain").send("Belgium Flight Proxy — OK. Try /api/crl/departures etc.");
});

/* ----------------------------------------------------------
   Start
---------------------------------------------------------- */

app.listen(PORT, () => {
  console.log(`Flight proxy listening on port: ${PORT}`);
});
