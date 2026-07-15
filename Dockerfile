FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

# The lockfile currently contains local file: dependencies.
# npm install resolves dependencies from package.json for CI/container builds.
RUN npm install

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
