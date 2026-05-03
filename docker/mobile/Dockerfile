FROM node:22-alpine
WORKDIR /app

COPY apps/mobile/package*.json ./
RUN npm ci

COPY apps/mobile/ .

ENV EXPO_DEVTOOLS_LISTEN_ADDRESS=0.0.0.0
ENV RCT_METRO_HOST=0.0.0.0

EXPOSE 8081 19000 19001 19002

CMD ["npx", "expo", "start", "--lan", "--port", "8081"]
