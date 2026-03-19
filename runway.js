// Calcul piste active (face au vent) + préférence L/R LGG
// CRL (EBCI): 06 ≈ 062°, 24 ≈ 242° ; LGG (EBLG): 04 ≈ 042°, 22 ≈ 222°
const RUNWAYS = {
  CRL: [{ name: "06", heading: 62 }, { name: "24", heading: 242 }],
  LGG: [{ name: "04L", heading: 42 }, { name: "04R", heading: 42 }, { name: "22L", heading: 222 }, { name: "22R", heading: 222 }]
};

function normalizeDeg(d) { return (d % 360 + 360) % 360; }
function angleDiff(a, b) { const diff = Math.abs(normalizeDeg(a) - normalizeDeg(b)); return diff > 180 ? 360 - diff : diff; }

function computeActiveRunway(airportCode, windDirDeg, windSpeedKmh) {
  const knots = windSpeedKmh / 1.852;
  const runways = RUNWAYS[airportCode];
  if (!runways || windDirDeg == null) return "N/A";
  if (knots < 5) return runways.map(r => r.name).join(" / "); // vent faible : laisser la paire
  let best = null, bestDiff = 1e9;
  for (const r of runways) {
    const diff = angleDiff(r.heading, windDirDeg);
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }
  return best ? best.name : "N/A";
}
window.computeActiveRunway = computeActiveRunway;

// --- Préférence L/R pour LGG ---
// LGG a deux paires : 04L/22R (≈2340 m) et 04R/22L (≈3690 m).
// Par défaut, on privilégie la piste la plus longue (cargo) -> 04R / 22L.
const LGG_PREF = { mode: 'cargo' }; // 'cargo' ou 'mixed'

function chooseLRForLGG(baseRunwayName) {
  const longFor  = { '04': '04R', '22': '22L' };
  const shortFor = { '04': '04L', '22': '22R' };
  return LGG_PREF.mode === 'cargo' ? longFor[baseRunwayName] : shortFor[baseRunwayName];
}

// Surcharge pour LGG : si computeActiveRunway renvoie un sens brut '04'/'22', on applique L/R
const _origCompute = window.computeActiveRunway;
window.computeActiveRunway = function(airportCode, windDirDeg, windSpeedKmh) {
  const res = _origCompute(airportCode, windDirDeg, windSpeedKmh);
  if (airportCode === 'LGG') {
    if (res === 'N/A') return res;
    if (res.includes('/')) return res; // vent faible : garder la paire
    if (res === '04' || res === '22') return chooseLRForLGG(res);
  }
  return res;
};
