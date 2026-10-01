FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# poppler-utils: rasterises scanned PDFs for the local OCR fallback (not needed when ANTHROPIC_API_KEY is set)
RUN apt-get update && apt-get install -y --no-install-recommends openssl poppler-utils tesseract-ocr && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && npm i tsx prisma@5.22.0 --no-save
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/storage
EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
