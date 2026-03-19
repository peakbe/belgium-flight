import express from 'express';
import fetch from 'node-fetch';
import { load } from 'cheerio'; // ✅
import cors from 'cors';
import dotenv from 'dotenv';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8787;

/* ======================================================
   1) STOCKAGE EN MEMOIRE LGG (temps réel via SignalR)
====================================================== */

let LGG_DEPARTURES = [];
let LGG_ARRIVALS = [];

/* ======================================================
   2) CONNEXION AU FIDS LGG — SignalR WebSocket
====================================================== */

async function startLGGSignalR() {
  console.log("Connecting to LGG FIDS SignalR…");

  const connection = new HubConnectionBuilder()
    .withUrl("https://fids.liegeairport.com/fidsHub")
    .configureLogging(LogLevel.Error)
    .withAutomaticReconnect()
    .build();

  // Messages "Departures"
  connection.on("Departures", (data) => {
    LGG_DEPARTURES = data.map(d => ({
      time: d.std || d.sta || "—",
      flight: d.flight || "—",
      city: d.city || "—",
      status: d.status || "—",
      statusClass: statusToClass(d.status || "")
    }));
    console.log("LGG departures updated.");
  });

  // Messages "Arrivals"
  connection.on("Arrivals", (data) => {
    LGG_ARRIVALS = data.map(d => ({
      time: d.sta || d.std || "—",
      flight: d.flight || "—",
      city: d.city || "—",
      status: d.status || "—",
      statusClass: statusToClass(d.status || "")
    }));
    console.log("LGG arrivals updated.");
  });

  connection.onclose(() => console.log("LGG FIDS connection closed."));
  connection.onreconnecting(() => console.log("Reconnecting LGG FIDS…"));

  try {
    await connection.start();
    console.log("LGG SignalR connected.");
  } catch (e) {
    console.log("LGG SignalR error:", e);
  }
}

/* Utility: status -> CSS class */
function statusToClass(t) {
  const s = t.toLowerCase();
  if (s.includes("delay") || s.includes("retard")) return "delayed";
  if (s.includes("boarding")) return "boarding";
  if (s.includes("on time") || s.includes("à l'heure")) return "ontime";
  return "";
}

/* ======================================================
   3) CRL — Scraper SSR (AirportInfo.live)
====================================================== */

async function scrapeCRL(type) {
  const url =
    type === "dep"
      ? "https://airportinfo.live/fr/departs/crl/aeroport-charleroi"
      : "https://airportinfo.live/fr/arrivees/crl/aeroport-charleroi";

  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    const html = await r.text();
    const $ = load(html);

    const rows = [];

    $("table tbody tr").each((i, el) => {
      const td = $(el).find("td");
      if (td.length < 4) return;

      const time = td.eq(0).text().trim();
      const flight = td.eq(1).text().trim();
      const city = td.eq(2).text().trim();
      const status = td.eq(3).text().trim();

      rows.push({
        time,
        flight,
        city,
        status,
        statusClass: statusToClass(status)
      });
    });

    return rows;
  } catch (e) {
    console.log("CRL scrape failed:", e);
    return [];
  }
}

/* ======================================================
   4) API ROUTES
====================================================== */

// LGG (via WebSocket)
app.get("/api/lgg/departures", (_req, res) => {
  res.json(LGG_DEPARTURES);
});

app.get("/api/lgg/arrivals", (_req, res) => {
  res.json(LGG_ARRIVALS);
});

// CRL (via SSR scraping)
app.get("/api/crl/departures", async (_req, res) => {
  res.json(await scrapeCRL("dep"));
});

app.get("/api/crl/arrivals", async (_req, res) => {
  res.json(await scrapeCRL("arr"));
});

/* ======================================================
   5) HEALTH & ROOT
====================================================== */

app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/", (_req, res) => res.send("Belgium Flight Proxy — OK. Try /api/..."));

/* ======================================================
   START SERVER
====================================================== */

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
  startLGGSignalR(); // démarrage du flux FIDS LGG
});
