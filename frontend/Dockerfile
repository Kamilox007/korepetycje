# --- etap 1: build Reacta ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# --- etap 2: Caddy z gotowymi plikami statycznymi ---
# Obraz wynikowy nie zawiera Node'a ani node_modules — kilkadziesiąt MB zamiast kilkuset.
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
