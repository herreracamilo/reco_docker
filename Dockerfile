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

# Crear grupo y usuario con ID específicos para evitar conflictos
RUN addgroup -g 1000 pptruser && adduser -u 1000 -G pptruser -s /bin/sh -D pptruser

WORKDIR /app

# Crear directorios necesarios ANTES de cambiar al usuario
RUN mkdir -p /app/sessions /app/data /app/node_modules && \
    chmod -R 755 /app && \
    chown -R pptruser:pptruser /app

# Copiar archivos del builder
COPY --from=builder --chown=pptruser:pptruser /app/node_modules ./node_modules
COPY --from=builder --chown=pptruser:pptruser /app/package.json /app/pnpm-lock.yaml ./

# Copiar código fuente
COPY --chown=pptruser:pptruser . .

# Configurar zona horaria
ENV TZ=America/Argentina/Buenos_Aires
RUN apk add --no-cache tzdata && \
    ln -sf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone

# Asegurar permisos finales antes de cambiar al usuario
RUN chown -R pptruser:pptruser /app && \
    chmod -R 755 /app && \
    chmod -R 775 /app/data /app/sessions

# Cambiar al usuario no privilegiado
USER pptruser

# Verificar permisos (opcional, para debug)
RUN ls -la /app/ && \
    ls -la /app/data/ || echo "Directorio data no existe aún"

# Configurar Puppeteer para usar Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

ARG PORT=3008
ENV PORT=$PORT
EXPOSE $PORT

# Comando de inicio
CMD ["npm", "start"]
