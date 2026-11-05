# Production image for the MeAccount web app: build static files, serve them with nginx, and
# proxy /api to the API container so the browser only ever talks to one origin (no CORS).
#
# Build context is the REPO ROOT (the npm lockfile lives there, shared by the workspaces):
#   docker build -f apps/web/Dockerfile .

FROM node:20-alpine AS build
WORKDIR /repo

# Every workspace's package.json must be present for `npm ci` to accept the shared lockfile;
# only apps/web's dependencies are actually installed.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --workspace=apps/web --include-workspace-root=false

COPY apps/web apps/web
RUN npm run build --workspace=apps/web

FROM nginx:1.27-alpine
COPY infra/nginx.prod.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
