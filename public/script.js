// WebSocket connection for real-time user count

// POLYFILL FOR COMMONJS
import('node:http').then((http) => {
  globalThis.fetch = (url, options = {}) => {
    return new Promise((resolve, reject) => {
      const req = http.request(url, options, (res) => {
        let data = [];
        res.on('data', chunk => data.push(chunk));
        res.on('end', () => resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(Buffer.concat(data).toString()),
          json: () => Promise.resolve(JSON.parse(Buffer.concat(data).toString()))
        }));
      });
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  };
});


let ws;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = function() {
        console.log('WebSocket connected');
        reconnectAttempts = 0;
        updateServerStatus('connected');
    };
    
    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        if (data.type === 'userCount') {
            updateUserCount(data.count);
        }
    };
    
    ws.onclose = function() {
        console.log('WebSocket disconnected');
        updateServerStatus('disconnected');
        
        // Attempt to reconnect
        if (reconnectAttempts < maxReconnectAttempts) {
            setTimeout(() => {
                reconnectAttempts++;
                connectWebSocket();
            }, 2000 * reconnectAttempts);
        }
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateServerStatus('error');
    };
}

function updateUserCount(count) {
    const userCountEl = document.getElementById('userCount');
    if (userCountEl) {
        // Animate the count change
        userCountEl.style.transform = 'scale(1.2)';
        userCountEl.textContent = count;
        setTimeout(() => {
            userCountEl.style.transform = 'scale(1)';
        }, 200);
    }
}

function updateServerStatus(status) {
    const statusEl = document.getElementById('serverStatus');
    if (statusEl) {
        statusEl.textContent = status;
        statusEl.className = `server-status ${status}`;
    }
}

// Background animation
function createStars() {
    const container = document.getElementById('bgAnimation');
    const starCount = 100;
    
    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.width = star.style.height = Math.random() * 3 + 1 + 'px';
        star.style.animationDelay = Math.random() * 3 + 's';
        container.appendChild(star);
    }
}

function createParticles() {
    const container = document.getElementById('bgAnimation');
    const particleCount = 20;
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.top = Math.random() * 100 + '%';
        particle.style.width = particle.style.height = Math.random() * 4 + 2 + 'px';
        particle.style.animationDelay = Math.random() * 6 + 's';
        particle.style.animationDuration = (Math.random() * 4 + 4) + 's';
        container.appendChild(particle);
    }
}

// Search functionality
async function performSearch(query) {
    if (!query.trim()) return;
    
    showLoading('Establishing secure connection...');
    
    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: query })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Redirect to the proxied URL
        window.location.href = data.url;
        
    } catch (error) {
        console.error('Search error:', error);
        hideLoading();
        showNotification('Unable to connect. Please try again.', 'error');
    }
}

// Loading overlay
function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    const messageEl = overlay.querySelector('p');
    if (messageEl) messageEl.textContent = message;
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = 'none';
}

// Notification system
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">✕</button>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(74, 222, 128, 0.9)'};
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        border: 1px solid ${type === 'error' ? '#ef4444' : '#4ade80'};
        backdrop-filter: blur(10px);
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: 'Quicksand', sans-serif;
        font-weight: 600;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// Modal functionality
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
        setTimeout(() => {
            modal.style.opacity = '1';
        }, 10);
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

// Settings management
function saveSettings() {
    const settings = {
        encryptionLevel: document.getElementById('encryptionLevel')?.value || 'high',
        userAgent: document.getElementById('userAgent')?.value || 'chrome',
        blockScripts: document.getElementById('blockScripts')?.checked || false,
        hideReferrer: document.getElementById('hideReferrer')?.checked || true
    };
    
    localStorage.setItem('proxySettings', JSON.stringify(settings));
    showNotification('Settings saved successfully!', 'info');
}

