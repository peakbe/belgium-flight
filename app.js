// Coordonnées ARP
const AIRPORTS = {
  CRL: { name: "CRL", icao: "EBCI", lat: 50.4592, lon: 4.45382 },
  LGG: { name: "LGG", icao: "EBLG", lat: 50.6374, lon: 5.44322 }
};

// Open-Meteo (sans clé, CORS OK)
async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,visibility&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Open-Meteo: échec du chargement");
  const data = await res.json();
  return {
    tempC: data.current?.temperature_2m,
    windKmh: data.current?.wind_speed_10m,
    windDir: data.current?.wind_direction_10m,
    visibility_m: data.current?.visibility
  };
}

function setWeatherUI(prefix, weather) {
  const tempEl = document.getElementById(`temp-${prefix}`);
  const windEl = document.getElementById(`wind-${prefix}`);
  const visEl  = document.getElementById(`vis-${prefix}`);
  const needle = document.getElementById(`compass-needle-${prefix}`);
  const rwEl   = document.getElementById(`runway-${prefix}`);
  if (tempEl) tempEl.textContent = weather.tempC != null ? `${Math.round(weather.tempC)} °C` : "—";
  if (windEl) windEl.textContent = weather.windKmh != null ? `${Math.round(weather.windKmh)} km/h (${Math.round(weather.windDir)}°)` : "—";
  if (visEl)  visEl.textContent  = weather.visibility_m != null ? `${Math.round(weather.visibility_m/1000)} km` : "—";
  if (needle && weather.windDir != null) needle.style.transform = `translate(-50%, -50%) rotate(${weather.windDir}deg)`;
  const airport = prefix === 'crl' ? 'CRL' : 'LGG';
  const runway = window.computeActiveRunway(airport, weather.windDir, weather.windKmh);
  if (rwEl) rwEl.textContent = runway;
}

// Proxy (BASE_URL)
const BASE_URL = (window.FLIGHT_PROXY_BASE || 'http://localhost:8787');

async function fetchFlightsCRL() {
  const [dep, arr] = await Promise.all([
    fetch(`${BASE_URL}/api/crl/departures`).then(r=>r.json()).catch(()=>[]),
    fetch(`${BASE_URL}/api/crl/arrivals`).then(r=>r.json()).catch(()=>[])
  ]);
  populateFlights('crl', 'dep', dep);
  populateFlights('crl', 'arr', arr);
}

async function fetchFlightsLGG() {
  const [dep, arr] = await Promise.all([
    fetch(`${BASE_URL}/api/lgg/departures`).then(r=>r.json()).catch(()=>[]),
    fetch(`${BASE_URL}/api/lgg/arrivals`).then(r=>r.json()).catch(()=>[])
  ]);
  populateFlights('lgg', 'dep', dep);
  populateFlights('lgg', 'arr', arr);
}

function populateFlights(prefix, type, rows) {
  const table = document.querySelector(`#${type}-${prefix} tbody`);
  if (!table) return;
  table.innerHTML = '';
  if (!rows || !rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td'); td.colSpan = 4; td.textContent = 'Pas de données — proxy indisponible';
    tr.appendChild(td); table.appendChild(tr);
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.time}</td><td>${r.flight}</td><td>${r.city}</td><td><span class="status ${r.statusClass}">${r.status}</span></td>`;
    table.appendChild(tr);
  });
}

// Carte + filtres sonomètres
function deriveCommune(address) { if (!address) return ''; const parts = address.split(',').map(s=>s.trim()); return parts[parts.length-1] || ''; }

async function initMapWithFilters() {
  const map = L.map('map').setView([50.58, 5.35], 10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const res = await fetch('sonometers.json');
  const all = await res.json();

  let crlGroup = L.layerGroup();
  let lggGroup = L.layerGroup();
  const iconCRL = L.divIcon({html: '<div style="width:12px;height:12px;border-radius:50%;background:#28a9e2;border:2px solid #0b0f17"></div>', className: ''});
  const iconLGG = L.divIcon({html: '<div style="width:12px;height:12px;border-radius:50%;background:#9ae6b4;border:2px solid #0b0f17"></div>', className: ''});

  function render(points) {
    crlGroup.clearLayers(); lggGroup.clearLayers();
    points.forEach(s => {
      const icon = s.airport === 'EBCI' ? iconCRL : iconLGG;
      const m = L.marker([s.lat, s.lng], { icon }).bindPopup(`<strong>${s.id}</strong><br>${s.address}<br><small>${s.airport}</small>`);
      (s.airport === 'EBCI' ? crlGroup : lggGroup).addLayer(m);
    });
  }

  render(all);
  const overlays = { 'Sonomètres CRL': crlGroup, 'Sonomètres LGG': lggGroup };
  L.control.layers(null, overlays, { collapsed: false }).addTo(map);
  crlGroup.addTo(map); lggGroup.addTo(map);

  const communes = Array.from(new Set(all.map(s=>deriveCommune(s.address)).filter(Boolean))).sort();
  const sel = document.getElementById('filter-commune');
  communes.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.textContent = c; sel.appendChild(opt); });

  document.getElementById('filter-apply').addEventListener('click', ()=>{
    const idf = document.getElementById('filter-id').value.trim().toUpperCase();
    const cf  = sel.value.trim();
    const filtered = all.filter(s => {
      const okId = !idf || s.id.toUpperCase().includes(idf);
      const okC  = !cf || deriveCommune(s.address) === cf;
      return okId && okC;
    });
    render(filtered);
  });
}

async function main() {
  try { const wCRL = await fetchWeather(AIRPORTS.CRL.lat, AIRPORTS.CRL.lon); setWeatherUI('crl', wCRL); } catch (e) { console.error(e); }
  try { const wLGG = await fetchWeather(AIRPORTS.LGG.lat, AIRPORTS.LGG.lon); setWeatherUI('lgg', wLGG); } catch (e) { console.error(e); }
  await initMapWithFilters();
  await fetchFlightsCRL();
  await fetchFlightsLGG();
}
main();
