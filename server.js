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

// Configuration
const PORT = process.env.PORT || 8080;
const SECRET_KEY = process.env.SECRET_KEY || crypto.randomBytes(32).toString('hex');

// Connected users tracking
let connectedUsers = new Set();
let wss;

// Initialize WebSocket server with error handling
try {
    wss = new WebSocket.Server({ 
        server,
        perMessageDeflate: false,
        clientTracking: true
    });
    console.log('✅ WebSocket server initialized');
} catch (error) {
    console.error('❌ WebSocket server initialization failed:', error);
}

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Global error handler for Express
app.use((err, req, res, next) => {
    console.error('Express error:', err.message);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Process error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    // Don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
    // Don't exit - keep server running
});

// WebSocket connection handling with proper error management
if (wss) {
    wss.on('connection', (ws, req) => {
        const userId = crypto.randomUUID();
        connectedUsers.add(userId);
        
        console.log(`👤 User connected: ${userId} (Total: ${connectedUsers.size})`);
        
        // Send user count safely
        const broadcastUserCount = () => {
            const userCount = connectedUsers.size;
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    try {
                        client.send(JSON.stringify({ type: 'userCount', count: userCount }));
                    } catch (error) {
                        console.error('Error sending user count:', error.message);
                    }
                }
            });
        };
        
        // Send initial count
        broadcastUserCount();
        
        ws.on('close', (code, reason) => {
            console.log(`👤 User disconnected: ${userId} (Code: ${code})`);
            connectedUsers.delete(userId);
            broadcastUserCount();
        });
        
        ws.on('error', (error) => {
            console.error(`WebSocket error for user ${userId}:`, error.message);
            connectedUsers.delete(userId);
            broadcastUserCount();
        });

        // Keep connection alive
        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.ping();
                } catch (error) {
                    console.error('Ping error:', error.message);
                    clearInterval(pingInterval);
                }
            } else {
                clearInterval(pingInterval);
            }
        }, 30000);

        ws.on('pong', () => {
            // Connection is alive
        });
    });

    wss.on('error', (error) => {
        console.error('❌ WebSocket Server error:', error.message);
    });
}

