// Prototype app.js
// IMPORTANT: Remplacez OPENWEATHER_API_KEY par votre clé OpenWeatherMap si vous voulez des données réelles.
// Remplacez FLIGHT_DATA_FETCH logic pour pointer vers votre API (OpenSky, AviationStack, etc).
// Si aucune clé fournie, script utilisera des données mock pour le développement.

const CONFIG = {
  OPENWEATHER_API_KEY: '8a41cb0d85efd423c82acc9eb5f7d62d', // <-- mettre votre clé ici
  // Exemple: fetch flights from a custom endpoint that returns {arrivals:[], departures:[]}
  FLIGHT_API_ENDPOINT: '035d39b3-ef7f-43de-b226-8e249b319516', // <-- mettre votre endpoint (optionnel)
  AUTO_REFRESH_SEC: 60
};

// Coordonnées des aéroports
const AIRPORTS = {
  CRL: { name: "Charleroi (CRL)", iata: "CRL", lat: 50.4594, lon: 4.4533,
         // Pistes définies par cap magnétique (approx)
         runways: [{id:"06",hdg:60},{id:"24",hdg:240}]
  },
  LGG: { name: "Liège (LGG)", iata: "LGG", lat: 50.6379, lon: 5.4433,
         runways: [{id:"05",hdg:50},{id:"23",hdg:230}]
  }
};

// Liste des sonomètres fournie (id, airport, adresse, lat, lon)
const SONOMETERS = [
  {id:"F118",airport:"EBCI",addr:"Rue Piconette, Sombreffe",lat:50.505267,lon:4.611181},
  {id:"F109",airport:"EBCI",addr:"Chaussée de Charleroi, Sombreffe",lat:50.490353,lon:4.562389},
  {id:"F108",airport:"EBCI",addr:"Avenue Brunard, Fleurus",lat:50.486658,lon:4.546281},
  {id:"F106",airport:"EBCI",addr:"Rue Beaurin et Jonet, Wangenies",lat:50.479864,lon:4.519572},
  {id:"F119",airport:"EBCI",addr:"Rue René Delhaize, Ransart",lat:50.463214,lon:4.479092},
  {id:"F103",airport:"EBCI",addr:"Rue Docteur Pircard, Jumet",lat:50.452386,lon:4.415744},
  {id:"F102",airport:"EBCI",addr:"Rue du Vigneron, Jumet",lat:50.446036,lon:4.422933},
  {id:"F101",airport:"EBCI",addr:"Rue Bruhaute, Jumet",lat:50.447881,lon:4.415839},
  {id:"F107",airport:"EBCI",addr:"Rue Maximilien Wattelar, Jumet",lat:50.444072,lon:4.411161},
  {id:"F105",airport:"EBCI",addr:"Rue Sous le Bois, Roux",lat:50.447006,lon:4.400517},
  {id:"F104",airport:"EBCI",addr:"Rue du Chiffon Rouge, Roux",lat:50.442339,lon:4.392556},
  {id:"F111",airport:"EBCI",addr:"Rue de la Baille, Courcelles",lat:50.438522,lon:4.351964},
  {id:"F112",airport:"EBCI",addr:"Rue des Liserons, Goutroux",lat:50.424653,lon:4.357708},
  {id:"F117",airport:"EBCI",addr:"Rue du Terril, Forchies",lat:50.4315,lon:4.314919},
  {id:"F110",airport:"EBCI",addr:"Rue Émile Vandervelde, Forchies",lat:50.423569,lon:4.327381},
  {id:"F116",airport:"EBCI",addr:"Rue de l'Enseignement, Fontaine-l'Évêque",lat:50.410633,lon:4.315053},
  {id:"F114",airport:"EBCI",addr:"Rue de la Source, Anderlues",lat:50.409831,lon:4.277167},
  {id:"F017",airport:"EBLG",addr:"Rue de la Pommeraie, Wonck",lat:50.764883,lon:5.630606},
  {id:"F001",airport:"EBLG",addr:"Rue Franquet, Houtain",lat:50.738044,lon:5.608833},
  {id:"F014",airport:"EBLG",addr:"Rue Léon Labaye, Juprelle",lat:50.718894,lon:5.573164},
  {id:"F015",airport:"EBLG",addr:"Rue du Brouck, Juprelle",lat:50.688839,lon:5.526217},
  {id:"F005",airport:"EBLG",addr:"Rue Caquin, Haneffe",lat:50.639331,lon:5.323519},
  {id:"F003",airport:"EBLG",addr:"Rue Fond Méan, Saint-Georges",lat:50.601167,lon:5.3814},
  {id:"F011",airport:"EBLG",addr:"Rue Albert 1er, Saint-Georges",lat:50.601142,lon:5.356006},
  {id:"F008",airport:"EBLG",addr:"Rue Warfusée, Saint-Georges",lat:50.594878,lon:5.35895},
  {id:"F002",airport:"EBLG",addr:"Rue Noiset, Saint-Georges",lat:50.588414,lon:5.370522},
  {id:"F007",airport:"EBLG",addr:"Rue Yernawe, Saint-Georges",lat:50.590756,lon:5.345225},
  {id:"F009",airport:"EBLG",addr:"Bibliothèque Communale, Place Verte, Stockay",lat:50.580831,lon:5.355417},
  {id:"F004",airport:"EBLG",addr:"Vinâve des Stréats, Verlaine",lat:50.605414,lon:5.321406},
  {id:"F010",airport:"EBLG",addr:"Rue Haute Voie, Verlaine",lat:50.599392,lon:5.313492},
  {id:"F013",airport:"EBLG",addr:"Rue Bois Léon, Verlaine",lat:50.586914,lon:5.308678},
  {id:"F016",airport:"EBLG",addr:"Rue de Chapon-Seraing, Verlaine",lat:50.619617,lon:5.295344},
  {id:"F006",airport:"EBLG",addr:"Rue Bolly Chapon, Seraing",lat:50.609594,lon:5.271403},
  {id:"F012",airport:"EBLG",addr:"Rue Barbe d'Or, Aineffe",lat:50.621917,lon:5.254747}
];

