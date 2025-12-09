FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Copiar package.json
COPY package*.json ./

# Instalar dependências
RUN npm install --production

# Copiar código
COPY . .

# Instalar browsers do Playwright
RUN npx playwright install chromium

# Expor porta
EXPOSE 3001

# Comando para iniciar
CMD ["npm", "start"]
