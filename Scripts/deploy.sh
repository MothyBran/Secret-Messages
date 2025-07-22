#!/bin/bash
# scripts/deploy.sh - Production Deployment Script

set -e

echo "🚀 Secret Messages Deployment Script"
echo "======================================"

# Configuration
PROJECT_NAME="secret-messages"
DOCKER_COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"
BACKUP_DIR="/opt/backups/secret-messages"
LOG_FILE="/var/log/secret-messages-deploy.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   error "This script should not be run as root for security reasons"
fi

# Check required commands
check_requirements() {
    log "Checking system requirements..."
    
    commands=("docker" "docker-compose" "git" "curl")
    for cmd in "${commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            error "$cmd is not installed. Please install it first."
        fi
    done
    
    # Check Docker is running
    if ! docker info &> /dev/null; then
        error "Docker is not running. Please start Docker first."
    fi
    
    log "✅ All requirements satisfied"
}

# Load environment variables
load_environment() {
    if [[ ! -f "$ENV_FILE" ]]; then
        error "Environment file $ENV_FILE not found. Please create it first."
    fi
    
    source "$ENV_FILE"
    
    # Check required environment variables
    required_vars=("JWT_SECRET" "ADMIN_PASSWORD" "DB_PASSWORD" "DOMAIN")
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            error "Required environment variable $var is not set"
        fi
    done
    
    log "✅ Environment variables loaded"
}

# Create backup
create_backup() {
    log "Creating backup..."
    
    # Create backup directory
    sudo mkdir -p "$BACKUP_DIR"
    
    # Backup database
    BACKUP_FILE="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).sql"
    
    if docker-compose ps postgres | grep -q "Up"; then
        docker-compose exec -T postgres pg_dump -U secretmessages secretmessages > "$BACKUP_FILE"
        log "✅ Database backup created: $BACKUP_FILE"
    else
        warning "Database not running, skipping backup"
    fi
    
    # Backup application data
    if [[ -d "./data" ]]; then
        tar -czf "$BACKUP_DIR/app-data-$(date +%Y%m%d-%H%M%S).tar.gz" ./data
        log "✅ Application data backup created"
    fi
}

# Deploy application
deploy() {
    log "Starting deployment..."
    
    # Pull latest images
    log "Pulling latest Docker images..."
    docker-compose pull
    
    # Build application image
    log "Building application image..."
    docker-compose build --no-cache secret-messages-app
    
    # Stop old containers gracefully
    log "Stopping old containers..."
    docker-compose down --timeout 30
    
    # Start new containers
    log "Starting new containers..."
    docker-compose up -d
    
    # Wait for services to be ready
    log "Waiting for services to start..."
    sleep 30
    
    # Health check
    if ! curl -f http://localhost:3000/api/health &> /dev/null; then
        error "Health check failed. Deployment unsuccessful."
    fi
    
    log "✅ Deployment completed successfully"
}

# SSL Certificate setup
setup_ssl() {
    if [[ -n "$DOMAIN" ]]; then
        log "Setting up SSL certificate for $DOMAIN..."
        
        # Run certbot
        docker-compose --profile ssl run --rm certbot
        
        # Reload nginx
        docker-compose exec nginx nginx -s reload
        
        log "✅ SSL certificate configured"
    else
        warning "No domain configured, skipping SSL setup"
    fi
}

# Cleanup old images and containers
cleanup() {
    log "Cleaning up old Docker images..."
    
    # Remove old images
    docker image prune -f
    
    # Remove old containers
    docker container prune -f
    
    # Remove old volumes (be careful!)
    # docker volume prune -f
    
    log "✅ Cleanup completed"
}

# Health monitoring
setup_monitoring() {
    log "Setting up monitoring..."
    
    # Start monitoring stack
    docker-compose --profile monitoring up -d
    
    # Wait for services
    sleep 15
    
    # Check if Grafana is accessible
    if curl -f http://localhost:3001 &> /dev/null; then
        log "✅ Monitoring stack deployed successfully"
        log "📊 Grafana: http://localhost:3001 (admin/admin)"
        log "📈 Prometheus: http://localhost:9090"
    else
        warning "Monitoring stack might not be fully ready yet"
    fi
}

# Update system
update_system() {
    log "Updating system packages..."
    
    # Update package list
    sudo apt update
    
    # Upgrade packages
    sudo apt upgrade -y
    
    # Install security updates
    sudo unattended-upgrades
    
    log "✅ System updated"
}

