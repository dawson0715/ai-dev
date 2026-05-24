# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
# Versione mostrata in UI: passata dal CI (tag git). Il .git non è nel context.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build

FROM nginx:1.27-alpine AS runtime
# Servizio API a cui inoltrare /api/ (Swarm: nome servizio). Sostituito a runtime
# dall'entrypoint nginx via envsubst sul template.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 3030