// Utility functions with error handling
function encryptUrl(targetUrl) {
    try {
        const cipher = crypto.createCipher('aes-256-cbc', SECRET_KEY);
        let encrypted = cipher.update(targetUrl, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    } catch (error) {
        console.error('Encryption error:', error.message);
        throw new Error('Failed to encrypt URL');
    }
}

function decryptUrl(encryptedUrl) {
    try {
        const decipher = crypto.createDecipher('aes-256-cbc', SECRET_KEY);
        let decrypted = decipher.update(encryptedUrl, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error.message);
        return null;
    }
}

function isValidUrl(string) {
    try {
        const urlObj = new URL(string);
        return ['http:', 'https:'].includes(urlObj.protocol);
    } catch (_) {
        return false;
    }
}

function processHtml(html, baseUrl) {
    try {
        const $ = cheerio.load(html);
        
        // Process all URLs to go through proxy
        $('a[href]').each((i, elem) => {
            try {
                const href = $(elem).attr('href');
                if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
                    const absoluteUrl = url.resolve(baseUrl, href);
                    if (isValidUrl(absoluteUrl)) {
                        const encryptedUrl = encryptUrl(absoluteUrl);
                        $(elem).attr('href', `/proxy/${encryptedUrl}`);
                    }
                }
            } catch (error) {
                console.error('Error processing link:', error.message);
            }
        });
        
        // Process images
        $('img[src]').each((i, elem) => {
            try {
                const src = $(elem).attr('src');
                if (src) {
                    const absoluteUrl = url.resolve(baseUrl, src);
                    if (isValidUrl(absoluteUrl)) {
                        const encryptedUrl = encryptUrl(absoluteUrl);
                        $(elem).attr('src', `/image/${encryptedUrl}`);
                    }
                }
            } catch (error) {
                console.error('Error processing image:', error.message);
            }
        });
        
        // Process stylesheets
        $('link[rel="stylesheet"]').each((i, elem) => {
            try {
                const href = $(elem).attr('href');
                if (href) {
                    const absoluteUrl = url.resolve(baseUrl, href);
                    if (isValidUrl(absoluteUrl)) {
                        const encryptedUrl = encryptUrl(absoluteUrl);
                        $(elem).attr('href', `/asset/${encryptedUrl}`);
                    }
                }
            } catch (error) {
                console.error('Error processing stylesheet:', error.message);
            }
        });
        
        // Process scripts
        $('script[src]').each((i, elem) => {
            try {
                const src = $(elem).attr('src');
                if (src) {
                    const absoluteUrl = url.resolve(baseUrl, src);
                    if (isValidUrl(absoluteUrl)) {
                        const encryptedUrl = encryptUrl(absoluteUrl);
                        $(elem).attr('src', `/asset/${encryptedUrl}`);
                    }
                }
            } catch (error) {
                console.error('Error processing script:', error.message);
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
                        }).catch(console.error);
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
                        }).catch(console.error);
                    }
                });
            </script>
        `);
        
        return $.html();
    } catch (error) {
        console.error('HTML processing error:', error.message);
        return html; // Return original HTML if processing fails
    }
}

// API Routes with comprehensive error handling
app.post('/api/encrypt-url', (req, res) => {
    try {
        const { url } = req.body;
        if (!url || !isValidUrl(url)) {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        
        const encrypted = encryptUrl(url);
        res.json({ encrypted });
    } catch (error) {
        console.error('Encrypt URL error:', error.message);
        res.status(500).json({ error: 'Failed to encrypt URL' });
    }
});

app.get('/api/user-count', (req, res) => {
    try {
        res.json({ count: connectedUsers.size });
    } catch (error) {
        console.error('User count error:', error.message);
        res.status(500).json({ error: 'Failed to get user count' });
    }
});

app.get('/api/health', (req, res) => {
    try {
        res.json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            users: connectedUsers.size,
            websocket: wss ? 'connected' : 'disconnected',
            uptime: process.uptime()
        });
    } catch (error) {
        console.error('Health check error:', error.message);
        res.status(500).json({ error: 'Health check failed' });
    }
});

// Search endpoint with robust error handling
app.post('/api/search', async (req, res) => {
    try {
        console.log('🔍 Search request received:', req.body);
        
        const { query } = req.body;
        
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Query is required and must be a string' });
        }
        
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            return res.status(400).json({ error: 'Query cannot be empty' });
        }
        
        let searchUrl;
        
        // Determine if it's a URL or search query
        if (trimmedQuery.startsWith('http://') || trimmedQuery.startsWith('https://')) {
            searchUrl = trimmedQuery;
        } else if (trimmedQuery.includes('.') && !trimmedQuery.includes(' ') && trimmedQuery.split('.').length >= 2) {
            // Looks like a domain
            searchUrl = trimmedQuery.startsWith('www.') ? `https://${trimmedQuery}` : `https://www.${trimmedQuery}`;
        } else {
            // It's a search query
            searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmedQuery)}`;
        }
        
        console.log('🔗 Resolved URL:', searchUrl);
        
        // Validate the final URL
        if (!isValidUrl(searchUrl)) {
            return res.status(400).json({ error: 'Invalid URL generated' });
        }
        
        const encrypted = encryptUrl(searchUrl);
        console.log('✅ Search successful, encrypted URL generated');
        
        res.json({ url: `/proxy/${encrypted}` });
        
    } catch (error) {
        console.error('❌ Search endpoint error:', error.message);
        res.status(500).json({ error: `Search failed: ${error.message}` });
    }
});

// Proxy endpoint with timeout handling
app.get('/proxy/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    
    try {
        const targetUrl = decryptUrl(encryptedUrl);
        
        if (!targetUrl || !isValidUrl(targetUrl)) {
            return res.status(400).send('Invalid or expired URL');
        }
        
        console.log(`🌐 Proxying: ${targetUrl}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
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
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
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
                const buffer = await response.buffer();
                res.set('Content-Type', contentType);
                res.send(buffer);
            }
        } catch (fetchError) {
            clearTimeout(timeoutId);
            throw fetchError;
        }
        
    } catch (error) {
        console.error('❌ Proxy error:', error.message);
        
        let errorMessage = 'Unable to load page';
        if (error.name === 'AbortError') {
            errorMessage = 'Request timed out';
        } else if (error.message.includes('ENOTFOUND')) {
            errorMessage = 'Website not found';
        } else if (error.message.includes('ECONNREFUSED')) {
            errorMessage = 'Connection refused';
        }
        
        res.status(500).send(`
            <html>
                <head><title>Proxy Error</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1>${errorMessage}</h1>
                    <p>Error: ${error.message}</p>
                    <button onclick="history.back()">Go Back</button>
                    <br><br>
                    <small>Target URL: ${req.params.encryptedUrl ? 'Encrypted' : 'Invalid'}</small>
                </body>
            </html>
        `);
    }
});

