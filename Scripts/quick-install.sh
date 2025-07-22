#!/bin/bash
# scripts/quick-install.sh - One-Click Installation for Secret Messages Backend

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Banner
show_banner() {
    echo -e "${PURPLE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║               🔐 SECRET MESSAGES BACKEND                     ║"
    echo "║                                                              ║"
    echo "║           Enterprise-Grade Encryption System                 ║"
    echo "║                   Quick Installation                         ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
}

# Logging functions
log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Progress indicator
show_progress() {
    local duration=$1
    local message=$2
    
    echo -ne "${CYAN}$message${NC}"
    for ((i=0; i<duration; i++)); do
        echo -ne "."
        sleep 0.5
    done
    echo -e " ${GREEN}✓${NC}"
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root for security reasons!"
    fi
}

# Detect OS
detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
    else
        error "Cannot detect operating system"
    fi
    
    log "Detected OS: $OS $OS_VERSION"
}

# Check system requirements
check_requirements() {
    log "Checking system requirements..."
    
    # Check available memory
    local memory_gb=$(free -g | awk '/^Mem:/{print $2}')
    if [[ $memory_gb -lt 2 ]]; then
        warning "Only ${memory_gb}GB RAM available. Minimum 2GB recommended."
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    # Check available disk space
    local disk_gb=$(df / | tail -1 | awk '{print int($4/1024/1024)}')
    if [[ $disk_gb -lt 10 ]]; then
        error "Only ${disk_gb}GB disk space available. Minimum 10GB required."
    fi
    
    log "✅ System requirements check passed"
}

# Install Docker
install_docker() {
    if command -v docker &> /dev/null; then
        log "Docker already installed: $(docker --version)"
        return
    fi
    
    log "Installing Docker..."
    
    case $OS in
        ubuntu|debian)
            # Update package index
            sudo apt-get update -qq
            
            # Install dependencies
            sudo apt-get install -y -qq \
                apt-transport-https \
                ca-certificates \
                curl \
                gnupg \
                lsb-release
            
            # Add Docker's GPG key
            curl -fsSL https://download.docker.com/linux/$OS/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
            
            # Add Docker repository
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/$OS $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
            
            # Install Docker
            sudo apt-get update -qq
            sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
            ;;
        centos|rhel|fedora)
            # Install Docker using yum/dnf
            if command -v dnf &> /dev/null; then
                sudo dnf install -y docker docker-compose
            else
                sudo yum install -y docker docker-compose
            fi
            ;;
        *)
            error "Unsupported operating system: $OS"
            ;;
    esac
    
    # Start Docker service
    sudo systemctl start docker
    sudo systemctl enable docker
    
    # Add current user to docker group
    sudo usermod -aG docker $USER
    
    log "✅ Docker installed successfully"
    warning "You may need to log out and back in for Docker permissions to take effect"
}

# Install Docker Compose (if not available)
install_docker_compose() {
    if command -v docker-compose &> /dev/null; then
        log "Docker Compose already installed: $(docker-compose --version)"
        return
    fi
    
    log "Installing Docker Compose..."
    
    # Download latest version
    local compose_version=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep -Po '"tag_name": "\K.*?(?=")')
    sudo curl -L "https://github.com/docker/compose/releases/download/$compose_version/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    
    # Make executable
    sudo chmod +x /usr/local/bin/docker-compose
    
    log "✅ Docker Compose installed successfully"
}

# Install Node.js and npm
install_nodejs() {
    if command -v node &> /dev/null; then
        log "Node.js already installed: $(node --version)"
        return
    fi
    
    log "Installing Node.js..."
    
    case $OS in
        ubuntu|debian)
            # Install NodeSource repository
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        centos|rhel|fedora)
            # Install NodeSource repository
            curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
            if command -v dnf &> /dev/null; then
                sudo dnf install -y nodejs
            else
                sudo yum install -y nodejs
            fi
            ;;
        *)
            error "Unsupported operating system for Node.js installation"
            ;;
    esac
    
    log "✅ Node.js installed: $(node --version)"
}

# Generate secure secrets
generate_secrets() {
    log "Generating secure secrets..."
    
    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d '\n' | head -c 24)
    DB_PASSWORD=$(openssl rand -base64 32 | tr -d '\n' | head -c 24)
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '\n' | head -c 24)
    
    log "✅ Secure secrets generated"
}

