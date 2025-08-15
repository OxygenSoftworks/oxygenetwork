const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const WebSocket = require('ws');
const http = require('http');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const crypto = require('crypto');
const url = require('url');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 8080;
const SECRET_KEY = process.env.SECRET_KEY || crypto.randomBytes(32).toString('hex');

// Connected users tracking
let connectedUsers = new Set();

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// WebSocket connection for real-time user count
wss.on('connection', (ws, req) => {
    const userId = crypto.randomUUID();
    connectedUsers.add(userId);
    
    // Send current user count to all clients
    const userCount = connectedUsers.size;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'userCount', count: userCount }));
        }
    });
    
    ws.on('close', () => {
        connectedUsers.delete(userId);
        const userCount = connectedUsers.size;
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'userCount', count: userCount }));
            }
        });
    });
    
    ws.on('error', () => {
        connectedUsers.delete(userId);
    });
});

// Utility functions
function encryptUrl(targetUrl) {
    const cipher = crypto.createCipher('aes-256-cbc', SECRET_KEY);
    let encrypted = cipher.update(targetUrl, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

function decryptUrl(encryptedUrl) {
    try {
        const decipher = crypto.createDecipher('aes-256-cbc', SECRET_KEY);
        let decrypted = decipher.update(encryptedUrl, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        return null;
    }
}

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

function processHtml(html, baseUrl) {
    const $ = cheerio.load(html);
    
    // Process all URLs to go through proxy
    $('a[href]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
            const absoluteUrl = url.resolve(baseUrl, href);
            if (isValidUrl(absoluteUrl)) {
                const encryptedUrl = encryptUrl(absoluteUrl);
                $(elem).attr('href', `/proxy/${encryptedUrl}`);
            }
        }
    });
    
    // Process images
    $('img[src]').each((i, elem) => {
        const src = $(elem).attr('src');
        if (src) {
            const absoluteUrl = url.resolve(baseUrl, src);
            if (isValidUrl(absoluteUrl)) {
                const encryptedUrl = encryptUrl(absoluteUrl);
                $(elem).attr('src', `/image/${encryptedUrl}`);
            }
        }
    });
    
    // Process stylesheets
    $('link[rel="stylesheet"]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href) {
            const absoluteUrl = url.resolve(baseUrl, href);
            if (isValidUrl(absoluteUrl)) {
                const encryptedUrl = encryptUrl(absoluteUrl);
                $(elem).attr('href', `/asset/${encryptedUrl}`);
            }
        }
    });
    
    // Process scripts
    $('script[src]').each((i, elem) => {
        const src = $(elem).attr('src');
        if (src) {
            const absoluteUrl = url.resolve(baseUrl, src);
            if (isValidUrl(absoluteUrl)) {
                const encryptedUrl = encryptUrl(absoluteUrl);
                $(elem).attr('src', `/asset/${encryptedUrl}`);
            }
        }
    });
    
    // Inject proxy JavaScript
    $('head').prepend(`
        <script>
            // Override window.open to use proxy
            const originalOpen = window.open;
            window.open = function(url, name, features) {
                if (url) {
                    fetch('/api/encrypt-url', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({url: url})
                    }).then(r => r.json()).then(data => {
                        originalOpen('/proxy/' + data.encrypted, name, features);
                    });
                }
            };
            
            // Override form submissions
            document.addEventListener('submit', function(e) {
                const form = e.target;
                if (form.action) {
                    e.preventDefault();
                    const formData = new FormData(form);
                    const params = new URLSearchParams();
                    for (let [key, value] of formData) {
                        params.append(key, value);
                    }
                    
                    let targetUrl = form.action;
                    if (form.method.toLowerCase() === 'get') {
                        targetUrl += '?' + params.toString();
                    }
                    
                    fetch('/api/encrypt-url', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({url: targetUrl})
                    }).then(r => r.json()).then(data => {
                        window.location.href = '/proxy/' + data.encrypted;
                    });
                }
            });
        </script>
    `);
    
    return $.html();
}

app.post('/api/encrypt-url', (req, res) => {
    const { url } = req.body;
    if (!url || !isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL' });
    }
    
    const encrypted = encryptUrl(url);
    res.json({ encrypted });
});

app.get('/api/user-count', (req, res) => {
    res.json({ count: connectedUsers.size });
});

app.get('/proxy/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    const targetUrl = decryptUrl(encryptedUrl);
    
    if (!targetUrl || !isValidUrl(targetUrl)) {
        return res.status(400).send('Invalid or expired URL');
    }
    
    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            follow: 5,
            timeout: 10000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('text/html')) {
            const html = await response.text();
            const processedHtml = processHtml(html, targetUrl);
            res.set('Content-Type', 'text/html');
            res.send(processedHtml);
        } else {
            // For non-HTML content, pipe directly
            const buffer = await response.buffer();
            res.set('Content-Type', contentType);
            res.send(buffer);
        }
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).send(`
            <html>
                <head><title>Proxy Error</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1>Unable to Load Page</h1>
                    <p>Error: ${error.message}</p>
                    <button onclick="history.back()">Go Back</button>
                </body>
            </html>
        `);
    }
});

app.get('/image/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    const targetUrl = decryptUrl(encryptedUrl);
    
    if (!targetUrl || !isValidUrl(targetUrl)) {
        return res.status(400).send('Invalid image URL');
    }
    
    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': new URL(targetUrl).origin
            },
            timeout: 8000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const buffer = await response.buffer();
        const contentType = response.headers.get('content-type');
        
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(buffer);
    } catch (error) {
        // Return a 1x1 transparent pixel on error
        const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
        res.set('Content-Type', 'image/png');
        res.send(pixel);
    }
});

// Asset proxy (CSS, JS, etc.)
app.get('/asset/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    const targetUrl = decryptUrl(encryptedUrl);
    
    if (!targetUrl || !isValidUrl(targetUrl)) {
        return res.status(400).send('Invalid asset URL');
    }
    
    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': new URL(targetUrl).origin
            },
            timeout: 8000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        let content = await response.text();
        const contentType = response.headers.get('content-type');
        
        // Process CSS files to fix relative URLs
        if (contentType && contentType.includes('text/css')) {
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/'));
            content = content.replace(/url\(['"]?(?!http|data:)([^'")]+)['"]?\)/g, (match, relativeUrl) => {
                const absoluteUrl = url.resolve(baseUrl + '/', relativeUrl);
                const encrypted = encryptUrl(absoluteUrl);
                return `url('/asset/${encrypted}')`;
            });
        }
        
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(content);
    } catch (error) {
        res.status(404).send('');
    }
});

// Search endpoint
app.post('/api/search', async (req, res) => {
    const { query } = req.body;
    
    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }
    
    let searchUrl;
    
    // Determine if it's a URL or search query
    if (query.startsWith('http://') || query.startsWith('https://')) {
        searchUrl = query;
    } else if (query.includes('.') && !query.includes(' ')) {
        searchUrl = 'https://' + query;
    } else {
        searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    }
    
    const encrypted = encryptUrl(searchUrl);
    res.json({ url: `/proxy/${encrypted}` });
});

// Create public directory and index.html if they don't exist
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Privacy Proxy Server running on port ${PORT}`);
    console.log(`📡 WebSocket server initialized`);
    console.log(`🔐 Encryption key: ${SECRET_KEY.substring(0, 8)}...`);
    console.log(`🌐 Access at: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});
