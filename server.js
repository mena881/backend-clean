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


// ==========================
// AUTH API
// ==========================

app.use('/api/auth', authRoutes);


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

            return res.status(401).json({
                error: "No token provided"
            });

        }

        const token = authHeader.split("Bearer ")[1];

        if (!token) {

            return res.status(401).json({
                error: "Invalid token"
            });

        }

        const decodedToken = await admin.auth().verifyIdToken(token);

        req.user = decodedToken;

        next();

    } catch (error) {

        res.status(401).json({
            error: "Unauthorized"
        });

    }

}


// ==========================
// CHECK PERMISSION
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

    res.send('Backend Connected To Firebase');

});


// ==========================
// HEALTH
// ==========================

app.get('/health', (req, res) => {

    res.json({
        success: true,
        status: "Server Running"
    });

});


// ==========================
// GET ANY TABLE
// ==========================

app.get('/db/:path', authMiddleware, async (req, res) => {

    try {

        const dbPath = req.params.path;

        const permission = ROUTE_PERMISSIONS[dbPath];

        // CHECK PERMISSION
        if (permission) {

            const allowed = await hasPermission(req.user, permission);

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
// ADD DATA
// ==========================

app.post('/db/:path', authMiddleware, async (req, res) => {

    try {

        const dbPath = req.params.path;

        const permission = ROUTE_PERMISSIONS[dbPath];

        // CREATE PERMISSION
        if (permission) {

            const allowed = await hasPermission(req.user, permission);

            if (!allowed) {

                return res.status(403).json({
                    error: "No permission"
                });

            }

        }

        const data = req.body;

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
// UPDATE DATA
// ==========================

app.put('/db/:path/:id', authMiddleware, async (req, res) => {

    try {

        const dbPath = req.params.path;

        const id = req.params.id;

        const permission = ROUTE_PERMISSIONS[dbPath];

        // UPDATE PERMISSION
        if (permission) {

            const allowed = await hasPermission(req.user, permission);

            if (!allowed) {

                return res.status(403).json({
                    error: "No permission"
                });

            }

        }

        const data = req.body;

        await db.ref(`${dbPath}/${id}`).update(data);

        res.json({
            success: true
        });

    } catch (error) {

        res.status(500).json({
            error: error.message
        });

    }

});


// ==========================
// DELETE DATA
// ==========================

app.delete('/db/:path/:id', authMiddleware, async (req, res) => {

    try {

        const dbPath = req.params.path;

        const id = req.params.id;

        const permission = ROUTE_PERMISSIONS[dbPath];

        // DELETE PERMISSION
        if (permission) {

            const allowed = await hasPermission(req.user, permission);

            if (!allowed) {

                return res.status(403).json({
                    error: "No permission"
                });

            }

        }

        await db.ref(`${dbPath}/${id}`).remove();

        res.json({
            success: true
        });

    } catch (error) {

        res.status(500).json({
            error: error.message
        });

    }

});


// ==========================
// SERVER
// ==========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(`Server Running On Port ${PORT}`);

});

module.exports = app;
