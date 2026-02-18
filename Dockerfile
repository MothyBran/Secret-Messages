FROM node:18-bullseye-slim

# WICHTIG: Installation von Tor und Python (für evtl. Build-Tools)
RUN apt-get update && apt-get install -y \
    tor \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Arbeitsverzeichnis setzen
WORKDIR /app

# Abhängigkeiten installieren
COPY package*.json ./
RUN npm install

# Restlichen Code kopieren
COPY . .

# Start-Befehl (Node übernimmt die Steuerung von Tor via torManager)
CMD ["node", "server.js"]
