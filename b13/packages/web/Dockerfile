FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/code-generator ./packages/code-generator
COPY packages/web ./packages/web

RUN yarn install --frozen-lockfile
RUN yarn workspace @lowcode/shared build
RUN yarn workspace @lowcode/code-generator build
RUN yarn workspace @lowcode/web build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package.json yarn.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/code-generator/package.json ./packages/code-generator/
COPY packages/web/package.json ./packages/web/

RUN yarn install --frozen-lockfile --production

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/code-generator/dist ./packages/code-generator/dist
COPY --from=builder /app/packages/web/.next ./packages/web/.next
COPY --from=builder /app/packages/web/public ./packages/web/public
COPY --from=builder /app/packages/web/next.config.js ./packages/web/

EXPOSE 3001

CMD ["yarn", "workspace", "@lowcode/web", "start"]
