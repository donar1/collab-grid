FROM node:20-alpine

# Install wget for healthcheck
RUN apk add --no-cache wget

WORKDIR /app

# Copy dependency manifests first for better cache
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --production

# Copy all source code
COPY . .

# Create non-root user and switch to it
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s CMD wget -qO- http://localhost:3000/health || exit 1

# Start application
CMD ["node", "server.js"]
