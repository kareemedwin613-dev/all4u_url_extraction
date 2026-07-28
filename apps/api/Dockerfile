FROM node:22-alpine AS contracts
WORKDIR /workspace/packages/contracts
COPY packages/contracts/package*.json packages/contracts/tsconfig.json ./
RUN npm ci
COPY packages/contracts/src ./src
RUN npm run build

FROM node:22-alpine AS build
WORKDIR /workspace
COPY packages/contracts /workspace/packages/contracts
COPY apps/api/package*.json /workspace/apps/api/
WORKDIR /workspace/apps/api
RUN npm ci
COPY apps/api/tsconfig*.json ./
COPY apps/api/src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY apps/api/package*.json ./
COPY --from=build /workspace/packages/contracts /packages/contracts
RUN npm ci --omit=dev
COPY --from=build /workspace/apps/api/dist ./dist
USER node
CMD ["node", "dist/main.js"]