// UTIL helpers
function degToRad(d){ return d * Math.PI / 180; }
function normalizeAngle(a){ // 0..360
  let v = a % 360;
  if(v < 0) v += 360;
  return v;
}
function angleDiff(a,b){ // minimal signed diff a-b in degrees (-180..180)
  let d = normalizeAngle(a) - normalizeAngle(b);
  if(d > 180) d -= 360;
  if(d < -180) d += 360;
  return d;
}

// RUNWAY COMPUTATION:
// For each runway heading, compute heading difference with wind direction
// Compute headwind component = windSpeed * cos(diffAngle)
// Choose runway with maximum headwind (largest positive). If both negative, choose the one with smaller tailwind (i.e., highest headwind even if negative).
function selectActiveRunway(runways, windDirDeg, windSpeedKt){
  let best = null;
  runways.forEach(r => {
    const diff = angleDiff(windDirDeg, r.hdg); // negative = wind from left of runway direction
    const diffRad = degToRad(diff);
    const headwind = windSpeedKt * Math.cos(diffRad); // knot
    const crosswind = Math.abs(windSpeedKt * Math.sin(diffRad));
    const score = headwind; // simple scoring preferring headwind
    if(!best || score > best.score) {
      best = {...r, diff, headwind: Math.round(headwind*10)/10, crosswind: Math.round(crosswind*10)/10, score};
    }
  });
  // create readable label (e.g., "06 (headwind 10 kt, crosswind 3 kt)")
  if(best) return best;
  return null;
}

// WEATHER FETCH (OpenWeatherMap)
async function fetchWeatherLatLon(lat, lon){
  if(!CONFIG.OPENWEATHER_API_KEY) {
    // mock data
    return {
      temp: (8 + Math.random()*10).toFixed(1),
      visibility: 10000,
      wind_speed: Math.round(5 + Math.random()*12),
      wind_deg: Math.round(Math.random()*360)
    };
  }
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${CONFIG.OPENWEATHER_API_KEY}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('OpenWeather error');
  const j = await res.json();
  return {
    temp: j.main.temp,
    visibility: j.visibility,
    wind_speed: j.wind.speed * 1.94384, // m/s -> kt
    wind_deg: j.wind.deg
  };
}

// FLIGHT DATA FETCH (mock or via FLIGHT_API_ENDPOINT)
// The expected returned object for each airport: {arrivals: [{time,flight,fromTo,status,airline}], departures: [...]}
async function fetchFlightsFor(airportIATA, mode){
  // If user has a real FLIGHT_API_ENDPOINT, call it with ?airport=CRL&type=arrivals
  if(CONFIG.FLIGHT_API_ENDPOINT){
    const url = `${CONFIG.FLIGHT_API_ENDPOINT}?airport=${airportIATA}&type=${mode}`;
    try{
      const res = await fetch(url);
      if(res.ok) return await res.json();
    }catch(e){
      console.warn('flight API error',e);
    }
  }
  // fallback mock
  const now = new Date();
  const pad = (n)=> n.toString().padStart(2,'0');
  const sample = (offsetMin, flight, route, status, airline)=>{
    const dt = new Date(now.getTime() + offsetMin*60000);
    return {time:`${pad(dt.getHours())}:${pad(dt.getMinutes())}`, flight, route, status, airline};
  };
  return {
    arrivals: [
      sample( -40, airportIATA+"123", "LHR → "+airportIATA, "À l'heure", "Ryanair"),
      sample( -20, airportIATA+"456", "CDG → "+airportIATA, "Retardé", "TUI Fly"),
      sample( 10, airportIATA+"789", "AMS → "+airportIATA, "Embarquement", "KLM")
    ],
    departures: [
      sample( 20, airportIATA+"321", airportIATA+" → BVA", "À l'heure", "Brussels Airlines"),
      sample( 45, airportIATA+"654", airportIATA+" → ORY", "Retardé", "TUI Fly"),
      sample( 90, airportIATA+"987", airportIATA+" → MAD", "Embarquement", "Iberia")
    ]
  };
}

