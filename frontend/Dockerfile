FROM node:20-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* is inlined into the client bundle at build time. In production we
# pass "/api" so the browser calls the same origin (proxied to the backend); left
# empty it falls back to http://localhost:4447 for local dev.
ARG NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Docker sets HOSTNAME to the container ID by default, which the Next.js standalone
# server then tries to bind/resolve as a hostname (EAI_AGAIN). Force it to bind on
# all interfaces instead.
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