# Main deployment function
main() {
    log "Starting Secret Messages deployment process..."
    
    # Parse command line arguments
    case "${1:-deploy}" in
        "full")
            update_system
            check_requirements
            load_environment
            create_backup
            deploy
            setup_ssl
            setup_monitoring
            cleanup
            ;;
        "deploy")
            check_requirements
            load_environment
            create_backup
            deploy
            cleanup
            ;;
        "backup")
            load_environment
            create_backup
            ;;
        "ssl")
            load_environment
            setup_ssl
            ;;
        "monitoring")
            load_environment
            setup_monitoring
            ;;
        "cleanup")
            cleanup
            ;;
        "health")
            health_check
            ;;
        *)
            echo "Usage: $0 {full|deploy|backup|ssl|monitoring|cleanup|health}"
            echo ""
            echo "Commands:"
            echo "  full       - Complete deployment with system update"
            echo "  deploy     - Deploy application only"
            echo "  backup     - Create backup only"
            echo "  ssl        - Setup SSL certificates"
            echo "  monitoring - Deploy monitoring stack"
            echo "  cleanup    - Clean up old Docker resources"
            echo "  health     - Run health checks"
            exit 1
            ;;
    esac
    
    log "🎉 Deployment process completed successfully!"
    log "🌐 Your Secret Messages app should be running at: https://$DOMAIN"
}

# Health check function
health_check() {
    log "Running health checks..."
    
    # Check main application
    if curl -f http://localhost:3000/api/health &> /dev/null; then
        log "✅ Main application: OK"
    else
        error "❌ Main application: FAILED"
    fi
    
    # Check database
    if docker-compose exec postgres pg_isready -U secretmessages &> /dev/null; then
        log "✅ Database: OK"
    else
        error "❌ Database: FAILED"
    fi
    
    # Check Redis
    if docker-compose exec redis redis-cli ping &> /dev/null; then
        log "✅ Redis: OK"
    else
        error "❌ Redis: FAILED"
    fi
    
    # Check disk space
    DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
    if [[ $DISK_USAGE -lt 80 ]]; then
        log "✅ Disk space: OK ($DISK_USAGE% used)"
    else
        warning "⚠️ Disk space: HIGH ($DISK_USAGE% used)"
    fi
    
    # Check memory usage
    MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
    if [[ $MEMORY_USAGE -lt 80 ]]; then
        log "✅ Memory usage: OK ($MEMORY_USAGE% used)"
    else
        warning "⚠️ Memory usage: HIGH ($MEMORY_USAGE% used)"
    fi
    
    log "Health check completed"
}

# Run main function
main "$@"

# ==========================================
# scripts/backup.sh - Database Backup Script
# ==========================================

#!/bin/bash
# Automated backup script for Secret Messages

BACKUP_DIR="/backups"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Database backup
echo "Creating database backup..."
pg_dump -h postgres -U secretmessages -d secretmessages > "$BACKUP_DIR/db_backup_$DATE.sql"

# Compress backup
gzip "$BACKUP_DIR/db_backup_$DATE.sql"

# Remove old backups
find "$BACKUP_DIR" -name "db_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: db_backup_$DATE.sql.gz"

# ==========================================
# scripts/restore.sh - Database Restore Script
# ==========================================

#!/bin/bash
# Database restore script

BACKUP_FILE="$1"

if [[ -z "$BACKUP_FILE" ]]; then
    echo "Usage: $0 <backup_file>"
    echo "Available backups:"
    ls -la /backups/db_backup_*.sql.gz
    exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "Restoring database from: $BACKUP_FILE"

# Extract if compressed
if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | psql -h postgres -U secretmessages -d secretmessages
else
    psql -h postgres -U secretmessages -d secretmessages < "$BACKUP_FILE"
fi

echo "Database restore completed"

# ==========================================
# scripts/generate-keys.js - Key Generation Script
# ==========================================

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

function generateLicenseKey() {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        const part = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
        parts.push(part);
    }
    return parts.join('-');
}

function hashKey(key) {
    return bcrypt.hashSync(key, 10);
}

// Command line arguments
const quantity = parseInt(process.argv[2]) || 10;
const expiryDays = parseInt(process.argv[3]) || null;

console.log(`Generating ${quantity} license keys...`);

const db = new sqlite3.Database('./secret_messages.db');

const expiresAt = expiryDays ? 
    new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000) : null;

for (let i = 0; i < quantity; i++) {
    const keyCode = generateLicenseKey();
    const keyHash = hashKey(keyCode);
    
    db.run(
        `INSERT INTO license_keys (key_code, key_hash, expires_at) VALUES (?, ?, ?)`,
        [keyCode, keyHash, expiresAt],
        function(err) {
            if (err) {
                console.error(`Error generating key ${i + 1}:`, err);
            } else {
                console.log(`✅ Generated key ${i + 1}: ${keyCode}`);
            }
            
            if (i === quantity - 1) {
                db.close();
                console.log(`\n🎉 Generated ${quantity} keys successfully!`);
            }
        }
    );
}

# ==========================================
# scripts/healthcheck.js - Application Health Check
# ==========================================

const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/health',
    method: 'GET',
    timeout: 5000
};

const req = http.request(options, (res) => {
    if (res.statusCode === 200) {
        console.log('Health check passed');
        process.exit(0);
    } else {
        console.log(`Health check failed with status: ${res.statusCode}`);
        process.exit(1);
    }
});

req.on('error', (err) => {
    console.log(`Health check failed: ${err.message}`);
    process.exit(1);
});

req.on('timeout', () => {
    console.log('Health check timed out');
    req.destroy();
    process.exit(1);
});

req.end();
