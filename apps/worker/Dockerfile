# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# git per simple-git (clone/worktree/push); ca-certificates per HTTPS verso GitLab/Anthropic;
# bash perché il tool Bash di Claude Code richiede una shell POSIX risolvibile via $SHELL
# (Alpine ha solo /bin/sh di busybox, che Claude Code non riconosce come shell valida)
RUN apk add --no-cache git ca-certificates bash
ENV SHELL=/bin/bash

# Claude Code CLI: il worker spawna `claude` come subprocess (vedi services/agent.service.js)
RUN --mount=type=cache,target=/root/.npm \
    npm install -g @anthropic-ai/claude-code

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Workspace per cache cloni e worktrees. Owned da `node` per il caso "no bind mount".
# Se monti un volume host su /srv, assicurati che sia scrivibile da uid 1000.
RUN mkdir -p /srv/cache /srv/worktrees && chown -R node:node /srv

USER node
ENV WORKSPACE=/
CMD ["node", "src/index.js"]