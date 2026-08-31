ARG NODE_VERSION=24.13.0
ARG PNPM_VERSION=10.32.1
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
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --filter @ui4a/worker... --filter @ui4a/web... --frozen-lockfile

FROM dependencies AS builder
COPY . .
RUN pnpm --filter @ui4a/worker build && \
    pnpm --filter @ui4a/worker --prod deploy --config.inject-workspace-packages=true /runtime && \
    node -e "const fs=require('node:fs'),p=require('node:path'); const keep={x64:'x86_64-unknown-linux-gnu',arm64:'aarch64-unknown-linux-gnu'}[process.arch]; if(!keep)throw new Error('Unsupported build arch: '+process.arch); const root='/runtime/node_modules/.pnpm'; for(const entry of fs.readdirSync(root)){if(!entry.startsWith('@temporalio+core-bridge@'))continue; const releases=p.join(root,entry,'node_modules/@temporalio/core-bridge/releases'); if(!fs.existsSync(releases))throw new Error('Temporal releases directory missing'); let kept=false; for(const name of fs.readdirSync(releases)){if(name===keep)kept=true; else fs.rmSync(p.join(releases,name),{recursive:true,force:true});} if(!kept)throw new Error('Temporal release missing for '+keep);}"

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG UI4A_VERSION
ARG UI4A_GIT_SHA
ARG UI4A_BUILD_DATE
LABEL org.opencontainers.image.title="UI4A Worker" \
      org.opencontainers.image.version="${UI4A_VERSION}" \
      org.opencontainers.image.revision="${UI4A_GIT_SHA}" \
      org.opencontainers.image.created="${UI4A_BUILD_DATE}" \
      io.ui4a.release.channel="experimental"
ENV NODE_ENV=production \
    UI4A_WORKER_HEALTH_PORT=3101 \
    UI4A_VERSION=${UI4A_VERSION} \
    UI4A_GIT_SHA=${UI4A_GIT_SHA} \
    UI4A_BUILD_DATE=${UI4A_BUILD_DATE}
WORKDIR /app
COPY --from=builder --chown=node:node /runtime ./
RUN mkdir -p /tmp /var/lib/ui4a && chown -R node:node /tmp /var/lib/ui4a
USER node
EXPOSE 3101
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3101/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
