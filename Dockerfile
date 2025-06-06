# Usar Node.js LTS
FROM node:21-alpine3.18 as builder
RUN apk add --no-cache \
      git \
      python3 \
      make \
      g++ \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      libpq-dev \
      ttf-freefont \
      udev \
      ffmpeg
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME=/usr/local/bin
RUN addgroup -S pptruser && adduser -S -G pptruser pptruser
WORKDIR /app
RUN chown -R pptruser:pptruser /app
USER pptruser
COPY package.json *-lock.* ./
RUN pnpm install --production=false
COPY . .

FROM node:21-alpine3.18
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      libpq-dev \
      ttf-freefont \
      udev \
      ffmpeg
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME=/usr/local/bin
RUN addgroup -S pptruser && adduser -S -G pptruser pptruser
WORKDIR /app

# Crear directorios necesarios con permisos correctos
RUN mkdir -p /app/sessions /app/data && \
    chown -R pptruser:pptruser /app && \  # ¡Cambia esto para aplicar a TODO /app!


# Copiar solo los archivos necesarios del builder
COPY --from=builder --chown=pptruser:pptruser /app/node_modules ./node_modules
COPY --from=builder --chown=pptruser:pptruser /app/package.json /app/pnpm-lock.yaml ./
COPY --chown=pptruser:pptruser . .

ENV TZ=America/Argentina/Buenos_Aires
RUN apk add --no-cache tzdata && \
    ln -sf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone
# Keep tzdata installed (adds ~3MB but avoids permission issues)

USER pptruser

# Configurar Puppeteer para usar Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

ARG PORT=3008
ENV PORT=$PORT
EXPOSE $PORT

CMD ["npm", "start"]