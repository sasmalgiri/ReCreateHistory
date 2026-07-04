# Kalsmritikosh web — multi-user knowledge OS.
# Build the React app, run the Express server (tsx) serving app + API.

FROM node:22-bookworm-slim

# better-sqlite3 may compile from source if no prebuilt matches the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_DIR=/data

# Persist per-user ledgers + uploads across restarts — mount a volume here.
VOLUME ["/data"]
EXPOSE 8787

CMD ["npm", "start"]
