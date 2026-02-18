# Wir nutzen Bookworm (Debian 12) für stabilere Repos
FROM node:18-bookworm-slim

# Arbeitsverzeichnis setzen
WORKDIR /app

# Abhängigkeiten installieren (Mit --fix-missing gegen Netzwerkfehler)
RUN apt-get update && apt-get install -y --fix-missing \
    tor \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Node Dependencies
COPY package*.json ./
RUN npm install

# App Code
COPY . .

# Start
CMD ["node", "server.js"]