// Image proxy with error handling
app.get('/image/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    
    try {
        const targetUrl = decryptUrl(encryptedUrl);
        
        if (!targetUrl || !isValidUrl(targetUrl)) {
            throw new Error('Invalid image URL');
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': new URL(targetUrl).origin
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const buffer = await response.buffer();
        const contentType = response.headers.get('content-type');
        
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(buffer);
        
    } catch (error) {
        console.error('Image proxy error:', error.message);
        // Return a 1x1 transparent pixel on error
        const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
        res.set('Content-Type', 'image/png');
        res.send(pixel);
    }
});

// Asset proxy with error handling
app.get('/asset/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    
    try {
        const targetUrl = decryptUrl(encryptedUrl);
        
        if (!targetUrl || !isValidUrl(targetUrl)) {
            throw new Error('Invalid asset URL');
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': new URL(targetUrl).origin
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        let content = await response.text();
        const contentType = response.headers.get('content-type');
        
        // Process CSS files to fix relative URLs
        if (contentType && contentType.includes('text/css')) {
            try {
                const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/'));
                content = content.replace(/url\(['"]?(?!http|data:)([^'")]+)['"]?\)/g, (match, relativeUrl) => {
                    try {
                        const absoluteUrl = url.resolve(baseUrl + '/', relativeUrl);
                        const encrypted = encryptUrl(absoluteUrl);
                        return `url('/asset/${encrypted}')`;
                    } catch (error) {
                        console.error('CSS URL processing error:', error.message);
                        return match;
                    }
                });
            } catch (error) {
                console.error('CSS processing error:', error.message);
            }
        }
        
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(content);
        
    } catch (error) {
        console.error('Asset proxy error:', error.message);
        res.status(404).send('');
    }
});

// Create public directory and basic files if they don't exist
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    try {
        fs.mkdirSync(publicDir);
        console.log('✅ Created public directory');
    } catch (error) {
        console.error('❌ Failed to create public directory:', error.message);
    }
}

// Start server with comprehensive error handling
const startServer = () => {
    try {
        server.listen(PORT, () => {
            console.log(`🚀 Privacy Proxy Server running on port ${PORT}`);
            console.log(`📡 WebSocket server: ${wss ? 'initialized' : 'failed'}`);
            console.log(`🔐 Encryption key: ${SECRET_KEY.substring(0, 8)}...`);
            console.log(`🌐 Access at: http://localhost:${PORT}`);
            console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
};

// Handle server startup errors
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        process.exit(1);
    } else {
        console.error('❌ Server error:', error.message);
        process.exit(1);
    }
});

// Start the server
startServer();

// Graceful shutdown
const shutdown = (signal) => {
    console.log(`${signal} received, shutting down gracefully`);
    
    if (wss) {
        wss.close(() => {
            console.log('WebSocket server closed');
        });
    }
    
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
    
    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
        console.log('Forcing exit');
        process.exit(1);
    }, 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('✅ Server initialization complete');
