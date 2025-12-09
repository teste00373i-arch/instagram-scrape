const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Cache simples em memória
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    service: 'Instagram Scraper Service',
    endpoints: [
      'GET /api/instagram/:username - Buscar posts do Instagram'
    ]
  });
});

// Endpoint para buscar posts do Instagram
app.get('/api/instagram/:username', async (req, res) => {
  const { username } = req.params;
  
  // Verificar cache
  const cacheKey = `instagram:${username}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`✅ Cache hit para @${username}`);
    return res.json(cached.data);
  }
  
  console.log(`📸 Buscando posts do Instagram de @${username}...`);
  
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
    
    const page = await context.newPage();
    
    // Configurar timeout
    page.setDefaultTimeout(30000);
    
    console.log(`🌐 Navegando para instagram.com/${username}...`);
    
    // Ir para o perfil do Instagram
    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Aguardar um pouco para o JavaScript carregar
    await page.waitForTimeout(3000);
    
    // Tentar múltiplos seletores (o Instagram muda frequentemente)
    const possibleSelectors = [
      'article a[href*="/p/"]',
      'a[href*="/p/"]',
      'div[role="button"] a[href*="/p/"]'
    ];
    
    let posts = null;
    
    for (const selector of possibleSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        
        posts = await page.evaluate((sel) => {
          const links = document.querySelectorAll(sel);
          const results = [];
          
          for (let i = 0; i < Math.min(3, links.length); i++) {
            const link = links[i];
            const href = link.getAttribute('href');
            const shortcode = href?.match(/\/p\/([^\/]+)/)?.[1];
            
            if (shortcode) {
              // Tentar pegar thumbnail
              const img = link.querySelector('img');
              let media_url = img?.src;
              
              // Se não tiver src, tentar srcset
              if (!media_url || media_url.includes('data:image')) {
                const srcset = img?.getAttribute('srcset');
                if (srcset) {
                  media_url = srcset.split(',').pop().trim().split(' ')[0];
                }
              }
              
              results.push({
                shortcode,
                media_url: media_url || '',
                permalink: `https://www.instagram.com/p/${shortcode}/`,
                caption: img?.alt || 'Post do Instagram',
                timestamp: new Date().toISOString()
              });
            }
          }
          
          return results;
        }, selector);
        
        if (posts && posts.length > 0) {
          console.log(`✅ ${posts.length} posts encontrados usando seletor: ${selector}`);
          break;
        }
      } catch (err) {
        console.log(`⚠️ Seletor ${selector} não funcionou, tentando próximo...`);
      }
    }
    
    await browser.close();
    
    if (posts && posts.length > 0) {
      const response = {
        success: true,
        post: posts[0], // Retornar o mais recente
        allPosts: posts,
        source: 'Playwright Scraper'
      };
      
      // Salvar no cache
      cache.set(cacheKey, {
        data: response,
        timestamp: Date.now()
      });
      
      console.log(`✅ Posts salvos no cache para @${username}`);
      
      return res.json(response);
    }
    
    console.log(`❌ Nenhum post encontrado para @${username}`);
    return res.status(404).json({
      success: false,
      error: 'Nenhum post encontrado'
    });
    
  } catch (error) {
    console.error('❌ Erro ao buscar Instagram:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Erro ao fechar browser:', e);
      }
    }
    
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Limpar cache periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      cache.delete(key);
      console.log(`🗑️ Cache limpo para: ${key}`);
    }
  }
}, CACHE_DURATION);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Instagram Scraper Service rodando na porta ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
});