# Configure environment
configure_environment() {
    log "Configuring environment..."
    
    # Get domain from user
    echo -e "\n${CYAN}Domain Configuration${NC}"
    echo "Enter your domain name (or press Enter for localhost):"
    read -p "Domain: " DOMAIN
    
    if [[ -z "$DOMAIN" ]]; then
        DOMAIN="localhost"
        FRONTEND_URL="http://localhost:3000"
        warning "Using localhost - SSL will be disabled"
    else
        FRONTEND_URL="https://$DOMAIN"
        
        echo "Enter your email for SSL certificates:"
        read -p "Email: " SSL_EMAIL
    fi
    
    # Stripe configuration (optional)
    echo -e "\n${CYAN}Payment Configuration (Optional)${NC}"
    echo "Do you want to configure Stripe payments now? (y/N)"
    read -p "Configure Stripe: " -n 1 -r
    echo
    
    STRIPE_SECRET_KEY=""
    STRIPE_WEBHOOK_SECRET=""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Enter your Stripe secret key (starts with sk_):"
        read -p "Stripe Secret Key: " STRIPE_SECRET_KEY
        echo "Enter your Stripe webhook secret (starts with whsec_):"
        read -p "Webhook Secret: " STRIPE_WEBHOOK_SECRET
    fi
    
    # Email configuration (optional)
    echo -e "\n${CYAN}Email Configuration (Optional)${NC}"
    echo "Do you want to configure email notifications now? (y/N)"
    read -p "Configure Email: " -n 1 -r
    echo
    
    SMTP_HOST=""
    SMTP_PORT=""
    SMTP_USER=""
    SMTP_PASS=""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Enter SMTP configuration:"
        read -p "SMTP Host (e.g., smtp.gmail.com): " SMTP_HOST
        read -p "SMTP Port (usually 587): " SMTP_PORT
        read -p "SMTP Username: " SMTP_USER
        read -p "SMTP Password: " -s SMTP_PASS
        echo
    fi
    
    # Create .env file
    cat > .env << EOF
# Secret Messages Backend Configuration
# Generated on $(date)

# Server Configuration
NODE_ENV=production
PORT=3000

# Security
JWT_SECRET=$JWT_SECRET
ADMIN_PASSWORD=$ADMIN_PASSWORD

# Domain & Frontend
DOMAIN=$DOMAIN
FRONTEND_URL=$FRONTEND_URL
SSL_EMAIL=$SSL_EMAIL

# Database
DB_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgresql://secretmessages:$DB_PASSWORD@postgres:5432/secretmessages

# Redis
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379

# Stripe (if configured)
STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET
PAYMENT_SUCCESS_URL=$FRONTEND_URL/payment/success
PAYMENT_CANCEL_URL=$FRONTEND_URL/payment/cancel

# Email (if configured)
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
AUTH_RATE_LIMIT_MAX=5

# Session Configuration
SESSION_DURATION_DAYS=30
CLEANUP_INTERVAL_HOURS=24

# Monitoring
GRAFANA_PASSWORD=$ADMIN_PASSWORD

# Logging
LOG_LEVEL=info

# Security Headers
CORS_ORIGIN=$FRONTEND_URL
TRUST_PROXY=true

# Development Settings
DEBUG=false
EOF
    
    log "✅ Environment configured"
}

