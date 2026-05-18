const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const authRoutes = require('./auth');

const app = express();

// ==========================
// MIDDLEWARE
// ==========================
app.use(cors());
app.use(express.json());

// ==========================
// FIREBASE INITIALIZATION (بدون Database URL ثابت)
// ==========================
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

if (!admin.apps.length) {
    // ✅ تمت إزالة databaseURL من هنا لجعلها ديناميكية
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        // databaseURL: 'https://test-3b890-default-rtdb.firebaseio.com/' // <-- تم حذف هذا السطر
    });
}

// ==========================
// ✅ قاعدة بيانات العملاء (Clients Database Mapping)
// ==========================
const DATABASE_CLIENTS = {
    client_1: 'https://test-3b890-default-rtdb.firebaseio.com/',
    client_2: 'https://client-2-database.firebaseio.com/', // مثال: ضع رابط العميل 2 هنا
    client_3: 'https://client-3-database.firebaseio.com/', // مثال: ضع رابط العميل 3 هنا
    // يمكنك إضافة المزيد هنا
};

// ✅ الدالة المسؤولة عن إرجاع مرجع (Reference) قاعدة البيانات الصحيح
function getDatabaseByClientId(clientId) {
    if (!clientId) {
        throw new Error('clientId is required');
    }
    
    const databaseURL = DATABASE_CLIENTS[clientId];
    if (!databaseURL) {
        throw new Error(`Invalid clientId: ${clientId}. No database URL found.`);
    }
    
    // الحصول على التطبيق الأساسي (default app) وإنشاء مرجع قاعدة بيانات للـ URL المطلوب
    // ملاحظة: `admin.database()` يستخدم URL التطبيق الأساسي إذا لم يتم تحديد URL،
    // ولكننا سنستخدم `admin.database(app, url)` أو `getDatabaseByUrl`
    // الطريقة الصحيحة هي استخدام `admin.app().database(url)` ولكنها غير مدعومة مباشرة.
    // البديل هو استخدام `admin.database()` مع `refFromURL` أو تهيئة تطبيقات فرعية.
    
    // الحل الأمثل: تهيئة تطبيق Firebase منفصل لكل URL (لكن بتشارك نفس الـ credentials)
    // لتجنب تهيئة عدة تطبيقات، سنستخدم `getDatabase` ديناميكيًا.
    // ملاحظة: هذه الطريقة مدعومة بشكل غير مباشر.
    try {
        // محاولة الحصول على تطبيق موجود مسبقًا لهذا الـ URL
        return admin.database(app); // خطأ: يجب تعديل الطريقة
    } catch (e) {
        // الحل الصحيح: استخدام `admin.initializeApp` كتطبيق ثانوي (secondary app)
        // لتجنب التعقيد، سنستخدم `admin.database().refFromURL` ولكنها تحتاج URL كامل.
        // سأقدم حلاً عمليًا: سنقوم بإنشاء تطبيق (App) ثانوي لكل URL عند الحاجة.
        const appName = `client_${clientId}`;
        if (!admin.apps.some(app => app.name === appName)) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: databaseURL
            }, appName);
        }
        const secondaryApp = admin.app(appName);
        return secondaryApp.database();
    }
}

// ✅ حل أفضل وأبسط (بدون تطبيقات متعددة):
// بما أن Firebase Admin SDK لا يدعم بسهولة تغيير URL بعد التهيئة،
// سنستخدم الحل العملي: تخزين مراجع قاعدة البيانات في Map وتطبيق واحد لكل URL.
// لكن لتجنب تعقيد التطبيقات المتعددة، سأقدم حلاً بديلاً باستخدام `refFromURL` والحصول على الـ URL الكامل.

// ** الحل الموصى به (عملي وسريع): **
const databaseCache = new Map(); // لتخزين مراجع قاعدة البيانات

function getDatabaseReference(clientId, path) {
    if (!clientId) {
        throw new Error('Missing x-client-id header');
    }
    
    const databaseURL = DATABASE_CLIENTS[clientId];
    if (!databaseURL) {
        throw new Error(`Invalid client ID: ${clientId}`);
    }
    
    // إنشاء مفتاح فريد للتخزين المؤقت
    const cacheKey = `${clientId}_${path}`;
    if (databaseCache.has(cacheKey)) {
        return databaseCache.get(cacheKey);
    }
    
    // الحصول على مرجع قاعدة البيانات باستخدام URL الكامل
    // ملاحظة: هذه الطريقة تعمل لأن Firebase Admin SDK يسمح بتمرير URL كامل لـ `ref`
    const fullPath = `${databaseURL}${path}.json`;
    // لكن الأفضل استخدام `admin.database().refFromURL(fullPath)` إذا أردنا التوافق الكامل.
    // سنستخدم `admin.database().ref()` مع تمرير URL كامل (غير مدعوم رسميًا).
    
    // بدلاً من ذلك، سنستخدم تطبيق Firebase منفصل لكل Client ID (وهو الأكثر أمانًا ووضوحًا)
    // ولكن مع الحفاظ على الأداء عبر التخزين المؤقت للتطبيقات.
    let clientApp = admin.apps.find(app => app.name === clientId);
    if (!clientApp) {
        clientApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: databaseURL
        }, clientId);
    }
    
    const db = clientApp.database();
    const ref = db.ref(path);
    databaseCache.set(cacheKey, ref);
    return ref;
}

