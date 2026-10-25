# Stage 1: build the Angular frontend
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npx ng build

# Stage 2: small runtime with only the Express server and the built frontend
FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /web/dist/web/browser /app/web
ENV WEB_DIR=/app/web PORT=3000
EXPOSE 3000
USER node
CMD ["node", "src/index.js"]
