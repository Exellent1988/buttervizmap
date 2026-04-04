FROM node:20-alpine AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY config ./config
COPY rollup.config.js jest.config.mjs ./
COPY src ./src
COPY studio ./studio
COPY experiments/wasm-eel/presets ./experiments/wasm-eel/presets
RUN mkdir -p studio/preset-catalog && cp -R node_modules/butterchurn-presets/presets/converted studio/preset-catalog/butterchurn-presets

RUN pnpm build

FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4177

COPY package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/studio ./studio
COPY --from=build /app/experiments ./experiments

EXPOSE 4177

CMD ["node", "studio/server/index.js"]
