# Deepcrawl Dashboard — Next.js 16 on CF Workers Containers
# Clones the deepcrawl monorepo and builds the Next.js dashboard.
# CF Containers build pipeline handles the Docker build.
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10 --activate && apk add --no-cache git

WORKDIR /app

# Clone the deepcrawl monorepo
RUN git clone --depth 1 https://github.com/lumpinif/deepcrawl.git /app

# Install workspace dependencies
RUN pnpm install --frozen-lockfile 2>&1 || pnpm install --no-frozen-lockfile 2>&1

# Build the Next.js dashboard
WORKDIR /app/apps/app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_URL=https://deepcrawl.projectsites.dev
ENV NEXT_PUBLIC_DEEPCRAWL_API_URL=https://api.deepcrawl.projectsites.dev
ENV NEXT_PUBLIC_USE_AUTH_WORKER=false
ENV BETTER_AUTH_URL=https://deepcrawl.projectsites.dev
ENV AUTH_COOKIE_DOMAIN=projectsites.dev
ENV NEXT_PUBLIC_BRAND_NAME=Deepcrawl
RUN pnpm build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "node_modules/.bin/next", "start"]
