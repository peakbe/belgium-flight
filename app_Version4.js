// app.js — version client avec intégration AviationStack (Option A)
// ⚠️ AVERTISSEMENT : insérer la clé AviationStack ici expose la clé côté client.
// Remplacez 'f906d7a42011f1752112a2e10a1d827e' par votre clé réelle si vous confirmez.

const CONFIG = {
  OPENWEATHER_API_KEY: 'bf20dabc492d72da5919202eceaec43b',
  FLIGHT_API_ENDPOINT: '',
  AUTO_REFRESH_SEC: 60
};

// AviationStack clé (côté client — exposée)
const AVIATIONSTACK_KEY = 'f906d7a42011f1752112a2e10a1d827e';

// OpenSky credentials loader (optional, from /credentials.json)
let OPEN_SKY_CREDENTIALS = null;

// ... (AIRPORTS, SONOMETERS, utilitaires identiques à la version précédente) ...

// Exemple de fonction pour appeler AviationStack et mapper vers notre format UI
async function fetchFlightsFromAviationStack(airportIATA, mode){
  if(!AVIATIONSTACK_KEY || AVIATIONSTACK_KEY === 'f906d7a42011f1752112a2e10a1d827e') return null;
  try{
    const params = new URLSearchParams({ access_key: AVIATIONSTACK_KEY, limit: 100 });
    if(mode === 'arrivals') params.set('arr_iata', airportIATA);
    else params.set('dep_iata', airportIATA);
    // optionally: params.set('flight_status','active'); etc.
    const url = `http://api.aviationstack.com/v1/flights?${params.toString()}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('AviationStack error ' + res.status);
    const j = await res.json();
    const items = (j.data || []).map(f => {
      const timeRaw = (mode === 'arrivals') ? (f.arrival?.scheduled || f.departure?.scheduled) : (f.departure?.scheduled || f.arrival?.scheduled);
      const d = timeRaw ? new Date(timeRaw) : new Date();
      const timestr = d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      const flight = f.flight?.iata || f.flight?.icao || (f.flight?.number || '');
      const route = (mode==='arrivals') ? `${f.departure?.iata || '??'} → ${airportIATA}` : `${airportIATA} → ${f.arrival?.iata || '??'}`;
      const status = f.flight_status ? capitalizeStatus(f.flight_status) : 'Prévu';
      const airline = f.airline?.name || '';
      return { time: timestr, flight, route, status, airline };
    });
    if(mode === 'arrivals') return { arrivals: items, departures: [] };
    return { arrivals: [], departures: items };
  } catch(err){
    console.warn('AviationStack fetch failed', err);
    return null;
  }
}

function capitalizeStatus(s){
  if(!s) return s;
  return s.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

// fetchFlightsFor orchestration : AviationStack -> OpenSky -> mock
async function fetchFlightsFor(airportIATA, mode){
  // 1) Try AviationStack (client key)
  const fromAviation = await fetchFlightsFromAviationStack(airportIATA, mode);
  if(fromAviation) return fromAviation;

  // 2) Try proxy endpoint if configured
  if(CONFIG.FLIGHT_API_ENDPOINT){
    try{
      const url = `${CONFIG.FLIGHT_API_ENDPOINT}?airport=${airportIATA}&type=${mode}`;
      const res = await fetch(url);
      if(res.ok) return await res.json();
    }catch(e){
      console.warn('flight API proxy error',e);
    }
  }

  // 3) Try OpenSky using credentials.json (may fail due to CORS)
  if(OPEN_SKY_CREDENTIALS && OPEN_SKY_CREDENTIALS.clientId && OPEN_SKY_CREDENTIALS.clientSecret){
    try{
      const airport = Object.values(AIRPORTS).find(a => a.iata === airportIATA);
      const icao = airport?.icao || airportIATA;
      const now = Math.floor(Date.now()/1000);
      const begin = now - 6*3600;
      const end = now + 6*3600;
      const endpoint = mode === 'arrivals' ? 'arrival' : 'departure';
      const url = `https://opensky-network.org/api/flights/${endpoint}?airport=${icao}&begin=${begin}&end=${end}`;
      const basic = btoa(`${OPEN_SKY_CREDENTIALS.clientId}:${OPEN_SKY_CREDENTIALS.clientSecret}`);
      const res = await fetch(url, { headers: { 'Authorization': `Basic ${basic}` }});
      if(res.ok){
        const arr = await res.json();
        const nowSec = Math.floor(Date.now()/1000);
        const mapped = arr.map(item => {
          const ts = mode === 'arrivals' ? (item.lastSeen || item.firstSeen) : (item.firstSeen || item.lastSeen);
          const d = ts ? new Date(ts*1000) : new Date();
          const timeStr = d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
          const route = mode === 'arrivals' ? `${item.estDepartureAirport || '??'} → ${icao}` : `${icao} → ${item.estArrivalAirport || '??'}`;
          const flight = (item.callsign || '').trim() || '---';
          const diffMin = ts ? Math.round((ts - nowSec)/60) : 999;
          let status = 'Prévu';
          if(diffMin <= -10) status = (mode==='arrivals') ? 'Arrivé' : 'Parti';
          else if(diffMin < 0) status = "À l'heure";
          else if(diffMin <= 30) status = "Embarquement";
          else status = "Prévu";
          return { time: timeStr, flight, route, status, airline: '' };
        });
        if(mode === 'arrivals') return { arrivals: mapped, departures: [] };
        return { arrivals: [], departures: mapped };
      }
    }catch(err){
      console.warn('OpenSky fetch error', err);
    }
  }

  // 4) Fallback mock
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

// ... reste du fichier (UI, map, bindings) inchangé ...