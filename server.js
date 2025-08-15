const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const WebSocket = require('ws');
const http = require('http');
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
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// WebSocket connection handling
if (wss) {
    wss.on('connection', (ws, req) => {
        const userId = crypto.randomUUID();
        connectedUsers.add(userId);
        
        console.log(`👤 User connected: ${userId} (Total: ${connectedUsers.size})`);
        
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

// Utility functions
function encryptUrl(targetUrl) {
    try {
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(SECRET_KEY, 'salt', 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(targetUrl, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('Encryption error:', error.message);
        throw new Error('Failed to encrypt URL');
    }
}

function decryptUrl(encryptedUrl) {
    try {
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(SECRET_KEY, 'salt', 32);
        const parts = encryptedUrl.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encrypted = parts.join(':');
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
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
        
        // Process forms to submit through proxy
        $('form').each((i, elem) => {
            try {
                const action = $(elem).attr('action');
                if (action) {
                    const absoluteUrl = url.resolve(baseUrl, action);
                    if (isValidUrl(absoluteUrl)) {
                        const encryptedUrl = encryptUrl(absoluteUrl);
                        $(elem).attr('action', `/proxy/${encryptedUrl}`);
                    }
                }
            } catch (error) {
                console.error('Error processing form:', error.message);
            }
        });
        
        // Process images
        $('img[src]').each((i, elem) => {
            try {
                const src = $(elem).attr('src');
                if (src && !src.startsWith('data:')) {
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
        
        // Inject animated search interface
        $('body').prepend(`
            <div id="proxy-interface" style="
                position: fixed;
                top: -80px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                border-radius: 16px;
                padding: 20px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
                z-index: 999999;
                transition: top 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                border: 1px solid rgba(255, 255, 255, 0.3);
                min-width: 400px;
            ">
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="text" id="proxy-search" placeholder="Enter URL or search term..." style="
                        flex: 1;
                        padding: 12px 16px;
                        border: 2px solid #e2e8f0;
                        border-radius: 12px;
                        font-size: 14px;
                        outline: none;
                        transition: all 0.2s ease;
                        background: white;
                    " />
                    <button id="proxy-refresh" style="
                        padding: 12px;
                        background: #3b82f6;
                        color: white;
                        border: none;
                        border-radius: 12px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        font-size: 16px;
                    " title="Refresh page">↻</button>
                    <button id="proxy-fullscreen" style="
                        padding: 12px;
                        background: #10b981;
                        color: white;
                        border: none;
                        border-radius: 12px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        font-size: 16px;
                    " title="Toggle fullscreen">⛶</button>
                </div>
                <div style="font-size: 12px; color: #64748b; margin-top: 8px; text-align: center;">
                    <span id="user-count">1</span> user(s) online
                </div>
            </div>
            
            <div id="hover-trigger" style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                height: 60px;
                z-index: 999998;
                pointer-events: auto;
            "></div>
        `);
        
        // Inject proxy JavaScript
        $('head').append(`
            <script>
                (function() {
                    const interface = document.getElementById('proxy-interface');
                    const trigger = document.getElementById('hover-trigger');
                    const searchInput = document.getElementById('proxy-search');
                    const refreshBtn = document.getElementById('proxy-refresh');
                    const fullscreenBtn = document.getElementById('proxy-fullscreen');
                    const userCountEl = document.getElementById('user-count');
                    
                    let hideTimeout;
                    
                    // Show/hide interface
                    function showInterface() {
                        clearTimeout(hideTimeout);
                        interface.style.top = '20px';
                    }
                    
                    function hideInterface() {
                        hideTimeout = setTimeout(() => {
                            interface.style.top = '-80px';
                        }, 100);
                    }
                    
                    // Event listeners
                    trigger.addEventListener('mouseenter', showInterface);
                    interface.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
                    interface.addEventListener('mouseleave', hideInterface);
                    
                    // Search functionality
                    searchInput.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            const query = this.value.trim();
                            if (query) {
                                fetch('/api/search', {
                                    method: 'POST',
                                    headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify({query: query})
                                })
                                .then(r => r.json())
                                .then(data => {
                                    if (data.url) {
                                        window.location.href = data.url;
                                    }
                                })
                                .catch(console.error);
                            }
                        }
                    });
                    
                    // Refresh button
                    refreshBtn.addEventListener('click', () => {
                        window.location.reload();
                    });
                    
                    // Fullscreen button
                    fullscreenBtn.addEventListener('click', () => {
                        if (!document.fullscreenElement) {
                            document.documentElement.requestFullscreen();
                            fullscreenBtn.textContent = '⛶';
                        } else {
                            document.exitFullscreen();
                            fullscreenBtn.textContent = '⛶';
                        }
                    });
                    
                    // Input focus styling
                    searchInput.addEventListener('focus', function() {
                        this.style.borderColor = '#3b82f6';
                        this.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                    });
                    
                    searchInput.addEventListener('blur', function() {
                        this.style.borderColor = '#e2e8f0';
                        this.style.boxShadow = 'none';
                    });
                    
                    // Button hover effects
                    [refreshBtn, fullscreenBtn].forEach(btn => {
                        btn.addEventListener('mouseenter', function() {
                            this.style.transform = 'scale(1.05)';
                            this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                        });
                        btn.addEventListener('mouseleave', function() {
                            this.style.transform = 'scale(1)';
                            this.style.boxShadow = 'none';
                        });
                    });
                    
                    // WebSocket for user count
                    const ws = new WebSocket('ws://' + window.location.host);
                    ws.onmessage = function(event) {
                        const data = JSON.parse(event.data);
                        if (data.type === 'userCount') {
                            userCountEl.textContent = data.count;
                        }
                    };
                    
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
                    
                    // Override form submissions to handle multi-page navigation
                    document.addEventListener('submit', function(e) {
                        const form = e.target;
                        if (form.action && !form.action.includes('/proxy/')) {
                            e.preventDefault();
                            const formData = new FormData(form);
                            const params = new URLSearchParams();
                            for (let [key, value] of formData) {
                                params.append(key, value);
                            }
                            
                            let targetUrl = form.action;
                            if (form.method.toLowerCase() === 'get') {
                                targetUrl += (targetUrl.includes('?') ? '&' : '?') + params.toString();
                                
                                fetch('/api/encrypt-url', {
                                    method: 'POST',
                                    headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify({url: targetUrl})
                                }).then(r => r.json()).then(data => {
                                    window.location.href = '/proxy/' + data.encrypted;
                                }).catch(console.error);
                            } else {
                                // Handle POST requests
                                fetch('/api/encrypt-url', {
                                    method: 'POST',
                                    headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify({url: targetUrl})
                                }).then(r => r.json()).then(data => {
                                    const proxyForm = document.createElement('form');
                                    proxyForm.method = 'POST';
                                    proxyForm.action = '/proxy/' + data.encrypted;
                                    
                                    for (let [key, value] of formData) {
                                        const input = document.createElement('input');
                                        input.type = 'hidden';
                                        input.name = key;
                                        input.value = value;
                                        proxyForm.appendChild(input);
                                    }
                                    
                                    document.body.appendChild(proxyForm);
                                    proxyForm.submit();
                                }).catch(console.error);
                            }
                        }
                    });
                })();
            </script>
        `);
        
        return $.html();
    } catch (error) {
        console.error('HTML processing error:', error.message);
        return html;
    }
}

// Serve the main page
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Proxy</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        
        .container {
            text-align: center;
            max-width: 600px;
            padding: 40px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }
        
        h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            background: linear-gradient(45deg, #fff, #e2e8f0);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .subtitle {
            font-size: 1.2rem;
            margin-bottom: 2rem;
            opacity: 0.9;
        }
        
        .search-container {
            position: relative;
            margin-bottom: 2rem;
        }
        
        .search-box {
            width: 100%;
            padding: 16px 24px;
            font-size: 16px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50px;
            background: rgba(255, 255, 255, 0.2);
            color: white;
            outline: none;
            transition: all 0.3s ease;
            backdrop-filter: blur(5px);
        }
        
        .search-box::placeholder {
            color: rgba(255, 255, 255, 0.7);
        }
        
        .search-box:focus {
            border-color: rgba(255, 255, 255, 0.6);
            background: rgba(255, 255, 255, 0.25);
            box-shadow: 0 0 20px rgba(255, 255, 255, 0.2);
        }
        
        .search-btn {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: linear-gradient(45deg, #3b82f6, #1d4ed8);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 25px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        
        .search-btn:hover {
            transform: translateY(-50%) scale(1.05);
            box-shadow: 0 5px 15px rgba(59, 130, 246, 0.4);
        }
        
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        
        .feature {
            padding: 1rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            backdrop-filter: blur(5px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .feature h3 {
            margin-bottom: 0.5rem;
            font-size: 1.1rem;
        }
        
        .feature p {
            font-size: 0.9rem;
            opacity: 0.9;
        }
        
        .user-count {
            font-size: 0.9rem;
            opacity: 0.8;
        }
        
        .hover-hint {
            position: fixed;
            top: 10px;
            right: 20px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 12px;
            opacity: 0.7;
            z-index: 999997;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 0.7; }
            50% { opacity: 1; }
        }
        
        .hover-hint {
            animation: pulse 2s infinite;
        }
    </style>
</head>
<body>
    <div class="hover-hint">
        Hover at the top to access controls
    </div>
    
    <div class="container">
        <h1>Privacy Proxy</h1>
        <p class="subtitle">Browse the web anonymously and securely</p>
        
        <div class="search-container">
            <input type="text" class="search-box" id="main-search" placeholder="Enter URL or search term...">
            <button class="search-btn" onclick="performSearch()">Go</button>
        </div>
        
        <div class="features">
            <div class="feature">
                <h3>🔒 Encrypted</h3>
                <p>All URLs are encrypted for privacy</p>
            </div>
            <div class="feature">
                <h3>🌐 Universal</h3>
                <p>Access any website through our proxy</p>
            </div>
            <div class="feature">
                <h3>⚡ Fast</h3>
                <p>Optimized for speed and performance</p>
            </div>
        </div>
        
        <div class="user-count">
            <span id="main-user-count">1</span> user(s) currently online
        </div>
    </div>

    <script>
        // WebSocket connection for user count
        const ws = new WebSocket('ws://' + window.location.host);
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            if (data.type === 'userCount') {
                document.getElementById('main-user-count').textContent = data.count;
            }
        };
        
        // Search functionality
        function performSearch() {
            const query = document.getElementById('main-search').value.trim();
            if (query) {
                fetch('/api/search', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({query: query})
                })
                .then(r => r.json())
                .then(data => {
                    if (data.url) {
                        window.location.href = data.url;
                    }
                })
                .catch(console.error);
            }
        }
        
        // Enter key support
        document.getElementById('main-search').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
        
        // Input animations
        const searchBox = document.getElementById('main-search');
        searchBox.addEventListener('focus', function() {
            this.style.transform = 'scale(1.02)';
        });
        
        searchBox.addEventListener('blur', function() {
            this.style.transform = 'scale(1)';
        });
    </script>
</body>
</html>
    `);
});

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

// Proxy endpoint with comprehensive form handling
app.all('/proxy/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    
    try {
        const targetUrl = decryptUrl(encryptedUrl);
        
        if (!targetUrl || !isValidUrl(targetUrl)) {
            return res.status(400).send('Invalid or expired URL');
        }
        
        console.log(`🌐 Proxying ${req.method}: ${targetUrl}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        let fetchOptions = {
            method: req.method,
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
        };
        
        // Handle POST data
        if (req.method === 'POST' && req.body) {
            if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
                const params = new URLSearchParams();
                for (const [key, value] of Object.entries(req.body)) {
                    params.append(key, value);
                }
                fetchOptions.body = params.toString();
                fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            } else if (req.headers['content-type']?.includes('application/json')) {
                fetchOptions.body = JSON.stringify(req.body);
                fetchOptions.headers['Content-Type'] = 'application/json';
            }
        }
        
        try {
            const response = await fetch(targetUrl, fetchOptions);
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
                <head>
                    <title>Proxy Error</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            min-height: 100vh;
                            margin: 0;
                        }
                        .error-container {
                            text-align: center;
                            background: rgba(255, 255, 255, 0.1);
                            padding: 40px;
                            border-radius: 20px;
                            backdrop-filter: blur(10px);
                            border: 1px solid rgba(255, 255, 255, 0.2);
                        }
                        .back-btn {
                            background: linear-gradient(45deg, #3b82f6, #1d4ed8);
                            color: white;
                            border: none;
                            padding: 12px 24px;
                            border-radius: 25px;
                            cursor: pointer;
                            font-weight: 600;
                            margin-top: 20px;
                            transition: transform 0.2s ease;
                        }
                        .back-btn:hover {
                            transform: scale(1.05);
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <h1>🚫 ${errorMessage}</h1>
                        <p>Error: ${error.message}</p>
                        <button class="back-btn" onclick="history.back()">← Go Back</button>
                        <br><br>
                        <button class="back-btn" onclick="window.location.href='/'">🏠 Home</button>
                    </div>
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

// Create public directory if it doesn't exist
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
    
    setTimeout(() => {
        console.log('Forcing exit');
        process.exit(1);
    }, 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('✅ Server initialization complete');