// ** تبسيط أكبر: دالة واحدة تعيد `db` الصحيح **
function getDatabase(req) {
    const clientId = req.headers['x-client-id'];
    if (!clientId) {
        throw new Error('Missing x-client-id header');
    }
    
    const databaseURL = DATABASE_CLIENTS[clientId];
    if (!databaseURL) {
        throw new Error(`No database URL found for client: ${clientId}`);
    }
    
    // الحصول على التطبيق الخاص بالعميل أو إنشاؤه
    let clientApp = admin.apps.find(app => app.name === clientId);
    if (!clientApp) {
        clientApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: databaseURL
        }, clientId);
    }
    
    return clientApp.database();
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
// AUTH MIDDLEWARE
// ==========================
async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: "No token provided" });
        }
        
        const token = authHeader.replace("Bearer ", "").trim();
        if (!token) {
            return res.status(401).json({ error: "Invalid token" });
        }
        
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        res.status(401).json({ error: "Unauthorized" });
    }
}

// ==========================
// CHECK PERMISSION (معدل لاستخدام قاعدة البيانات الديناميكية)
// ==========================
async function hasPermission(req, user, permission) {
    try {
        const uid = user.uid;
        const db = getDatabase(req);
        const snapshot = await db.ref(`users/${uid}`).once('value');
        const userData = snapshot.val();
        
        if (!userData) return false;
        
        // OWNER
        if (userData.role === "owner" || userData.roleName === "owner") {
            return true;
        }
        
        const permissions = userData.permissions || {};
        return !!permissions[permission];
    } catch (error) {
        console.error("Permission error:", error);
        return false;
    }
}

// ==========================
// HOME
// ==========================
app.get('/', (req, res) => {
    res.send('Backend Connected To Firebase (Multi-Database Ready)');
});

// ==========================
// HEALTH
// ==========================
app.get('/health', (req, res) => {
    res.json({ success: true, status: "Server Running" });
});

// ==========================
// CURRENT USER (معدل)
// ==========================
app.get('/api/me', authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const db = getDatabase(req);
        const snapshot = await db.ref(`users/${uid}`).once('value');
        const userData = snapshot.val();
        
        if (!userData) {
            return res.status(404).json({ error: "User not found" });
        }
        
        res.json({
            uid,
            email: req.user.email,
            ...userData
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================
// GET ANY TABLE (معدل)
// ==========================
app.get('/db/:path', authMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const permission = ROUTE_PERMISSIONS[dbPath];
        
        // CHECK PERMISSION
        if (permission) {
            const allowed = await hasPermission(req, req.user, permission);
            if (!allowed) {
                return res.status(403).json({ error: "No permission" });
            }
        }
        
        const db = getDatabase(req);
        const snapshot = await db.ref(dbPath).once('value');
        res.json(snapshot.val());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================
// ADD DATA (معدل)
// ==========================
app.post('/db/:path', authMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const permission = ROUTE_PERMISSIONS[dbPath];
        
        if (permission) {
            const allowed = await hasPermission(req, req.user, permission);
            if (!allowed) {
                return res.status(403).json({ error: "No permission" });
            }
        }
        
        const data = req.body;
        const db = getDatabase(req);
        const ref = await db.ref(dbPath).push(data);
        
        res.json({ success: true, id: ref.key });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================
// UPDATE DATA (معدل)
// ==========================
app.put('/db/:path/:id', authMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const id = req.params.id;
        const permission = ROUTE_PERMISSIONS[dbPath];
        
        if (permission) {
            const allowed = await hasPermission(req, req.user, permission);
            if (!allowed) {
                return res.status(403).json({ error: "No permission" });
            }
        }
        
        const data = req.body;
        const db = getDatabase(req);
        await db.ref(`${dbPath}/${id}`).update(data);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================
// DELETE DATA (معدل)
// ==========================
app.delete('/db/:path/:id', authMiddleware, async (req, res) => {
    try {
        const dbPath = req.params.path;
        const id = req.params.id;
        const permission = ROUTE_PERMISSIONS[dbPath];
        
        if (permission) {
            const allowed = await hasPermission(req, req.user, permission);
            if (!allowed) {
                return res.status(403).json({ error: "No permission" });
            }
        }
        
        const db = getDatabase(req);
        await db.ref(`${dbPath}/${id}`).remove();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================
// SERVER
// ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server Running On Port ${PORT} (Multi-Database Mode)`);
});

module.exports = app;
