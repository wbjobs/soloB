FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/code-generator ./packages/code-generator
COPY packages/server ./packages/server

RUN yarn install --frozen-lockfile
RUN yarn workspace @lowcode/shared build
RUN yarn workspace @lowcode/code-generator build
RUN yarn workspace @lowcode/server build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json yarn.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/code-generator/package.json ./packages/code-generator/
COPY packages/server/package.json ./packages/server/

RUN yarn install --frozen-lockfile --production

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/code-generator/dist ./packages/code-generator/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/prisma ./packages/server/prisma

EXPOSE 3000

CMD ["node", "packages/server/dist/main.js"]
