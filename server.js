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
    // MÉTODO 1: Tentar API interna do Instagram (mais confiável)
    console.log('🔄 Tentando API interna do Instagram...');
    try {
      const https = require('https');
      const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
      
      const apiResponse = await new Promise((resolve, reject) => {
        const options = {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-IG-App-ID': '936619743392459',
            'Accept': '*/*'
          }
        };
        
        https.get(apiUrl, options, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            if (response.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`API retornou ${response.statusCode}`));
            }
          });
        }).on('error', reject);
      });
      
      if (apiResponse?.data?.user?.edge_owner_to_timeline_media?.edges?.length > 0) {
        const edges = apiResponse.data.user.edge_owner_to_timeline_media.edges;
        const posts = edges.slice(0, 3).map(edge => ({
          shortcode: edge.node.shortcode,
          media_url: edge.node.display_url || edge.node.thumbnail_src,
          permalink: `https://www.instagram.com/p/${edge.node.shortcode}/`,
          caption: edge.node.edge_media_to_caption?.edges[0]?.node?.text || 'Post do Instagram',
          timestamp: new Date(edge.node.taken_at_timestamp * 1000).toISOString()
        }));
        
        const response = {
          success: true,
          post: posts[0],
          allPosts: posts,
          source: 'Instagram API'
        };
        
        cache.set(cacheKey, { data: response, timestamp: Date.now() });
        console.log(`✅ Posts encontrados via API para @${username}`);
        return res.json(response);
      }
    } catch (apiError) {
      console.log(`⚠️ API falhou: ${apiError.message}, tentando scraping...`);
    }
    
    // MÉTODO 2: Scraping com Playwright (fallback)
    console.log('🔄 Tentando scraping com Playwright...');
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
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      viewport: { width: 375, height: 812 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo'
    });
    
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    
    console.log(`🌐 Navegando para instagram.com/${username}...`);
    
    // Ir para o perfil do Instagram
    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Aguardar um pouco para carregar
    await page.waitForTimeout(3000);
    
    // Tentar fechar modal de login se aparecer
    try {
      await page.click('button:has-text("Agora não")', { timeout: 2000 });
      console.log('✅ Modal fechado');
    } catch (e) {
      console.log('⚠️ Sem modal para fechar');
    }
    
    await page.waitForTimeout(2000);
    
    console.log(`📊 Tentando extrair dados da página...`);
    
    // Tentar pegar dados do primeiro post direto
    const posts = await page.evaluate(() => {
      const results = [];
      
      // Procurar por qualquer link que tenha /p/ ou /reel/
      const allLinks = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
      
      console.log(`Encontrados ${allLinks.length} links de posts/reels`);
      
      for (const link of allLinks.slice(0, 5)) {
        const href = link.getAttribute('href');
        const match = href?.match(/\/(p|reel)\/([^\/]+)/);
        
        if (match) {
          const shortcode = match[2];
          
          // Tentar pegar imagem de diferentes formas
          let img = link.querySelector('img');
          let media_url = img?.src;
          
          // Verificar srcset
          if (img && (!media_url || media_url.includes('data:') || media_url.length < 50)) {
            const srcset = img.getAttribute('srcset');
            if (srcset) {
              const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
              media_url = urls[urls.length - 1];
            }
          }
          
          if (shortcode && media_url && !media_url.includes('data:')) {
            results.push({
              shortcode,
              media_url,
              permalink: `https://www.instagram.com/${match[1]}/${shortcode}/`,
              caption: img?.alt || 'Post do Instagram',
              timestamp: new Date().toISOString()
            });
          }
        }
      }
      
      return results;
    });
    
    console.log(`📦 Posts encontrados: ${posts?.length || 0}`);
    
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
    console.error(`❌ Erro ao buscar posts:`, error.message);
    
    if (browser) {
      await browser.close().catch(() => {});
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
