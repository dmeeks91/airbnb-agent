# Stage 1: Build Frontend (Vite) & Backend (esbuild server.cjs)
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps || (rm -f package-lock.json && npm install --legacy-peer-deps)

COPY . .
RUN npm run build

# Stage 2: Production Runtime for Google Cloud Run
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps || (rm -f package-lock.json && npm install --omit=dev --legacy-peer-deps)

COPY --from=builder /app/dist ./dist

EXPOSE 8080

CMD ["node", "dist/server.cjs"]
