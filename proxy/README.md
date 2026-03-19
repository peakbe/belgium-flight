# Flight Proxy (Node/Express)

Proxy léger pour alimenter les tableaux de vols **CRL (EBCI)** et **LGG (EBLG)** via les pages officielles.

## Endpoints
- `GET /api/crl/departures`
- `GET /api/crl/arrivals`
- `GET /api/lgg/departures`
- `GET /api/lgg/arrivals`

## Local
```bash
cd proxy
cp .env.example .env
npm install
npm run dev  # http://localhost:8787
