# Rural Health Radio - HOSTED DEMO image (SIMULATED service, synthetic data only).
# One Node process serves the built UI and the API. State lives in the container's temp dir:
# it resets on redeploy or when the host restarts/spins down the container.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# vite build -> dist/ ; esbuild -> dist-server/server.mjs
RUN npm run build:server

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    RHR_HOSTED=1 \
    RHR_HOST=0.0.0.0 \
    RHR_DATA_DIR=/tmp/rhr-hosted-demo
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
# Hosts such as Render inject PORT; the service reads it. Default 8787.
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server.mjs"]
