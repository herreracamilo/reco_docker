# Usar Node.js LTS
FROM node:18-alpine

# Instalar dependencias del sistema necesarias para Puppeteer y WPPConnect
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Configurar Puppeteer para usar Chromium instalado
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de configuración
COPY package*.json ./

# Limpiar cache de npm y instalar dependencias
RUN npm cache clean --force && \
    npm install --production --no-optional

# Copiar código fuente
COPY . .

# Crear directorio para archivos de sesión y recordatorios
RUN mkdir -p /app/sessions /app/data

# Exponer puerto
EXPOSE 3008

# Comando para iniciar la aplicación
CMD ["npm", "start"]