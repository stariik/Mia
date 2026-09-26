# The two secrets are NOT baked into this image (see .dockerignore):
# google-service-account.json and .env are mounted at run time by
# docker-compose. An image with keys inside is an image you can never push
# anywhere. Same reasoning as not shipping keys in the APK.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# This build runs with NO secrets, on purpose. `next build` imports every route
# module to collect page data, so any module-level code that requires a real key
# will break the build here — even though it works locally, where Next silently
# loads .env.local. Keep secret access lazy or total (see lib/gemini.ts,
# lib/auth/jwt.ts). Verify with: mv .env.local away && npx next build
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# users.json lives here; docker-compose mounts a named volume over it so
# accounts survive redeploys. Pre-created so the app can write as `nextjs`.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
