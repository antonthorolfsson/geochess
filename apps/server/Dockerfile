# The game server. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t empire-server .
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @empire/server...
RUN pnpm --filter @empire/server build
# The server with production dependencies only. @empire/data comes along for the datasets and
# opening names it reads at runtime.
RUN pnpm --filter @empire/server deploy --prod --legacy /app

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /repo/apps/server/package.json ./
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/server/certs ./certs
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
