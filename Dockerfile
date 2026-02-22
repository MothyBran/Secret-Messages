# Wir nutzen Bookworm (Debian 12) für stabilere Repos
FROM node:18-bookworm-slim

# Arbeitsverzeichnis setzen
WORKDIR /app

# Install prerequisites for adding Tor Project repository
# Then install Tor from the official source to get the latest version (avoids compression bomb issues with old versions)
RUN apt-get update && apt-get install -y --fix-missing \
    wget \
    gpg \
    apt-transport-https \
    ca-certificates \
    python3 \
    build-essential \
    && mkdir -p /etc/apt/keyrings \
    && wget -qO- https://deb.torproject.org/torproject.org/A3C4F0F979CAA22CDBA8F512EE8CBC9E886DDD89.asc | gpg --dearmor | tee /usr/share/keyrings/tor-archive-keyring.gpg >/dev/null \
    && echo "deb [signed-by=/usr/share/keyrings/tor-archive-keyring.gpg] https://deb.torproject.org/torproject.org bookworm main" > /etc/apt/sources.list.d/tor.list \
    && apt-get update \
    && apt-get install -y --fix-missing tor deb.torproject.org-keyring \
    && rm -rf /var/lib/apt/lists/*

# Node Dependencies
COPY package*.json ./
RUN npm install

# App Code
COPY . .

# Start
CMD ["node", "server.js"]
