ARG NODE_VERSION=24.13.0
ARG PNPM_VERSION=10.32.1
ARG GIT_VERSION=2.39
ARG PANDOC_VERSION=2.17
ARG CODEX_SDK_VERSION=0.149.0
ARG UI4A_VERSION=0.1.0-experimental.1
ARG UI4A_GIT_SHA=unknown
ARG UI4A_BUILD_DATE=unknown

FROM node:${NODE_VERSION}-bookworm-slim AS dependencies
ARG PNPM_VERSION
ARG NPM_REGISTRY=http://npm.uedc.sangfor.com.cn:80
RUN npm install --global "pnpm@${PNPM_VERSION}" --registry="${NPM_REGISTRY}" && \
    pnpm config set registry "${NPM_REGISTRY}"
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/agent-runner/package.json apps/agent-runner/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/agent/package.json packages/agent/package.json
RUN pnpm install --filter @ui4a/agent-runner... --frozen-lockfile

FROM dependencies AS builder
COPY apps/agent-runner apps/agent-runner
RUN pnpm --filter @ui4a/agent-runner build && \
    pnpm --filter @ui4a/agent-runner --prod deploy --config.inject-workspace-packages=true /runtime

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG DEBIAN_MIRROR=http://mirrors.sangfor.org/nexus/repository/debian-proxy
ARG DEBIAN_SECURITY_MIRROR=http://mirrors.sangfor.org/nexus/repository/debian-security-proxy
ARG GIT_VERSION
ARG PANDOC_VERSION
ARG CODEX_SDK_VERSION
ARG UI4A_VERSION
ARG UI4A_GIT_SHA
ARG UI4A_BUILD_DATE
RUN sed -i "s#http://deb.debian.org/debian-security#${DEBIAN_SECURITY_MIRROR}#g; s#http://deb.debian.org/debian#${DEBIAN_MIRROR}#g" /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    apt-get install -y --no-install-recommends git pandoc ca-certificates tini && \
    git --version | grep -F "git version ${GIT_VERSION}" && \
    pandoc --version | grep -F "pandoc ${PANDOC_VERSION}" && \
    rm -rf /var/lib/apt/lists/*
LABEL org.opencontainers.image.title="UI4A Agent Runner" \
      org.opencontainers.image.version="${UI4A_VERSION}" \
      org.opencontainers.image.revision="${UI4A_GIT_SHA}" \
      org.opencontainers.image.created="${UI4A_BUILD_DATE}" \
      io.ui4a.release.channel="experimental" \
      io.ui4a.runner.codex-sdk="${CODEX_SDK_VERSION}" \
      io.ui4a.runner.git-requirement="${GIT_VERSION}" \
      io.ui4a.runner.pandoc-requirement="${PANDOC_VERSION}"
ENV NODE_ENV=production \
    UI4A_RUNNER_PORT=3102 \
    UI4A_VERSION=${UI4A_VERSION} \
    UI4A_GIT_SHA=${UI4A_GIT_SHA} \
    UI4A_BUILD_DATE=${UI4A_BUILD_DATE}
WORKDIR /app
COPY --from=builder --chown=node:node /runtime ./
RUN node -e "const fs=require('node:fs'); if (JSON.parse(fs.readFileSync('/app/node_modules/@openai/codex-sdk/package.json')).version !== process.argv[1]) process.exit(1)" "${CODEX_SDK_VERSION}" && \
    mkdir -p /tmp /workspaces /artifacts && \
    chown -R node:node /tmp /workspaces /artifacts
USER node
EXPOSE 3102
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3102/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js", "daemon"]