// UI Updating
async function updateAirportUI(code){
  const airport = AIRPORTS[code];
  // weather
  try{
    const w = await fetchWeatherLatLon(airport.lat, airport.lon);
    const windKt = +(w.wind_speed || 0);
    const wd = normalizeAngle(+w.wind_deg || 0);
    // update weather boxes
    document.getElementById(`${code.toLowerCase()}-weather`).textContent = `${w.temp}°C · vis ${Math.round((w.visibility||10000)/1000)} km`;
    document.getElementById(`${code.toLowerCase()}-wind-info`).textContent = `${windKt.toFixed(0)} kt · ${wd}°`;
    // rotate compass needle
    const compass = document.querySelector(`.compass[data-airport="${code}"] .compass-needle`);
    if(compass) compass.style.transform = `rotate(${wd}deg)`;

    // compute runway
    const best = selectActiveRunway(airport.runways, wd, windKt);
    if(best){
      const node = document.getElementById(`${code.toLowerCase()}-runway`);
      node.innerHTML = `Piste active estimée: <strong>${best.id}</strong> · headwind ${best.headwind} kt · crosswind ${best.crosswind} kt`;
    }
  }catch(err){
    console.warn(err);
  }

  // flights
  const mode = document.querySelector(`input[name="${code.toLowerCase()}-mode"]:checked`)?.value || 'arrivals';
  const flightsData = await fetchFlightsFor(code, mode);
  const list = flightsData[mode] || [];
  const tbody = document.querySelector(`#${code.toLowerCase()}-table tbody`);
  tbody.innerHTML = '';
  if(list.length === 0){
    tbody.innerHTML = `<tr><td colspan="5">Aucun vol trouvé</td></tr>`;
  } else {
    list.forEach(f => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${f.time}</td><td>${f.flight}</td><td>${f.route}</td>
        <td class="${statusClass(f.status)}">${f.status}</td><td>${f.airline || ''}</td>`;
      tbody.appendChild(tr);
    });
  }
}

function statusClass(status){
  if(!status) return '';
  const s = status.toLowerCase();
  if(s.includes('retard')) return 'status-delayed';
  if(s.includes('embar')) return 'status-boarding';
  return 'status-on-time';
}

// MAP: Leaflet with dark tiles (CartoDB Dark)
function initMap(){
  const map = L.map('map', {zoomControl:true}).setView([50.5, 5.0], 9);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB',
    maxZoom: 19
  }).addTo(map);

  SONOMETERS.forEach(s=>{
    const m = L.circleMarker([s.lat,s.lon], {radius:7, color:'#00c2ff', fillColor:'#00c2ff', fillOpacity:0.9})
      .addTo(map)
      .bindPopup(`<strong>${s.id}</strong><br>${s.addr}<br>${s.airport}<br>${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}`);
  });

  // add airport markers
  for(const c of Object.keys(AIRPORTS)){
    const a = AIRPORTS[c];
    L.marker([a.lat,a.lon], {title:a.name}).addTo(map).bindPopup(`<strong>${c}</strong><br>${a.name}`);
  }

  return map;
}

// Bind UI interactions
function bindUI(){
  document.getElementById('refreshBtn').addEventListener('click', refreshAll);
  document.getElementById('autoRefresh').addEventListener('change', e=>{
    if(e.target.checked) startAutoRefresh();
    else stopAutoRefresh();
  });

  // flight mode toggles
  document.querySelectorAll('input[name="crl-mode"]').forEach(r=>{
    r.addEventListener('change', ()=> updateAirportUI('CRL'));
  });
  document.querySelectorAll('input[name="lgg-mode"]').forEach(r=>{
    r.addEventListener('change', ()=> updateAirportUI('LGG'));
  });
}

let autoTimer = null;
function startAutoRefresh(){
  stopAutoRefresh();
  autoTimer = setInterval(refreshAll, CONFIG.AUTO_REFRESH_SEC * 1000);
}
function stopAutoRefresh(){ if(autoTimer) clearInterval(autoTimer); autoTimer = null; }

async function refreshAll(){
  await Promise.all([ updateAirportUI('CRL'), updateAirportUI('LGG') ]);
}

// init
document.addEventListener('DOMContentLoaded', async ()=>{
  initMap();
  bindUI();
  await refreshAll();
  if(document.getElementById('autoRefresh').checked) startAutoRefresh();
});
