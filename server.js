const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const crypto = require('crypto');

const authRoutes = require('./auth');

const app = express();

// ==========================
// SECURITY CONFIGURATION
// ==========================

// Trust proxy for secure cookies (if behind reverse proxy)
app.set('trust proxy', 1);

// CSP Headers
const CSP_HEADERS = {
    'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://kit.fontawesome.com",
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
        "font-src 'self' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
        "connect-src 'self' https://backend-clean-nine.vercel.app",
        "img-src 'self' data: https:"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
};

// Apply security headers
app.use((req, res, next) => {
    Object.entries(CSP_HEADERS).forEach(([header, value]) => {
        res.setHeader(header, value);
    });
    next();
});

// ==========================
// CORS CONFIGURATION (SECURE)
// ==========================

const allowedOrigins = [
    'http://localhost:5500',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'https://your-domain.com',
    'https://your-frontend.vercel.app'
];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else {
            callback(new Error('CORS not allowed'), false);
        }
    },
    credentials: true, // Allow cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
    exposedHeaders: ['X-CSRF-Token'],
    maxAge: 86400 // 24 hours
}));

app.use(express.json());

// ==========================
// HELPER: GENERATE CSRF TOKEN
// ==========================

function generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ==========================
// CSRF MIDDLEWARE
// ==========================

const csrfTokens = new Map(); // Store tokens with expiration

function csrfMiddleware(req, res, next) {
    // Skip CSRF for GET, HEAD, OPTIONS requests
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    }
    
    // Skip CSRF for auth endpoints
    if (req.path.startsWith('/api/auth/')) {
        return next();
    }
    
    const clientToken = req.headers['x-csrf-token'];
    const userId = req.user?.uid;
    
    if (!userId) {
        return res.status(403).json({ error: 'User not authenticated for CSRF validation' });
    }
    
    const storedToken = csrfTokens.get(userId);
    
    if (!storedToken || storedToken.token !== clientToken) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    
    // Check if token expired (24 hours)
    if (Date.now() > storedToken.expiresAt) {
        csrfTokens.delete(userId);
        return res.status(403).json({ error: 'CSRF token expired' });
    }
    
    next();
}

// ==========================
// FIREBASE
// ==========================

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://test-3b890-default-rtdb.firebaseio.com/'
    });
}

const db = admin.database();

// Store refresh tokens (in production, use a more persistent store)
const refreshTokens = new Map();

// ==========================
// JWT HELPERS
// ==========================

function generateAccessToken(uid, userData) {
    // Create a custom token with expiration (1 hour)
    return admin.auth().createCustomToken(uid, {
        ...userData,
        exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
    });
}

function generateRefreshToken(uid) {
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
    
    refreshTokens.set(uid, {
        token,
        expiresAt,
        createdAt: Date.now()
    });
    
    return token;
}

function validateRefreshToken(uid, token) {
    const stored = refreshTokens.get(uid);
    if (!stored || stored.token !== token) {
        return false;
    }
    if (Date.now() > stored.expiresAt) {
        refreshTokens.delete(uid);
        return false;
    }
    return true;
}

function revokeRefreshToken(uid) {
    refreshTokens.delete(uid);
}

// ==========================
// AUTH API
// ==========================

