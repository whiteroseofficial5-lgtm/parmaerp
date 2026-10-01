FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# The Docker stack runs the real backend, so demo mode is off here.
ARG BACKEND_URL=http://backend:4000
ARG DEMO_MODE=false
ENV BACKEND_URL=$BACKEND_URL DEMO_MODE=$DEMO_MODE NEXT_PUBLIC_DEMO_MODE=$DEMO_MODE NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ARG DEMO_MODE=false
ENV NODE_ENV=production DEMO_MODE=$DEMO_MODE NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
