FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

# Aplica migrations a cada subida; o seed só roda quando SEED_ON_START=true.
CMD ["sh", "-c", "npm run db:migrate && if [ \"$SEED_ON_START\" = \"true\" ]; then npm run db:seed; fi && node dist/main.js"]