// Sign In with Refresh Token support
app.post('/api/auth/signin', async (req, res) => {
    try {
        const { username, password, licenseCode } = req.body;
        
        // Forward to auth routes
        const authResult = await authRoutes(req, res);
        
        // If auth successful, generate refresh token and CSRF token
        if (res.statusCode === 200 && req.user) {
            const refreshToken = generateRefreshToken(req.user.uid);
            const csrfToken = generateCSRFToken();
            
            // Store CSRF token for user
            csrfTokens.set(req.user.uid, {
                token: csrfToken,
                expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
            });
            
            // Set refresh token as HttpOnly cookie
            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
                path: '/'
            });
            
            // Set CSRF token in response header
            res.setHeader('X-CSRF-Token', csrfToken);
            
            // Generate access token
            const accessToken = await generateAccessToken(req.user.uid, req.user);
            
            return res.json({
                success: true,
                accessToken: accessToken,
                user: {
                    uid: req.user.uid,
                    email: req.user.email,
                    name: req.user.name
                }
            });
        }
        
        return authResult;
    } catch (error) {
        console.error('Signin error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Refresh Token endpoint
app.post('/api/auth/refresh', async (req, res) => {
    try {
        const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
        
        if (!refreshToken) {
            return res.status(401).json({ success: false, error: 'No refresh token provided' });
        }
        
        // Get user from refresh token
        let userId = null;
        for (const [uid, data] of refreshTokens.entries()) {
            if (data.token === refreshToken) {
                userId = uid;
                break;
            }
        }
        
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Invalid refresh token' });
        }
        
        // Validate token
        if (!validateRefreshToken(userId, refreshToken)) {
            return res.status(401).json({ success: false, error: 'Refresh token expired or invalid' });
        }
        
        // Get user data
        const snapshot = await db.ref(`users/${userId}`).once('value');
        const userData = snapshot.val();
        
        if (!userData) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }
        
        // Generate new access token
        const newAccessToken = await generateAccessToken(userId, {
            uid: userId,
            email: userData.email,
            name: userData.name,
            role: userData.role
        });
        
        // Generate new CSRF token
        const newCsrfToken = generateCSRFToken();
        csrfTokens.set(userId, {
            token: newCsrfToken,
            expiresAt: Date.now() + (24 * 60 * 60 * 1000)
        });
        
        res.setHeader('X-CSRF-Token', newCsrfToken);
        
        res.json({
            success: true,
            accessToken: newAccessToken
        });
        
    } catch (error) {
        console.error('Refresh token error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Sign Out endpoint
app.post('/api/auth/signout', async (req, res) => {
    try {
        const userId = req.user?.uid;
        
        if (userId) {
            // Revoke refresh token
            revokeRefreshToken(userId);
            // Remove CSRF token
            csrfTokens.delete(userId);
        }
        
        // Clear refresh token cookie
        res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/'
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Signout error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify License endpoint
app.post('/api/auth/verify-license', async (req, res) => {
    try {
        const { licenseCode } = req.body;
        
        if (!licenseCode) {
            return res.status(400).json({ success: false, error: 'License code required' });
        }
        
        // Verify license in database
        const snapshot = await db.ref('licenses').orderByChild('code').equalTo(licenseCode).once('value');
        const licenseData = snapshot.val();
        
        if (!licenseData) {
            return res.status(401).json({ success: false, error: 'Invalid license code' });
        }
        
        // Check expiration
        const now = Date.now();
        const license = Object.values(licenseData)[0];
        
        if (license.expiryDate && new Date(license.expiryDate).getTime() < now) {
            return res.status(401).json({ success: false, error: 'License expired' });
        }
        
        res.json({
            success: true,
            license: {
                code: licenseCode,
                status: license.status || 'active',
                expiryDate: license.expiryDate,
                type: license.type
            }
        });
        
    } catch (error) {
        console.error('Verify license error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/api/auth/health', async (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Forward all other auth routes
app.all('/api/auth/*', async (req, res) => {
    try {
        await authRoutes(req, res);
    } catch (error) {
        console.error('Auth route error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================
// ROUTE PERMISSIONS
// ==========================

const ROUTE_PERMISSIONS = {
    employees: "view_employees",
    invoices: "view_invoice_done",
    products: "view_products",
    users: "view_users",
    orders: "view_orders",
    suppliers: "view_suppliers",
    stock: "view_stock",
    tasks: "view_tasks",
    shipping: "view_shipping",
    settings: "view_settings",
    navigationUrls: "view_settings",
    'design-system': "view_settings"
};

// ==========================
// AUTH MIDDLEWARE (ENHANCED)
// ==========================

async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({
                error: "No token provided",
                code: "MISSING_TOKEN"
            });
        }
        
        const token = authHeader.split("Bearer ")[1];
        
        if (!token) {
            return res.status(401).json({
                error: "Invalid token format",
                code: "INVALID_TOKEN"
            });
        }
        
        // Verify Firebase token
        const decodedToken = await admin.auth().verifyIdToken(token);
        
        // Check if token is expired
        const currentTime = Math.floor(Date.now() / 1000);
        if (decodedToken.exp && decodedToken.exp < currentTime) {
            return res.status(401).json({
                error: "Token expired",
                code: "TOKEN_EXPIRED"
            });
        }
        
        // Get user data from database
        const snapshot = await db.ref(`users/${decodedToken.uid}`).once('value');
        const userData = snapshot.val();
        
        if (!userData) {
            return res.status(401).json({
                error: "User not found",
                code: "USER_NOT_FOUND"
            });
        }
        
        // Check if user is active
        if (userData.status === 'inactive' || userData.status === 'suspended') {
            return res.status(403).json({
                error: "Account is suspended",
                code: "ACCOUNT_SUSPENDED"
            });
        }
        
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            ...userData
        };
        
        next();
        
    } catch (error) {
        console.error('Auth middleware error:', error);
        
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({
                error: "Token expired",
                code: "TOKEN_EXPIRED"
            });
        }
        
        res.status(401).json({
            error: "Unauthorized",
            code: "UNAUTHORIZED"
        });
    }
}

// ==========================
// CHECK PERMISSION (ENHANCED)
// ==========================

async function hasPermission(user, permission) {
    try {
        const uid = user.uid;
        
        const snapshot = await db
            .ref(`users/${uid}`)
            .once('value');
        
        const userData = snapshot.val();
        
        if (!userData) {
            return false;
        }
        
        // OWNER or ADMIN - full access
        if (
            userData.role === "owner" ||
            userData.role === "admin" ||
            userData.roleName === "owner" ||
            userData.roleName === "admin"
        ) {
            return true;
        }
        
        const permissions = userData.permissions || {};
        
        return !!permissions[permission];
        
    } catch (error) {
        console.error('Permission check error:', error);
        return false;
    }
}

// ==========================
// HOME
// ==========================

app.get('/', (req, res) => {
    res.json({
        message: 'Backend Connected To Firebase',
        version: '2.0.0',
        endpoints: {
            health: '/health',
            auth: '/api/auth/*',
            db: '/db/:path'
        }
    });
});

// ==========================
// HEALTH
// ==========================

app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: "Server Running",
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ==========================
// CSRF TOKEN ENDPOINT
// ==========================

app.get('/api/csrf-token', authMiddleware, async (req, res) => {
    try {
        let csrfToken = csrfTokens.get(req.user.uid)?.token;
        
        if (!csrfToken) {
            csrfToken = generateCSRFToken();
            csrfTokens.set(req.user.uid, {
                token: csrfToken,
                expiresAt: Date.now() + (24 * 60 * 60 * 1000)
            });
        }
        
        res.json({
            success: true,
            csrfToken: csrfToken
        });
    } catch (error) {
        console.error('CSRF token error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================
// GET ANY TABLE (ENHANCED)
// ==========================

app.get('/db/:path', authMiddleware, csrfMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        
        // Validate path to prevent path traversal
        if (dbPath.includes('..') || dbPath.includes('//')) {
            return res.status(400).json({ error: "Invalid path" });
        }
        
        const permission = ROUTE_PERMISSIONS[dbPath];
        
        // CHECK PERMISSION
        if (permission) {
            const allowed = await hasPermission(req.user, permission);
            if (!allowed) {
                return res.status(403).json({
                    error: "No permission",
                    required: permission
                });
            }
        }
        
        const snapshot = await db.ref(dbPath).once('value');
        const data = snapshot.val();
        
        // Log access for audit
        console.log(`📊 GET /db/${dbPath} - User: ${req.user.uid}`);
        
        res.json({
            success: true,
            data: data,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('GET error:', error);
        res.status(500).json({
            error: error.message,
            code: "DATABASE_ERROR"
        });
    }
});

// ==========================
// ADD DATA (ENHANCED)
// ==========================

app.post('/db/:path', authMiddleware, csrfMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        
        // Validate path
        if (dbPath.includes('..') || dbPath.includes('//')) {
            return res.status(400).json({ error: "Invalid path" });
        }
        
        const permission = ROUTE_PERMISSIONS[dbPath];
        
        // CREATE PERMISSION
        if (permission) {
            const allowed = await hasPermission(req.user, permission);
            if (!allowed) {
                return res.status(403).json({
                    error: "No permission",
                    required: permission
                });
            }
        }
        
        const data = req.body;
        
        // Add metadata
        data.createdAt = new Date().toISOString();
        data.createdBy = req.user.uid;
        
        const ref = await db.ref(dbPath).push(data);
        
        console.log(`📝 POST /db/${dbPath} - User: ${req.user.uid} - ID: ${ref.key}`);
        
        res.json({
            success: true,
            id: ref.key,
            createdAt: data.createdAt
        });
        
    } catch (error) {
        console.error('POST error:', error);
        res.status(500).json({
            error: error.message,
            code: "DATABASE_ERROR"
        });
    }
});

// ==========================
// UPDATE DATA (ENHANCED)
// ==========================

app.put('/db/:path/:id', authMiddleware, csrfMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const id = req.params.id;
        
        // Validate path and id
        if (dbPath.includes('..') || dbPath.includes('//') || id.includes('..')) {
            return res.status(400).json({ error: "Invalid path or id" });
        }
        
        const permission = ROUTE_PERMISSIONS[dbPath];
        
        // UPDATE PERMISSION
        if (permission) {
            const allowed = await hasPermission(req.user, permission);
            if (!allowed) {
                return res.status(403).json({
                    error: "No permission",
                    required: permission
                });
            }
        }
        
        const data = req.body;
        
        // Add metadata
        data.updatedAt = new Date().toISOString();
        data.updatedBy = req.user.uid;
        
        await db.ref(`${dbPath}/${id}`).update(data);
        
        console.log(`✏️ PUT /db/${dbPath}/${id} - User: ${req.user.uid}`);
        
        res.json({
            success: true,
            updatedAt: data.updatedAt
        });
        
    } catch (error) {
        console.error('PUT error:', error);
        res.status(500).json({
            error: error.message,
            code: "DATABASE_ERROR"
        });
    }
});

// ==========================
// DELETE DATA (ENHANCED)
// ==========================

app.delete('/db/:path/:id', authMiddleware, csrfMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const id = req.params.id;
        
        // Validate path and id
        if (dbPath.includes('..') || dbPath.includes('//') || id.includes('..')) {
            return res.status(400).json({ error: "Invalid path or id" });
        }
        
        const permission = ROUTE_PERMISSIONS[dbPath];
        
        // DELETE PERMISSION
        if (permission) {
            const allowed = await hasPermission(req.user, permission);
            if (!allowed) {
                return res.status(403).json({
                    error: "No permission",
                    required: permission
                });
            }
        }
        
        // Check if item exists before deletion
        const snapshot = await db.ref(`${dbPath}/${id}`).once('value');
        if (!snapshot.exists()) {
            return res.status(404).json({ error: "Item not found" });
        }
        
        await db.ref(`${dbPath}/${id}`).remove();
        
        console.log(`🗑️ DELETE /db/${dbPath}/${id} - User: ${req.user.uid}`);
        
        res.json({
            success: true,
            deletedAt: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('DELETE error:', error);
        res.status(500).json({
            error: error.message,
            code: "DATABASE_ERROR"
        });
    }
});

// ==========================
// BATCH OPERATIONS (NEW)
// ==========================

app.post('/db/:path/batch', authMiddleware, csrfMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const { operation, ids, data } = req.body;
        
        // Validate path
        if (dbPath.includes('..') || dbPath.includes('//')) {
            return res.status(400).json({ error: "Invalid path" });
        }
        
        const permission = ROUTE_PERMISSIONS[dbPath];
        
        if (permission) {
            const allowed = await hasPermission(req.user, permission);
            if (!allowed) {
                return res.status(403).json({ error: "No permission" });
            }
        }
        
        const updates = {};
        const timestamp = new Date().toISOString();
        
        switch (operation) {
            case 'delete':
                ids.forEach(id => {
                    updates[`${dbPath}/${id}`] = null;
                });
                break;
            case 'update':
                ids.forEach(id => {
                    updates[`${dbPath}/${id}`] = {
                        ...data,
                        updatedAt: timestamp,
                        updatedBy: req.user.uid
                    };
                });
                break;
            default:
                return res.status(400).json({ error: "Invalid batch operation" });
        }
        
        await db.ref().update(updates);
        
        console.log(`📦 BATCH ${operation} /db/${dbPath} - User: ${req.user.uid} - Count: ${ids.length}`);
        
        res.json({
            success: true,
            operation,
            count: ids.length,
            timestamp
        });
        
    } catch (error) {
        console.error('Batch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================
// ERROR HANDLING MIDDLEWARE
// ==========================

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
    });
});

// ==========================
// 404 HANDLER
// ==========================

app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
    });
});

// ==========================
// SERVER
// ==========================

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log(`🚀 Server Running On Port ${PORT}`);
    console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🛡️ Security: CSP, CSRF, HttpOnly Cookies enabled`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = app;
