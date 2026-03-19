import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());

const PORT = process.env.PORT || 8787;
const AIRLABS_KEY = process.env.AIRLABS_API_KEY || "";

/* ============================================================
   Helpers
============================================================ */

function normalizeStatus(text) {
  const t = (text || '').toLowerCase();

  if (t.includes('landed'))     return { status: 'Atterri',    statusClass: 'ontime' };
  if (t.includes('departed'))   return { status: 'Parti',      statusClass: 'boarding' };
  if (t.includes('cancel'))     return { status: 'Annulé',     statusClass: 'delayed'  };
  if (t.includes('delay'))      return { status: 'Retardé',    statusClass: 'delayed'  };
  if (t.includes('scheduled'))  return { status: 'Prévu',      statusClass: ''         };
  if (t.includes('en-route'))   return { status: 'En vol',     statusClass: 'ontime'   };

  return { status: text || '—', statusClass: '' };
}

function toRow(obj, mode) {
  const time = obj.dep_time || obj.arr_time || "—";
  const flight = obj.flight_iata || obj.flight_icao || obj.flight_number || "—";

  let city = "—";
  if (mode === "dep") {
    city = obj.arr_city || obj.arr_iata || obj.arr_icao || "—";
  } else {
    city = obj.dep_city || obj.dep_iata || obj.dep_icao || "—";
  }

  const rawStatus = obj.status || obj.cs || "";
  const st = normalizeStatus(rawStatus);

  return {
    time,
    flight,
    city,
    status: st.status,
    statusClass: st.statusClass
  };
}

/* ============================================================
   AirLabs fetchers
   Réf : https://airlabs.co/api (Schedules / Flights) [1](https://airlabs.co/brussels-south-charleroi-airport-api)
============================================================ */

async function fetchAirLabs(endpoint, params) {
  if (!AIRLABS_KEY) return [];

  const qs = new URLSearchParams({ api_key: AIRLABS_KEY, ...params });
  const url = `https://airlabs.co/api/v9/${endpoint}?${qs.toString()}`;

  try {
    const r = await fetch(url);
    const j = await r.json();

    if (!j || !j.response || !Array.isArray(j.response)) return [];
    return j.response;
  } catch {
    return [];
  }
}

/* ============================================================
   CRL — SCHEDULES only (passagers)
============================================================ */

async function getCRLDepartures() {
  const data = await fetchAirLabs("schedules", { dep_iata: "CRL" });
  return data.map(x => toRow(x, "dep"));
}

async function getCRLArrivals() {
  const data = await fetchAirLabs("schedules", { arr_iata: "CRL" });
  return data.map(x => toRow(x, "arr"));
}

/* ============================================================
   LGG — cargo → SCHEDULES + FLIGHTS
============================================================ */

async function getLGGDepartures() {
  const sched = await fetchAirLabs("schedules", { dep_iata: "LGG" });
  const live  = await fetchAirLabs("flights",   { dep_iata: "LGG" });

  const combined = [...sched, ...live];
  const mapped = combined.map(x => toRow(x, "dep"));

  const dedupe = new Map();
  mapped.forEach(r => {
    const k = r.flight + "_" + r.time;
    dedupe.set(k, r);
  });
  return [...dedupe.values()];
}

async function getLGGArrivals() {
  const sched = await fetchAirLabs("schedules", { arr_iata: "LGG" });
  const live  = await fetchAirLabs("flights",   { arr_iata: "LGG" });

  const combined = [...sched, ...live];
  const mapped = combined.map(x => toRow(x, "arr"));

  const dedupe = new Map();
  mapped.forEach(r => {
    const k = r.flight + "_" + r.time;
    dedupe.set(k, r);
  });
  return [...dedupe.values()];
}

/* ============================================================
   Routes API
============================================================ */

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

/* ============================================================
   Health + Root
============================================================ */

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.get("/", (_req, res) => {
  res.type("text/plain").send("Belgium Flight Proxy — OK. Try /healthz or /api/... ");
});

/* ============================================================
   Start
============================================================ */

app.listen(PORT, () => {
  console.log("Flight proxy listening on port " + PORT);
});
