# ORYH AI Client multi-user server, M1 (docs/33). Build from the directory holding both checkouts:
#   deepseek-harness/ and oryh-ai-client/  (see deploy/server/compose.yaml)
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.19.0
ENV CI=1
WORKDIR /opt/deepseek-harness
COPY deepseek-harness/ ./
RUN pnpm install --frozen-lockfile
ARG DSH_CLIENT_COMMIT_HASH=c291e7961a
RUN find packages vendor -type d -empty -delete
RUN rm -f tsconfig.host.tsbuildinfo tsconfig.client.tsbuildinfo && pnpm run build:native-system && node --max-old-space-size=4096 node_modules/typescript/bin/tsc -b tsconfig.host.json
RUN NODE_OPTIONS=--max-old-space-size=4096 DSH_CLIENT_COMMIT_HASH=$DSH_CLIENT_COMMIT_HASH pnpm build
WORKDIR /opt/oryh-ai-client
COPY oryh-ai-client/ ./
RUN pnpm install --frozen-lockfile && pnpm build && pnpm --filter @oryh/server-lab build
# Owner data, sessions and the generated store master key live on the /data volume, private to `node`.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV HOME=/home/node ORYH_DATA_ROOT=/data ORYH_CONTROL_HOST=0.0.0.0 ORYH_CONTROL_PORT=4300 DSH_TELEMETRY_DISABLED=1
USER node
EXPOSE 4300
ENTRYPOINT ["node", "/opt/oryh-ai-client/packages/server-lab/lib/control-main.js"]
