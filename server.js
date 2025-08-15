const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
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

// Optimized HTTP agent for faster connections
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 5000,
    freeSocketTimeout: 30000
});

const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 5000,
    freeSocketTimeout: 30000
});

// Connected users tracking
let connectedUsers = new Set();
let wss;

// Initialize WebSocket server
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

// Optimized middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression({ level: 1 })); // Faster compression
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json({ limit: '5mb' })); // Reduced limit for speed
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Process error handlers
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
        
        ws.on('close', () => {
            connectedUsers.delete(userId);
            broadcastUserCount();
        });
        
        ws.on('error', (error) => {
            console.error(`WebSocket error for user ${userId}:`, error.message);
            connectedUsers.delete(userId);
            broadcastUserCount();
        });
    });
}

// Optimized utility functions
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

// Optimized HTML processing - minimal processing for speed
function processHtml(html, baseUrl) {
    try {
        const $ = cheerio.load(html, {
            decodeEntities: false,
            lowerCaseAttributeNames: false
        });
        
        // Process only essential elements for speed
        $('a[href]').each((i, elem) => {
            try {
                const href = $(elem).attr('href');
                if (href && !href.startsWith('javascript:') && !href.startsWith('#') && !href.startsWith('mailto:')) {
                    const absoluteUrl = url.resolve(baseUrl, href);
                    if (isValidUrl(absoluteUrl)) {
                        const encryptedUrl = encryptUrl(absoluteUrl);
                        $(elem).attr('href', `/proxy/${encryptedUrl}`);
                    }
                }
            } catch (error) {
                // Silently continue for speed
            }
        });
        
        // Minimal form processing
        $('form[action]').each((i, elem) => {
            try {
                const action = $(elem).attr('action');
                if (action && !action.startsWith('#')) {
                    const absoluteUrl = url.resolve(baseUrl, action);
                    if (isValidUrl(absoluteUrl)) {
                        const encryptedUrl = encryptUrl(absoluteUrl);
                        $(elem).attr('action', `/proxy/${encryptedUrl}`);
                    }
                }
            } catch (error) {
                // Silently continue
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
                // Silently continue
            }
        });
        
        // Inject optimized search interface
        $('body').prepend(`
            <div id="proxy-interface" style="
                position: fixed;
                top: -100px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.85);
                border-radius: 16px;
                padding: 16px 20px;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
                z-index: 2147483647;
                transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
                border: 1px solid rgba(255, 255, 255, 0.1);
                min-width: 450px;
                opacity: 0;
            ">
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" id="proxy-search" placeholder="Search or enter URL..." style="
                        flex: 1;
                        padding: 10px 14px;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        border-radius: 10px;
                        font-size: 14px;
                        outline: none;
                        transition: all 0.2s ease;
                        background: rgba(255, 255, 255, 0.1);
                        color: white;
                    " />
                    <button id="proxy-refresh" style="
                        padding: 10px 12px;
                        background: #3b82f6;
                        color: white;
                        border: none;
                        border-radius: 10px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        font-size: 14px;
                        min-width: 40px;
                    " title="Refresh">↻</button>
                    <button id="proxy-fullscreen" style="
                        padding: 10px 12px;
                        background: #10b981;
                        color: white;
                        border: none;
                        border-radius: 10px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        font-size: 14px;
                        min-width: 40px;
                    " title="Fullscreen">⛶</button>
                </div>
                <div style="font-size: 11px; color: rgba(255, 255, 255, 0.6); margin-top: 8px; text-align: center;">
                    <span id="user-count">1</span> online
                </div>
            </div>
            
            <div id="hover-trigger" style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                height: 40px;
                z-index: 2147483646;
                pointer-events: auto;
            "></div>
        `);
        
        // Optimized JavaScript injection
        $('head').append(`
            <style>
                #proxy-search::placeholder { color: rgba(255, 255, 255, 0.5) !important; }
                #proxy-search:focus { 
                    border-color: rgba(59, 130, 246, 0.5) !important; 
                    background: rgba(255, 255, 255, 0.15) !important; 
                }
            </style>
            <script>
                (function() {
                    const interface = document.getElementById('proxy-interface');
                    const trigger = document.getElementById('hover-trigger');
                    const searchInput = document.getElementById('proxy-search');
                    const refreshBtn = document.getElementById('proxy-refresh');
                    const fullscreenBtn = document.getElementById('proxy-fullscreen');
                    const userCountEl = document.getElementById('user-count');
                    
                    if (!interface || !trigger || !searchInput) return;
                    
                    let hideTimeout;
                    let isVisible = false;
                    
                    function showInterface() {
                        clearTimeout(hideTimeout);
                        if (!isVisible) {
                            interface.style.top = '20px';
                            interface.style.opacity = '1';
                            isVisible = true;
                        }
                    }
                    
                    function hideInterface() {
                        hideTimeout = setTimeout(() => {
                            interface.style.top = '-100px';
                            interface.style.opacity = '0';
                            isVisible = false;
                        }, 200);
                    }
                    
                    // Event listeners
                    trigger.addEventListener('mouseenter', showInterface);
                    trigger.addEventListener('mousemove', showInterface);
                    interface.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
                    interface.addEventListener('mouseleave', hideInterface);
                    
                    // Search functionality
                    function performSearch(query) {
                        if (!query) return;
                        
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
                        .catch(err => console.error('Search failed:', err));
                    }
                    
                    searchInput.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            performSearch(this.value.trim());
                        }
                    });
                    
                    // Refresh button
                    if (refreshBtn) {
                        refreshBtn.addEventListener('click', () => {
                            window.location.reload();
                        });
                    }
                    
                    // Fullscreen button
                    if (fullscreenBtn) {
                        fullscreenBtn.addEventListener('click', () => {
                            if (!document.fullscreenElement) {
                                document.documentElement.requestFullscreen();
                            } else {
                                document.exitFullscreen();
                            }
                        });
                    }
                    
                    // Button hover effects
                    [refreshBtn, fullscreenBtn].forEach(btn => {
                        if (btn) {
                            btn.addEventListener('mouseenter', function() {
                                this.style.transform = 'scale(1.1)';
                            });
                            btn.addEventListener('mouseleave', function() {
                                this.style.transform = 'scale(1)';
                            });
                        }
                    });
                    
                    // WebSocket for user count
                    try {
                        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                        const ws = new WebSocket(protocol + '//' + window.location.host);
                        ws.onmessage = function(event) {
                            try {
                                const data = JSON.parse(event.data);
                                if (data.type === 'userCount' && userCountEl) {
                                    userCountEl.textContent = data.count;
                                }
                            } catch (e) {}
                        };
                    } catch (e) {}
                    
                    // Optimized form handling
                    document.addEventListener('click', function(e) {
                        const link = e.target.closest('a[href]');
                        if (link && link.href && !link.href.includes('/proxy/') && !link.href.startsWith('javascript:') && !link.href.startsWith('#')) {
                            e.preventDefault();
                            performSearch(link.href);
                        }
                    });
                    
                    // Override form submissions
                    document.addEventListener('submit', function(e) {
                        const form = e.target;
                        if (form.action && !form.action.includes('/proxy/')) {
                            e.preventDefault();
                            
                            const formData = new FormData(form);
                            let targetUrl = form.action;
                            
                            if (form.method.toLowerCase() === 'get') {
                                const params = new URLSearchParams(formData);
                                targetUrl += (targetUrl.includes('?') ? '&' : '?') + params.toString();
                            }
                            
                            performSearch(targetUrl);
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

// Serve the main page with fixed search
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
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            overflow: hidden;
        }
        
        .container {
            text-align: center;
            max-width: 600px;
            padding: 40px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            animation: fadeIn 0.8s ease-out;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        h1 {
            font-size: 3.5rem;
            margin-bottom: 1rem;
            background: linear-gradient(45deg, #60a5fa, #a78bfa, #f472b6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 700;
        }
        
        .subtitle {
            font-size: 1.2rem;
            margin-bottom: 2.5rem;
            opacity: 0.8;
            color: #cbd5e1;
        }
        
        .search-container {
            position: relative;
            margin-bottom: 2.5rem;
        }
        
        .search-box {
            width: 100%;
            padding: 18px 28px;
            font-size: 16px;
            border: 2px solid rgba(255, 255, 255, 0.15);
            border-radius: 50px;
            background: rgba(0, 0, 0, 0.3);
            color: white;
            outline: none;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .search-box::placeholder {
            color: rgba(255, 255, 255, 0.5);
        }
        
        .search-box:focus {
            border-color: rgba(96, 165, 250, 0.6);
            background: rgba(0, 0, 0, 0.4);
            box-shadow: 0 0 25px rgba(96, 165, 250, 0.3);
            transform: scale(1.02);
        }
        
        .search-btn {
            position: absolute;
            right: 6px;
            top: 50%;
            transform: translateY(-50%);
            background: linear-gradient(45deg, #3b82f6, #1d4ed8);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 25px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            font-size: 14px;
        }
        
        .search-btn:hover {
            transform: translateY(-50%) scale(1.05);
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }
        
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 1.2rem;
            margin-bottom: 2rem;
        }
        
        .feature {
            padding: 1.2rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.3s ease;
        }
        
        .feature:hover {
            background: rgba(255, 255, 255, 0.08);
            transform: translateY(-2px);
        }
        
        .feature h3 {
            margin-bottom: 0.5rem;
            font-size: 1.1rem;
            color: #60a5fa;
        }
        
        .feature p {
            font-size: 0.9rem;
            opacity: 0.8;
            color: #cbd5e1;
        }
        
        .user-count {
            font-size: 0.9rem;
            opacity: 0.6;
            color: #94a3b8;
        }
        
        .hover-hint {
            position: fixed;
            top: 15px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #60a5fa;
            padding: 8px 14px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
            z-index: 999997;
            border: 1px solid rgba(96, 165, 250, 0.3);
            animation: pulse 3s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="hover-hint">
        ↑ Hover here for controls
    </div>
    
    <div class="container">
        <h1>Privacy Proxy</h1>
        <p class="subtitle">Lightning-fast anonymous browsing</p>
        
        <div class="search-container">
            <input type="text" class="search-box" id="main-search" placeholder="Enter URL or search anything...">
            <button class="search-btn" onclick="performSearch()">→</button>
        </div>
        
        <div class="features">
            <div class="feature">
                <h3>🚀 Ultra Fast</h3>
                <p>Optimized for maximum speed</p>
            </div>
            <div class="feature">
                <h3>🔒 Encrypted</h3>
                <p>All traffic is encrypted</p>
            </div>
            <div class="feature">
                <h3>🌐 Universal</h3>
                <p>Access any website</p>
            </div>
        </div>
        
        <div class="user-count">
            <span id="main-user-count">1</span> users online
        </div>
    </div>

    <script>
        // WebSocket connection
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(protocol + '//' + window.location.host);
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'userCount') {
                        const countEl = document.getElementById('main-user-count');
                        if (countEl) countEl.textContent = data.count;
                    }
                } catch (e) {}
            };
        } catch (e) {}
        
        // Optimized search function
        function performSearch() {
            const query = document.getElementById('main-search').value.trim();
            if (!query) return;
            
            // Show loading state
            const btn = document.querySelector('.search-btn');
            const originalText = btn.textContent;
            btn.textContent = '...';
            btn.disabled = true;
            
            fetch('/api/search', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({query: query})
            })
            .then(r => r.json())
            .then(data => {
                if (data.url) {
                    window.location.href = data.url;
                } else {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            })
            .catch(err => {
                console.error('Search failed:', err);
                btn.textContent = originalText;
                btn.disabled = false;
            });
        }
        
        // Enter key support
        document.getElementById('main-search').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
        });
        
        // Input focus animations
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

// API Routes
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
    res.json({ count: connectedUsers.size });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        users: connectedUsers.size,
        uptime: process.uptime()
    });
});

// Optimized search endpoint
app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Query required' });
        }
        
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            return res.status(400).json({ error: 'Query cannot be empty' });
        }
        
        let searchUrl;
        
        // Fast URL detection
        if (trimmedQuery.startsWith('http://') || trimmedQuery.startsWith('https://')) {
            searchUrl = trimmedQuery;
        } else if (trimmedQuery.includes('.') && !trimmedQuery.includes(' ')) {
            searchUrl = trimmedQuery.startsWith('www.') ? `https://${trimmedQuery}` : `https://www.${trimmedQuery}`;
        } else {
            searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmedQuery)}`;
        }
        
        if (!isValidUrl(searchUrl)) {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        
        const encrypted = encryptUrl(searchUrl);
        res.json({ url: `/proxy/${encrypted}` });
        
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Ultra-fast proxy endpoint - FIXED
app.all('/proxy/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    
    try {
        const targetUrl = decryptUrl(encryptedUrl);
        
        if (!targetUrl || !isValidUrl(targetUrl)) {
            return res.status(400).send('Invalid URL');
        }
        
        console.log(`🚀 Fast proxy ${req.method}: ${targetUrl}`);
        
        // Ultra-fast fetch with optimized settings
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        let fetchOptions = {
            method: req.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive'
            },
            signal: controller.signal
            // Removed agent: httpsAgent since fetch doesn't support it
        };
        
        // Fast POST data handling
        if (req.method === 'POST' && Object.keys(req.body).length > 0) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(req.body)) {
                params.append(key, value);
            }
            fetchOptions.body = params.toString();
            fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        
        const response = await fetch(targetUrl, fetchOptions);
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const contentType = response.headers.get('content-type') || '';
        
        // Fast content handling
        if (contentType.includes('text/html')) {
            const html = await response.text();
            const processedHtml = processHtml(html, targetUrl);
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.send(processedHtml);
        } else {
            // FIXED: Convert ReadableStream to Buffer
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            res.set('Content-Type', contentType);
            
            // Set cache headers for static assets
            if (contentType.includes('image/') || contentType.includes('text/css') || contentType.includes('javascript')) {
                res.set('Cache-Control', 'public, max-age=3600');
            }
            
            res.send(buffer);
        }
        
    } catch (error) {
        console.error('Proxy error:', error.message);
        
        let errorMessage = 'Failed to load';
        if (error.name === 'AbortError') {
            errorMessage = 'Timeout';
        } else if (error.message.includes('ENOTFOUND')) {
            errorMessage = 'Site not found';
        }
        
        res.status(500).send(`
            <html>
                <head><title>Error</title>
                <style>
                    body { 
                        font-family: system-ui; 
                        background: #1a1a2e; 
                        color: white; 
                        text-align: center; 
                        padding: 50px; 
                    }
                    .error { 
                        background: rgba(0,0,0,0.5); 
                        padding: 30px; 
                        border-radius: 15px; 
                        display: inline-block; 
                    }
                    button { 
                        background: #3b82f6; 
                        color: white; 
                        border: none; 
                        padding: 10px 20px; 
                        border-radius: 8px; 
                        cursor: pointer; 
                        margin: 10px; 
                    }
                </style>
                </head>
                <body>
                    <div class="error">
                        <h2>⚡ ${errorMessage}</h2>
                        <p>${error.message}</p>
                        <button onclick="history.back()">← Back</button>
                        <button onclick="window.location.href='/'">🏠 Home</button>
                    </div>
                </body>
            </html>
        `);
    }
});

// Ultra-fast image proxy - FIXED
app.get('/image/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    
    try {
        const targetUrl = decryptUrl(encryptedUrl);
        
        if (!targetUrl || !isValidUrl(targetUrl)) {
            throw new Error('Invalid image URL');
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
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
        
        const contentType = response.headers.get('content-type');
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=7200');
        
        // FIXED: Convert ReadableStream to Buffer and send
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);
        
    } catch (error) {
        console.error('Image proxy error:', error.message);
        // Return 1x1 transparent pixel
        const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
        res.set('Content-Type', 'image/png');
        res.send(pixel);
    }
});

// Ultra-fast asset proxy - FIXED
app.get('/asset/:encryptedUrl', async (req, res) => {
    const { encryptedUrl } = req.params;
    
    try {
        const targetUrl = decryptUrl(encryptedUrl);
        
        if (!targetUrl || !isValidUrl(targetUrl)) {
            throw new Error('Invalid asset URL');
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        
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
        
        const contentType = response.headers.get('content-type');
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=7200');
        
        // For CSS, do minimal processing
        if (contentType && contentType.includes('text/css')) {
            let content = await response.text();
            // Fast CSS URL replacement
            content = content.replace(/url\(['"]?(?!http|data:)([^'")]+)['"]?\)/g, (match, relativeUrl) => {
                try {
                    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/'));
                    const absoluteUrl = url.resolve(baseUrl + '/', relativeUrl);
                    const encrypted = encryptUrl(absoluteUrl);
                    return `url('/asset/${encrypted}')`;
                } catch (error) {
                    return match;
                }
            });
            res.send(content);
        } else {
            // FIXED: Convert to buffer and send
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            res.send(buffer);
        }
        
    } catch (error) {
        console.error('Asset proxy error:', error.message);
        res.status(404).send('');
    }
});

// Create public directory if needed
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    try {
        fs.mkdirSync(publicDir);
        console.log('✅ Created public directory');
    } catch (error) {
        console.error('❌ Failed to create public directory:', error.message);
    }
}

// Start server
const startServer = () => {
    try {
        server.listen(PORT, () => {
            console.log(`🚀 Ultra-Fast Privacy Proxy running on port ${PORT}`);
            console.log(`📡 WebSocket: ${wss ? 'ready' : 'failed'}`);
            console.log(`🌐 Access: http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
};

// Error handling
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
    console.log(`${signal} received, shutting down...`);
    
    if (wss) {
        wss.close();
    }
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
    
    setTimeout(() => {
        process.exit(1);
    }, 3000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('✅ Ultra-fast proxy server ready');
