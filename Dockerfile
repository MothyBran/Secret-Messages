# Dockerfile for Secret Messages Backend
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    sqlite \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production && npm cache clean --force

# Create app user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S secretmessages -u 1001

# Create necessary directories
RUN mkdir -p /app/logs /app/backups /app/public && \
    chown -R secretmessages:nodejs /app

# Copy application code
COPY --chown=secretmessages:nodejs . .

# Remove development files
RUN rm -rf tests/ .git/ .env.example

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node healthcheck.js || exit 1

# Expose port
EXPOSE 3000

# Switch to non-root user
USER secretmessages

# Start the application
CMD ["npm", "start"]

# Multi-stage build for development
FROM node:18-alpine as development

WORKDIR /app

# Install all dependencies (including dev)
COPY package*.json ./
RUN npm install

# Copy all source code
COPY . .

# Expose port and start dev server
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Production optimized build
FROM node:18-alpine as production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force && \
    rm -rf /tmp/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S secretmessages -u 1001

# Create directories and set permissions
RUN mkdir -p logs backups public uploads && \
    chown -R secretmessages:nodejs /app

# Copy application files
COPY --chown=secretmessages:nodejs server.js ./
COPY --chown=secretmessages:nodejs . .
COPY --chown=secretmessages:nodejs public/ ./public/
COPY --chown=secretmessages:nodejs payment.js ./
COPY --chown=secretmessages:nodejs healthcheck.js ./

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node healthcheck.js || exit 1

USER secretmessages

EXPOSE 3000

CMD ["node", "server.js"]
