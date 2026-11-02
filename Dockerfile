# =============================================================
# Stage 1: Install dependencies
# =============================================================
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# =============================================================
# Stage 2: Build the Next.js application
# =============================================================
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build (produces .next/standalone with output: 'standalone')
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# =============================================================
# Stage 3: Production runtime image (minimal standalone)
# =============================================================
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=6011
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

# Copy standalone server bundle
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Copy static files
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
# Copy public folder
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public
# Copy prisma schema for runtime
COPY --from=builder --chown=nextjs:nodejs /app/prisma          ./prisma

USER nextjs

EXPOSE 6011

# Next.js standalone entrypoint
CMD ["node", "server.js"]
