# auth.projectsites.dev — self-hosted Better Auth (OIDC IdP) on CF Workers Containers.
# State lives in Neon Postgres (no persistent volume); schema is applied on boot via
# Better Auth's getMigrations (plain DDL — Neon-native, no pg_authid/role control).
# Node 22 strips TS types at runtime, so there is no compile step.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "src/index.ts"]