function loadSettings() {
    try {
        const settings = JSON.parse(localStorage.getItem('proxySettings') || '{}');
        
        if (document.getElementById('encryptionLevel')) {
            document.getElementById('encryptionLevel').value = settings.encryptionLevel || 'high';
        }
        if (document.getElementById('userAgent')) {
            document.getElementById('userAgent').value = settings.userAgent || 'chrome';
        }
        if (document.getElementById('blockScripts')) {
            document.getElementById('blockScripts').checked = settings.blockScripts || false;
        }
        if (document.getElementById('hideReferrer')) {
            document.getElementById('hideReferrer').checked = settings.hideReferrer !== false;
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Initialize
    createStars();
    createParticles();
    connectWebSocket();
    loadSettings();
    
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                performSearch(this.value);
            }
        });
        
        // Focus animation
        searchInput.addEventListener('focus', function() {
            this.parentElement.style.transform = 'scale(1.02)';
        });
        
        searchInput.addEventListener('blur', function() {
            this.parentElement.style.transform = 'scale(1)';
        });
    }
    
    if (searchBtn) {
        searchBtn.addEventListener('click', function() {
            const query = searchInput?.value;
            if (query) {
                performSearch(query);
            }
        });
    }
    
    // App shortcuts
    document.querySelectorAll('.app').forEach(app => {
        app.addEventListener('click', function(e) {
            e.preventDefault();
            const url = this.getAttribute('data-url');
            if (url) {
                performSearch(url);
            }
        });
    });
    
    // Control buttons
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
        openModal('settingsModal');
    });
    
    document.getElementById('aboutBtn')?.addEventListener('click', () => {
        openModal('aboutModal');
    });
    
    document.getElementById('discordBtn')?.addEventListener('click', () => {
        performSearch('https://discord.gg/your-server-id');
    });
    
    // Modal close buttons
    document.getElementById('closeSettings')?.addEventListener('click', () => {
        saveSettings();
        closeModal('settingsModal');
    });
    
    document.getElementById('closeAbout')?.addEventListener('click', () => {
        closeModal('aboutModal');
    });
    
    // Close modals when clicking outside
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal(this.id);
            }
        });
    });
    
    // Logo click - show info
    document.querySelector('.logo')?.addEventListener('click', () => {
        showNotification('Privacy Proxy v4.0 - Protecting your digital freedom', 'info');
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + K to focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            searchInput?.focus();
        }
        
        // Escape to close modals
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(modal => {
                if (modal.style.display === 'block') {
                    closeModal(modal.id);
                }
            });
        }
    });
    
    // Settings change handlers
    document.getElementById('encryptionLevel')?.addEventListener('change', saveSettings);
    document.getElementById('userAgent')?.addEventListener('change', saveSettings);
    document.getElementById('blockScripts')?.addEventListener('change', saveSettings);
    document.getElementById('hideReferrer')?.addEventListener('change', saveSettings);
    
    // Add some interactive effects
    document.querySelectorAll('.control-btn').forEach(btn => {
        btn.addEventListener('mouseenter', function() {
            this.style.boxShadow = '0 5px 15px rgba(74, 222, 128, 0.3)';
        });
        
        btn.addEventListener('mouseleave', function() {
            this.style.boxShadow = 'none';
        });
    });
    
    // Periodically check connection status
    setInterval(() => {
        if (ws && ws.readyState === WebSocket.CLOSED) {
            updateServerStatus('reconnecting');
            if (reconnectAttempts < maxReconnectAttempts) {
                connectWebSocket();
            }
        }
    }, 5000);
});

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .modal {
        opacity: 0;
        transition: opacity 0.3s ease;
    }
    
    .server-status.connected {
        color: #4ade80;
    }
    
    .server-status.disconnected {
        color: #f59e0b;
    }
    
    .server-status.error {
        color: #ef4444;
    }
    
    .server-status.reconnecting {
        color: #3b82f6;
        animation: pulse 1s infinite;
    }
`;
document.head.appendChild(style);

// Service worker for offline functionality (optional)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js').then(function(registration) {
            console.log('ServiceWorker registration successful');
        }, function(err) {
            console.log('ServiceWorker registration failed');
        });
    });
}
