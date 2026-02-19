FROM node:20-alpine

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /workspace/
COPY apps/web/package.json /workspace/apps/web/package.json
COPY packages/openapi-client/package.json /workspace/packages/openapi-client/package.json

RUN pnpm install --frozen-lockfile

COPY apps/web /workspace/apps/web
COPY packages/openapi-client /workspace/packages/openapi-client

WORKDIR /workspace/apps/web
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start", "-p", "3000"]
