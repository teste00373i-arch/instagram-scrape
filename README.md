# Instagram Scraper Service

Microserviço para scraping de posts do Instagram usando Playwright.

## 🚀 Deploy no Render

### Passo 1: Push para o GitHub

```bash
cd instagram-scraper
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/teste00373i-arch/instagram-scrape.git
git branch -M main
git push -u origin main
```

### Passo 2: Criar Web Service no Render

1. Acesse [render.com](https://render.com)
2. Clique em **"New +"** → **"Web Service"**
3. Conecte seu repositório GitHub `teste00373i-arch/instagram-scrape`
4. Configure:
   - **Name**: `instagram-scraper-service`
   - **Region**: Oregon (US West)
   - **Branch**: `main`
   - **Runtime**: Docker
   - **Instance Type**: Free
5. Clique em **"Create Web Service"**

### Passo 3: Aguardar deploy

O Render vai automaticamente:
- Fazer build da imagem Docker
- Instalar Playwright e Chromium
- Iniciar o serviço

Tempo estimado: 5-10 minutos

### Passo 4: Testar o serviço

Após o deploy, você receberá uma URL como:
```
https://instagram-scraper-service.onrender.com
```

Teste:
```bash
curl https://instagram-scraper-service.onrender.com/api/instagram/odudutips
```

### Passo 5: Configurar no Vercel

No dashboard do Vercel, adicione a variável de ambiente:

```
SCRAPER_SERVICE_URL=https://instagram-scraper-service.onrender.com
```

Faça redeploy do seu app principal.

## 📡 Endpoints

### GET `/`
Health check do serviço

### GET `/api/instagram/:username`
Buscar posts mais recentes de um usuário

**Exemplo:**
```bash
curl https://seu-servico.onrender.com/api/instagram/odudutips
```

**Resposta:**
```json
{
  "success": true,
  "post": {
    "shortcode": "ABC123",
    "media_url": "https://...",
    "permalink": "https://www.instagram.com/p/ABC123/",
    "caption": "Descrição do post",
    "timestamp": "2025-12-09T..."
  },
  "allPosts": [...]
}
```

## 🔧 Testar localmente

```bash
npm install
npm start
```

Teste:
```bash
curl http://localhost:3001/api/instagram/odudutips
```

## ⚡ Features

- ✅ Cache de 5 minutos para reduzir requests
- ✅ Múltiplos seletores CSS (fallback se Instagram mudar)
- ✅ Timeout configurável
- ✅ Headers reais de navegador
- ✅ Suporte a Docker
- ✅ Free tier do Render

## 🐛 Troubleshooting

### Serviço lento no Render (free tier)
- O free tier do Render hiberna após 15 minutos de inatividade
- Primeira request pode demorar 30-60 segundos
- Considere usar um serviço de "ping" para manter ativo

### Instagram bloqueando requests
- O cache de 5 minutos ajuda a reduzir requests
- Se necessário, aumente o CACHE_DURATION no server.js

### Timeout errors
- Aumente o timeout no page.goto() se necessário
- Verifique logs no dashboard do Render

## 📝 Logs

Acesse logs em tempo real no Render:
1. Dashboard → Seu serviço
2. Aba "Logs"
3. Acompanhe requests e erros
