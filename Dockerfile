FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

# the dependencies come first, so this layer is only rebuilt when package.json or the lockfile change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY index.js script.js ./

# the app only makes outgoing requests and writes no files, so it does not need root
USER node

# exec form, so node is PID 1 and gets the SIGTERM of `docker stop` itself (index.js finishes its job and exits)
# a single run instead of the schedule: docker compose run --rm kick-channel-scraper node script.js
CMD ["node", "index.js"]
