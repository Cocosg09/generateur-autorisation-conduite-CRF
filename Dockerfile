# Générateur d'autorisation de conduite : site + API (Node 24, SQLite intégré).
FROM node:24-alpine

WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY index.html gestion.html ./
COPY assets assets
COPY server/src server/src

# Évite qu'une ancienne version des scripts reste en cache après une mise à jour.
ARG VERSION=dev
RUN sed -i "s#\(assets/js/[a-z]*\.js\|assets/css/style\.css\)\"#\1?v=${VERSION}\"#g" index.html gestion.html \
 && sed -i "s#from './\([a-z-]*\)\.js'#from './\1.js?v=${VERSION}'#" assets/js/*.js \
 && mkdir /donnees && chown node:node /donnees

ENV NODE_ENV=production \
    PORT=80 \
    DOSSIER_SITE=/app \
    FICHIER_BASE=/donnees/autorisations.sqlite \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

USER node
EXPOSE 80
VOLUME /donnees
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
CMD ["node", "server/src/index.js"]
