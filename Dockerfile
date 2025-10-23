# Stage 1 — build
FROM node:20-alpine AS build

# install build dependencies
RUN apk add --no-cache python3 make g++ bash

WORKDIR /app

# copy package manifests first to leverage caching
COPY package.json package-lock.json* ./

# install all deps (including dev deps for tsc)
RUN npm ci

# copy source
COPY . .

# build TypeScript to /app/dist
RUN npm run build

# Stage 2 — runtime
FROM node:20-alpine AS runtime

WORKDIR /app

# runtime-only dependencies
COPY --from=build /app/package.json /app/package-lock.json* ./
# install only production deps
RUN npm ci --omit=dev

# copy built output
COPY --from=build /app/dist ./dist

# create a non-root user (optional but recommended)
RUN addgroup -S app && adduser -S -G app app
USER app

# Expose the port expected by Hugging Face Spaces (default 7860)
EXPOSE 7860

# Healthcheck (optional)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget --quiet --tries=1 --spider http://localhost:7860 || exit 1

# Start the server. Use env PORT if set by Spaces; fallback to 7860.
ENV PORT=7860
CMD ["node", "dist/index.js"]
