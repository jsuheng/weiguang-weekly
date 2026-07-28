FROM docker.1ms.run/library/node:24-alpine

# Set timezone
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone

# Install pnpm and docker-cli
RUN  npm install -g pnpm@10.33.4 && pnpm config set registry https://registry.npmmirror.com

WORKDIR /app




# Copy package files
COPY package*.json ./

# Install dependencies with BuildKit cache mount (including drizzle-kit for migrations)
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install && pnpm add -D drizzle-kit

# Copy source code
COPY . .

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application with migration
CMD ["/usr/local/bin/docker-entrypoint.sh"]
