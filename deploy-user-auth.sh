#!/bin/bash

# deploy-user-auth.sh - Deployment-Skript für Benutzer-Authentifizierung
# Dieses Skript hilft beim Deployment der neuen Benutzer-basierten Authentifizierung

echo "🚀 Secret Messages - Benutzer-Authentifizierung Deployment"
echo "========================================================="

# Farben für Output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Funktion für Erfolgsmeldungen
success() {
    echo -e "${GREEN}✅ $1${NC}"
}

# Funktion für Fehlermeldungen
error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

# Funktion für Warnungen
warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# 1. Prüfe ob wir im richtigen Verzeichnis sind
if [ ! -f "server.js" ] || [ ! -d "public" ]; then
    error "Bitte führen Sie dieses Skript im Hauptverzeichnis des Projekts aus!"
fi

echo ""
echo "📋 Schritt 1: Backup erstellen"
echo "------------------------------"

# Backup-Verzeichnis erstellen
mkdir -p backups/$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"

# Wichtige Dateien sichern
if [ -f "server.js" ]; then
    cp server.js "$BACKUP_DIR/"
    success "server.js gesichert"
fi

if [ -f "public/index.html" ]; then
    cp public/index.html "$BACKUP_DIR/"
    success "public/index.html gesichert"
fi

if [ -f "public/Frontend.html" ]; then
    cp public/Frontend.html "$BACKUP_DIR/"
    success "public/Frontend.html gesichert"
fi

if [ -f "package.json" ]; then
    cp package.json "$BACKUP_DIR/"
    success "package.json gesichert"
fi

echo ""
echo "📋 Schritt 2: Dateien prüfen"
echo "----------------------------"

# Prüfe ob neue Dateien vorhanden sind
NEW_FILES=(
    "server.js"
    "package.json"
    "public/index.html"
    "public/app.js"
    "public/admin.html"
    "migrate-to-user-auth.js"
)

MISSING_FILES=()

for file in "${NEW_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        MISSING_FILES+=("$file")
    fi
done

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    error "Folgende Dateien fehlen: ${MISSING_FILES[*]}"
fi

success "Alle benötigten Dateien gefunden"

echo ""
echo "📋 Schritt 3: Verzeichnisstruktur erstellen"
echo "------------------------------------------"

# Erstelle benötigte Verzeichnisse
mkdir -p database/migrations
success "Verzeichnisstruktur erstellt"

echo ""
echo "📋 Schritt 4: Deployment-Bereitschaft"
echo "------------------------------------"

# Zeige Zusammenfassung
echo ""
echo "🎯 Deployment-Zusammenfassung:"
echo "==============================="
echo ""
echo "✅ Folgende Änderungen werden durchgeführt:"
echo "   - Benutzer-basierte Authentifizierung (statt Gerätebindung)"
echo "   - Login mit Benutzername + 5-stelligem Code"
echo "   - License-Key Aktivierung mit Benutzer-Registrierung"
echo "   - Account-Löschung möglich"
echo "   - Matrix/Hacker-Design"
echo ""
echo "📁 Neue/Geänderte Dateien:"
echo "   - server.js (erweiterte Auth-Endpoints)"
echo "   - package.json (mit pg für PostgreSQL)"
echo "   - public/index.html (neue Login-Seite)"
echo "   - public/app.js (Frontend-Logik)"
echo "   - public/admin.html (CSP-konform)"
echo ""
warning "Nach dem Deployment muss die Migration ausgeführt werden!"
echo ""
echo "🚀 Deployment-Schritte:"
echo "1. Committen Sie alle Änderungen:"
echo "   git add ."
echo "   git commit -m 'feat: Benutzer-basierte Authentifizierung'"
echo ""
echo "2. Pushen Sie zu GitHub:"
echo "   git push origin main"
echo ""
echo "3. Railway deployed automatisch"
echo ""
echo "4. Führen Sie die Migration aus (Railway Console):"
echo "   node migrate-to-user-auth.js"
echo ""
echo "5. Testen Sie die neue Login-Seite"
echo ""

# Zeige Demo-Keys
echo "🔑 Demo License-Keys zum Testen:"
echo "================================="
echo "SM001-ALPHA-BETA1"
echo "SM002-GAMMA-DELT2"
echo "SM003-ECHO-FOXTR3"
echo ""

success "Deployment-Vorbereitung abgeschlossen!"
echo ""
echo "💡 Tipp: Führen Sie 'git status' aus, um die Änderungen zu sehen."
