FROM mcr.microsoft.com/playwright:v1.55.0-jammy

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY render-service/package.json ./
RUN npm install --omit=dev
COPY render-service/server.js ./
COPY index.html ./public/index.html
COPY assets ./public/assets

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
