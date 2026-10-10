FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global bun@1.3.14 pnpm@10.22.0

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY examples/local-demo.ts ./examples/local-demo.ts
COPY integrations/mcp/package.json ./integrations/mcp/package.json

RUN pnpm install --frozen-lockfile

COPY examples ./examples
COPY src ./src
COPY integrations/mcp ./integrations/mcp

WORKDIR /workspace/integrations/mcp

EXPOSE 3000

CMD ["bun", "src/index.ts"]