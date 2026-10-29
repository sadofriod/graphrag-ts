FROM node:22-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Prisma detects the openssl flavour at generate time; the runtime stage is
# Debian 12 (openssl 3.0), so the build stage must match or the generated
# query engine targets debian-openssl-1.1.x and fails to load.
RUN npm i -g bun@1.3.14 pnpm@10.22.0

WORKDIR /build

# The repository-root .dockerignore applies to this root build context.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY examples/local-demo.ts ./examples/local-demo.ts
COPY integrations/mcp/package.json ./integrations/mcp/package.json

RUN pnpm install --frozen-lockfile

COPY src ./src
COPY examples ./examples
COPY prisma ./prisma
COPY integrations/mcp ./integrations/mcp

RUN node_modules/.bin/prisma generate
COPY integrations/mcp/datasets.example.json /app/datasets.json
COPY deploy/allinone/allinone-entrypoint.sh /usr/local/bin/allinone-entrypoint.sh
RUN chmod +x /usr/local/bin/allinone-entrypoint.sh

FROM pgvector/pgvector:pg16

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /usr/local/bin/node /usr/local/bin/node
# store.ensureGraphSchema() shells out to `node_modules/.bin/prisma db push`,
# which needs a node binary in PATH; bun cannot execute that shim.
COPY --from=build /usr/local/lib/node_modules/bun /usr/local/lib/node_modules/bun
RUN ln -sf /usr/local/lib/node_modules/bun/bin/bun.exe /usr/local/bin/bun
COPY --from=build /build /workspace
COPY --from=build /app/datasets.json /app/datasets.json
COPY --from=build /usr/local/bin/allinone-entrypoint.sh /usr/local/bin/allinone-entrypoint.sh

ENV BUN_INSTALL=/usr/local
WORKDIR /workspace/integrations/mcp

EXPOSE 3000
VOLUME /var/lib/postgresql/data
CMD ["/usr/local/bin/allinone-entrypoint.sh"]
