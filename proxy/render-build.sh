#!/usr/bin/env bash
set -o errexit

# 1) Install deps Node
npm install

# 2) Dossier cache Puppeteer (persistant côté Render)
export PUPPETEER_CACHE_DIR="/opt/render/.cache/puppeteer"
mkdir -p "$PUPPETEER_CACHE_DIR"

# 3) Télécharger Chrome for Testing pour Puppeteer
npx puppeteer browsers install chrome

# 4) (Optionnel) Affiche la liste des navigateurs installés
npx @puppeteer/browsers list || true
