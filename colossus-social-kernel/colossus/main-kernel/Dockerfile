FROM node:20-alpine AS base
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src/ ./src/

FROM base AS gateway
ENV SERVICE=gateway
EXPOSE 4000
CMD ["npx", "ts-node", "src/gateway/index.ts"]

FROM base AS identity
ENV SERVICE=identity
EXPOSE 4001
CMD ["npx", "ts-node", "src/identity/index.ts"]

FROM base AS discovery
ENV SERVICE=discovery
EXPOSE 4002
CMD ["npx", "ts-node", "src/discovery/index.ts"]

FROM base AS orchestrator
ENV SERVICE=orchestrator
EXPOSE 4003
CMD ["npx", "ts-node", "src/orchestrator/index.ts"]

FROM base AS feed
ENV SERVICE=feed
EXPOSE 4004
CMD ["npx", "ts-node", "src/feed/index.ts"]
