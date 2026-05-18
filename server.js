const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const axios = require('axios'); // ✅ هتحتاج تنصب axios

const authRoutes = require('./auth');

const app = express();

// ==========================
// MIDDLEWARE
// ==========================

app.use(cors());
app.use(express.json());

// ==========================
// FIREBASE (BASE CONFIG)
// ==========================

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

// Store database instances by URL
const dbInstances = new Map();

function getDatabaseInstance(databaseURL) {
    if (!dbInstances.has(databaseURL)) {
        const app = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: databaseURL
        }, databaseURL); // Use URL as unique name
        
        dbInstances.set(databaseURL, app.database());
    }
    return dbInstances.get(databaseURL);
}

// ==========================
// LICENSE MIDDLEWARE (NEW)
// ==========================

async function verifyLicense(req, res, next) {
    try {
        const licenseCode = req.headers['x-license-code'] || req.query.code;
        
        if (!licenseCode) {
            return res.status(401).json({
                error: "License code required in header 'x-license-code'"
            });
        }

        // Check cache first (optional, 5 minutes cache)
        if (global.licenseCache && global.licenseCache[licenseCode] && 
            (Date.now() - global.licenseCache[licenseCode].timestamp) < 300000) {
            req.licenseData = global.licenseCache[licenseCode].data;
            req.db = getDatabaseInstance(req.licenseData.database.url);
            return next();
        }

        // Fetch from Google Script
        const response = await axios.get(`https://script.google.com/macros/s/AKfycbyztFTOFHunQKahA99RskXGKx6Sh9CUCLwij8gwHqDd0UUblmJ6DCzzGfAMCXf7iS1P/exec`, {
            params: { code: licenseCode }
        });

        if (!response.data.success) {
            return res.status(403).json({
                error: "Invalid license code"
            });
        }

        const licenseData = response.data;
        
        // Check if license is active
        if (licenseData.data.Status !== "Active") {
            return res.status(403).json({
                error: "License is not active"
            });
        }

        // Cache license data
        if (!global.licenseCache) global.licenseCache = {};
        global.licenseCache[licenseCode] = {
            data: licenseData,
            timestamp: Date.now()
        };

        req.licenseData = licenseData;
        req.db = getDatabaseInstance(licenseData.database.url);
        
        next();

    } catch (error) {
        console.error("License verification error:", error.message);
        res.status(500).json({
            error: "License verification failed"
        });
    }
}

// ==========================
// AUTH API
// ==========================
app.all('/api/auth/*', async (req, res) => {
    return await authRoutes(req, res);
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
    shipping: "view_shipping"
};

// ==========================
// AUTH MIDDLEWARE (Modified to use dynamic DB)
// ==========================

async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                error: "No token provided"
            });
        }

        const token = authHeader.replace("Bearer ", "").trim();

        if (!token) {
            return res.status(401).json({
                error: "Invalid token"
            });
        }

        // Use the dynamic database from license middleware
        const dbToUse = req.db;
        
        if (!dbToUse) {
            return res.status(500).json({
                error: "Database not initialized"
            });
        }

        // Need to verify against Firebase Auth (this is global, not per database)
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        req.db = dbToUse; // Pass database to routes

        next();

    } catch (error) {
        res.status(401).json({
            error: "Unauthorized"
        });
    }
}

// ==========================
// CHECK PERMISSION (Modified to use dynamic DB)
// ==========================

async function hasPermission(req, permission) {
    try {
        const uid = req.user.uid;
        const db = req.db;

        const snapshot = await db
            .ref(`users/${uid}`)
            .once('value');

        const userData = snapshot.val();

        if (!userData) {
            return false;
        }

        // OWNER
        if (
            userData.role === "owner" ||
            userData.roleName === "owner"
        ) {
            return true;
        }

        const permissions = userData.permissions || {};

        return !!permissions[permission];

    } catch (error) {
        return false;
    }
}

// ==========================
// HOME
// ==========================

app.get('/', (req, res) => {
    res.send('Backend Connected To Firebase - License System Active');
});

