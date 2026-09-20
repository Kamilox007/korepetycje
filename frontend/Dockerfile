# --- etap 1: build Reacta ---
FROM node:22-alpine AS build
WORKDIR /app
# Lockfile + `npm ci`: identyczne drzewo zależności jak lokalnie. Rozwiązywanie
# od zera z samego package.json wywalało się w npm 10 z obrazu
# ("Cannot read properties of null (reading 'edgesOut')") po dojściu
# Excalidrawa z jego drzewem peer dependencies.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- etap 2: Caddy z gotowymi plikami statycznymi ---
# Obraz wynikowy nie zawiera Node'a ani node_modules - kilkadziesiąt MB zamiast kilkuset.
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
