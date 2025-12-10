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
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // Aguardar carregamento completo
    await page.waitForTimeout(5000);
    
    console.log(`📊 Tentando extrair dados da página...`);
    
    // Debug: verificar estrutura HTML
    const pageStructure = await page.evaluate(() => {
      return {
        hasArticle: !!document.querySelector('article'),
        hasMain: !!document.querySelector('main'),
        hasLinks: document.querySelectorAll('a').length,
        hasImages: document.querySelectorAll('img').length,
        title: document.title,
        bodyText: document.body.innerText.substring(0, 500)
      };
    });
    
    console.log('🔍 Estrutura da página:', pageStructure);
    
    // Tentar extrair dados do script JSON do Instagram
    const jsonData = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          if (data && data.mainEntityofPage) {
            return data;
          }
        } catch (e) {}
      }
      
      // Tentar pegar do __additionalDataLoaded__
      if (window._sharedData) {
        return window._sharedData;
      }
      
      return null;
    });
    
    console.log(`📦 Dados JSON extraídos:`, jsonData ? 'Sim' : 'Não');
    
    // Debug: screenshot para análise
    try {
      await page.screenshot({ path: 'debug-instagram.png', fullPage: false });
      console.log('📸 Screenshot salvo em debug-instagram.png');
    } catch (e) {
      console.log('⚠️ Não foi possível salvar screenshot');
    }
    
    // Tentar múltiplos seletores (o Instagram muda frequentemente)
    const possibleSelectors = [
      'article a[href*="/p/"]',
      'a[href*="/p/"] img',
      'div[role="button"] a[href*="/p/"]',
      'main article a[href*="/p/"]',
      'article > div a[href*="/p/"]',
      'a[href*="/reel/"]',
      'a[href*="/p/"]'
    ];
    
    let posts = null;
    
    for (const selector of possibleSelectors) {
      try {
        console.log(`🔍 Tentando seletor: ${selector}`);
        await page.waitForSelector(selector, { timeout: 5000 });
        
        posts = await page.evaluate((sel) => {
          const links = document.querySelectorAll(sel);
          console.log(`Encontrados ${links.length} links com seletor ${sel}`);
          const results = [];
          
          for (let i = 0; i < Math.min(3, links.length); i++) {
            const element = links[i];
            
            // Se o elemento for img, pegar o link pai
            const link = element.tagName === 'IMG' ? element.closest('a') : element;
            
            if (!link) continue;
            
            const href = link.getAttribute('href');
            const shortcode = href?.match(/\/p\/([^\/]+)/)?.[1];
            
            if (shortcode) {
              // Tentar pegar thumbnail de várias formas
              let img = element.tagName === 'IMG' ? element : link.querySelector('img');
              let media_url = img?.src;
              
              // Se não tiver src válido, tentar srcset
              if (!media_url || media_url.includes('data:image') || media_url.length < 50) {
                const srcset = img?.getAttribute('srcset');
                if (srcset) {
                  const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
                  media_url = urls[urls.length - 1]; // Pegar a maior resolução
                }
              }
              
              results.push({
                shortcode,
                media_url: media_url || `https://www.instagram.com/p/${shortcode}/media/?size=l`,
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