# Setup project
setup_project() {
    log "Setting up project structure..."
    
    # Create necessary directories
    mkdir -p logs backups uploads public
    
    # Install npm dependencies
    if [[ -f package.json ]]; then
        log "Installing Node.js dependencies..."
        npm install --production --silent
    fi
    
    # Make scripts executable
    chmod +x scripts/*.sh
    
    log "✅ Project structure created"
}

# Initialize database
init_database() {
    log "Initializing database..."
    
    # Start database container
    docker-compose up -d postgres redis
    
    # Wait for database to be ready
    show_progress 10 "Waiting for database to start"
    
    # Run setup script
    if [[ -f scripts/setup.js ]]; then
        node scripts/setup.js
    fi
    
    log "✅ Database initialized"
}

# Start services
start_services() {
    log "Starting all services..."
    
    # Pull Docker images
    docker-compose pull
    
    # Build application image
    docker-compose build
    
    # Start all services
    docker-compose up -d
    
    # Wait for services to start
    show_progress 20 "Starting all services"
    
    log "✅ All services started"
}

# Setup SSL (if domain provided)
setup_ssl() {
    if [[ "$DOMAIN" != "localhost" && -n "$SSL_EMAIL" ]]; then
        log "Setting up SSL certificate..."
        
        # Create SSL directories
        mkdir -p nginx/ssl nginx/webroot
        
        # Generate certificate
        docker-compose --profile ssl run --rm certbot
        
        # Restart nginx with SSL
        docker-compose restart nginx
        
        log "✅ SSL certificate configured"
    fi
}

# Health check
run_health_check() {
    log "Running health checks..."
    
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -f http://localhost:3000/api/health &> /dev/null; then
            log "✅ Application is healthy"
            return 0
        fi
        
        echo -ne "\rAttempt $attempt/$max_attempts..."
        sleep 2
        ((attempt++))
    done
    
    error "Health check failed after $max_attempts attempts"
}

# Show success message
show_success() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║            🎉 INSTALLATION COMPLETED SUCCESSFULLY!           ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    echo -e "${CYAN}🌐 Application URLs:${NC}"
    echo -e "   Main App:      ${FRONTEND_URL}"
    echo -e "   Admin Panel:   ${FRONTEND_URL}/admin"
    echo -e "   API Health:    ${FRONTEND_URL}/api/health"
    echo ""
    
    if [[ "$DOMAIN" != "localhost" ]]; then
        echo -e "${CYAN}📊 Monitoring (if enabled):${NC}"
        echo -e "   Grafana:       https://${DOMAIN}:3001"
        echo -e "   Prometheus:    https://${DOMAIN}:9090"
        echo ""
    fi
    
    echo -e "${CYAN}🔑 Admin Credentials:${NC}"
    echo -e "   Admin Password: ${ADMIN_PASSWORD}"
    echo ""
    
    echo -e "${CYAN}🔐 Demo License Keys:${NC}"
    echo -e "   SM001-ALPHA-BETA1"
    echo -e "   SM002-GAMMA-DELT2"
    echo -e "   SM003-ECHO-FOXTR3"
    echo ""
    
    echo -e "${YELLOW}⚠️  Important Notes:${NC}"
    echo -e "   • Save your admin password: ${ADMIN_PASSWORD}"
    echo -e "   • Backup your .env file"
    echo -e "   • Configure firewall if needed"
    if [[ "$DOMAIN" != "localhost" ]]; then
        echo -e "   • Point your domain to this server's IP"
    fi
    echo ""
    
    echo -e "${CYAN}📖 Next Steps:${NC}"
    echo -e "   1. Test the application at ${FRONTEND_URL}"
    echo -e "   2. Access admin panel to generate more keys"
    echo -e "   3. Configure Stripe for payments (if needed)"
    echo -e "   4. Set up monitoring dashboards"
    echo -e "   5. Configure backups: ./scripts/deploy.sh backup"
    echo ""
    
    echo -e "${GREEN}🚀 Your Secret Messages Backend is ready!${NC}"
    echo ""
}

# Cleanup on error
cleanup() {
    if [[ $? -ne 0 ]]; then
        error "Installation failed! Check the logs above for details."
        echo "You can try running the installation again or install manually."
    fi
}

# Main installation function
main() {
    trap cleanup EXIT
    
    show_banner
    
    log "Starting Secret Messages Backend installation..."
    
    check_root
    detect_os
    check_requirements
    
    install_docker
    install_docker_compose
    install_nodejs
    
    generate_secrets
    configure_environment
    setup_project
    
    init_database
    start_services
    setup_ssl
    
    run_health_check
    show_success
    
    trap - EXIT
}

# Handle command line arguments
case "${1:-install}" in
    "install")
        main
        ;;
    "uninstall")
        log "Uninstalling Secret Messages Backend..."
        docker-compose down -v --remove-orphans
        docker system prune -f
        log "✅ Uninstalled successfully"
        ;;
    "update")
        log "Updating Secret Messages Backend..."
        git pull origin main
        docker-compose pull
        docker-compose up -d --build
        log "✅ Updated successfully"
        ;;
    "reset")
        log "Resetting Secret Messages Backend..."
        docker-compose down -v
        docker-compose up -d
        node scripts/setup.js
        log "✅ Reset completed"
        ;;
    "status")
        echo "Service Status:"
        docker-compose ps
        echo ""
        echo "Health Check:"
        curl -f http://localhost:3000/api/health || echo "❌ Health check failed"
        ;;
    "logs")
        docker-compose logs -f --tail=50 secret-messages-app
        ;;
    *)
        echo "Usage: $0 {install|uninstall|update|reset|status|logs}"
        echo ""
        echo "Commands:"
        echo "  install    - Install Secret Messages Backend"
        echo "  uninstall  - Remove all containers and data"
        echo "  update     - Update to latest version"
        echo "  reset      - Reset database and containers"
        echo "  status     - Show service status"
        echo "  logs       - Show application logs"
        exit 1
        ;;
esac