// ==========================
// HEALTH (Modified to show license info)
// ==========================

app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: "Server Running",
        activeDatabases: dbInstances.size
    });
});

// ==========================
// CURRENT USER (Modified)
// ==========================

app.get('/api/me', verifyLicense, authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const db = req.db;

        const snapshot = await db.ref(`users/${uid}`).once('value');
        const userData = snapshot.val();

        if (!userData) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        res.json({
            uid,
            email: req.user.email,
            license: {
                code: req.licenseData.data.الكود,
                type: req.licenseData.data.نوع_الاشتراك,
                expiresIn: req.licenseData.data.عدد_الايام_اللي_ناقصه
            },
            ...userData
        });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// ==========================
// GET ANY TABLE (Modified)
// ==========================

app.get('/db/:path', verifyLicense, authMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const permission = ROUTE_PERMISSIONS[dbPath];
        const db = req.db;

        // CHECK PERMISSION
        if (permission) {
            const allowed = await hasPermission(req, permission);
            if (!allowed) {
                return res.status(403).json({
                    error: "No permission"
                });
            }
        }

        const snapshot = await db.ref(dbPath).once('value');
        res.json(snapshot.val());

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// ==========================
// ADD DATA (Modified)
// ==========================

app.post('/db/:path', verifyLicense, authMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const permission = ROUTE_PERMISSIONS[dbPath];
        const db = req.db;
        const data = req.body;

        // CHECK PERMISSION
        if (permission) {
            const allowed = await hasPermission(req, permission);
            if (!allowed) {
                return res.status(403).json({
                    error: "No permission"
                });
            }
        }

        // Check limits from license
        const limits = req.licenseData.limits || {};
        if (limits[dbPath] !== undefined) {
            const snapshot = await db.ref(dbPath).once('value');
            const currentCount = snapshot.val() ? Object.keys(snapshot.val()).length : 0;
            if (currentCount >= limits[dbPath]) {
                return res.status(429).json({
                    error: `Limit reached for ${dbPath}. Maximum: ${limits[dbPath]}`
                });
            }
        }

        const ref = await db.ref(dbPath).push(data);
        res.json({
            success: true,
            id: ref.key
        });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// ==========================
// UPDATE DATA (Modified)
// ==========================

app.put('/db/:path/:id', verifyLicense, authMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const id = req.params.id;
        const permission = ROUTE_PERMISSIONS[dbPath];
        const db = req.db;
        const data = req.body;

        if (permission) {
            const allowed = await hasPermission(req, permission);
            if (!allowed) {
                return res.status(403).json({
                    error: "No permission"
                });
            }
        }

        await db.ref(`${dbPath}/${id}`).update(data);
        res.json({ success: true });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// ==========================
// DELETE DATA (Modified)
// ==========================

app.delete('/db/:path/:id', verifyLicense, authMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const id = req.params.id;
        const permission = ROUTE_PERMISSIONS[dbPath];
        const db = req.db;

        if (permission) {
            const allowed = await hasPermission(req, permission);
            if (!allowed) {
                return res.status(403).json({
                    error: "No permission"
                });
            }
        }

        await db.ref(`${dbPath}/${id}`).remove();
        res.json({ success: true });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// ==========================
// LICENSE INFO ENDPOINT (NEW)
// ==========================

app.get('/api/license/info', verifyLicense, async (req, res) => {
    res.json({
        success: true,
        license: {
            code: req.licenseData.data.الكود,
            startDate: req.licenseData.data.تاريخ_البدايه,
            daysLeft: req.licenseData.data.عدد_الايام_اللي_ناقصه,
            status: req.licenseData.data.Status,
            user: req.licenseData.data.User,
            type: req.licenseData.data.نوع_الاشتراك
        },
        limits: req.licenseData.limits,
        database: req.licenseData.database
    });
});

// ==========================
// SERVER
// ==========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server Running On Port ${PORT}`);
    console.log(`License System Ready - Dynamic Database Support`);
});

module.exports = app;
