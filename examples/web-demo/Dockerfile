FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY integrations/mcp/package.json integrations/mcp/package.json
COPY examples/web-demo/package.json examples/web-demo/package.json
RUN pnpm install --frozen-lockfile --filter graphrag-web-showcase
COPY examples/web-demo examples/web-demo
RUN pnpm --filter graphrag-web-showcase build

FROM nginx:alpine
COPY examples/web-demo/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/examples/web-demo/dist /usr/share/nginx/html
EXPOSE 80