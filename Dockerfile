# LoanOS India API — minimal production image.
# The app is pure Node.js with a single runtime dependency (pg), so a slim
# base and an npm ci --omit=dev install is all that's needed.
FROM node:20-slim AS base
WORKDIR /app

# Install production dependencies against the lockfile first so this layer is
# cached across source-only changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application source.
COPY packages ./packages
COPY apps ./apps
COPY db ./db
COPY scripts ./scripts

# Run as an unprivileged user.
USER node

ENV NODE_ENV=production
ENV PORT=3040
# Persist file-store state on a mounted volume by default; override with
# LOANOS_STORAGE_DRIVER=postgres + DATABASE_URL for the Postgres/RLS driver.
ENV LOANOS_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3040

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3040)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/src/server.js"]
