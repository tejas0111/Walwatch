FROM node:20-alpine AS builder
WORKDIR /app

# Copy keeper package files
COPY keeper/package*.json ./
COPY keeper/tsconfig.json ./
RUN npm ci

# Copy keeper source
COPY keeper/src/ ./src/

# Copy shared API libraries (referenced via ../../api/src/lib/*)
# The TypeScript compiler resolves ../../api/src/lib/ from keeper/src/ → /app/api/src/lib/
COPY api/src/lib/ ./api/src/lib/

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY keeper/package*.json ./

ENV NODE_ENV=production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser
CMD ["node", "dist/index.js"]
