const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();

// ==========================
// ENV
// ==========================

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET Missing');
}

// ==========================
// MIDDLEWARE
// ==========================

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

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
// ROUTE PERMISSIONS
// ==========================

const ROUTE_PERMISSIONS = {

    employees: {
        view: 'employees_view',
        create: 'employees_create',
        update: 'employees_update',
        delete: 'employees_delete'
    },

    invoices: {
        view: 'invoices_view',
        create: 'invoices_create',
        update: 'invoices_update',
        delete: 'invoices_delete'
    },

    tasks: {
        view: 'tasks_view',
        create: 'tasks_create',
        update: 'tasks_update',
        delete: 'tasks_delete'
    },

    customers: {
        view: 'customers_view',
        create: 'customers_create',
        update: 'customers_update',
        delete: 'customers_delete'
    },

    products: {
        view: 'products_view',
        create: 'products_create',
        update: 'products_update',
        delete: 'products_delete'
    }

};

// ==========================
// HELPERS
// ==========================

function generateToken(user) {

    return jwt.sign({
        uid: user.id,
        role: user.role,
        roleName: user.roleName,
        name: user.name
    }, JWT_SECRET, {
        expiresIn: '7d'
    });

}

async function getUserByUsername(username) {

    const snapshot = await db.ref('users').once('value');

    const users = snapshot.val() || {};

    const usersArray = Object.entries(users).map(([id, value]) => ({
        id,
        ...value
    }));

    return usersArray.find(user =>
        user.username === username ||
        user.email === username
    );

}

async function hasPermission(user, permission) {

    try {

        const snapshot = await db
            .ref(`users/${user.uid}`)
            .once('value');

        const userData = snapshot.val();

        if (!userData) {
            return false;
        }

        if (
            userData.role === 'owner' ||
            userData.roleName === 'owner'
        ) {
            return true;
        }

        const permissions = userData.permissions || {};

        return !!permissions[permission];

    } catch (error) {

        return false;

    }

}

function getPermission(path, action) {

    if (!ROUTE_PERMISSIONS[path]) {
        return null;
    }

    return ROUTE_PERMISSIONS[path][action];

}

// ==========================
// AUTH MIDDLEWARE
// ==========================

async function authMiddleware(req, res, next) {

    try {

        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: 'No token provided'
            });
        }

        const token = authHeader.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            error: 'Unauthorized'
        });

    }

}

// ==========================
// HOME
// ==========================

app.get('/', (req, res) => {

    res.send('Backend Running Successfully');

});

// ==========================
// HEALTH
// ==========================

app.get('/health', (req, res) => {

    res.json({
        success: true,
        status: 'Server Running'
    });

});

// ==========================
// SIGNIN
// ==========================

app.post('/api/auth/signin', async (req, res) => {

    try {

        const {
            username,
            password,
            licenseCode
        } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password required'
            });
        }

        const user = await getUserByUsername(username);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        if (user.active === false) {
            return res.status(403).json({
                success: false,
                message: 'User disabled'
            });
        }

        const passwordMatched = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatched) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const token = generateToken(user);

        return res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                roleName: user.roleName,
                permissions: user.permissions || {},
                licenseCode
            }
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

});

// ==========================
// CURRENT USER
// ==========================

app.get('/api/auth/me', authMiddleware, async (req, res) => {

    try {

        const snapshot = await db
            .ref(`users/${req.user.uid}`)
            .once('value');

        const user = snapshot.val();

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        return res.json({
            success: true,
            user: {
                id: req.user.uid,
                name: user.name,
                role: user.role,
                roleName: user.roleName,
                permissions: user.permissions || {}
            }
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            error: error.message
        });

    }

});

// ==========================
// GET DATA
// ==========================

app.get('/db/:path', authMiddleware, async (req, res) => {

    try {

        const dbPath = req.params.path;

        const permission = getPermission(dbPath, 'view');

        if (permission) {

            const allowed = await hasPermission(
                req.user,
                permission
            );

            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    error: 'No permission'
                });
            }

        }

        const snapshot = await db.ref(dbPath).once('value');

        let data = snapshot.val() || {};

        // DATA SCOPING
        if (req.user.role !== 'owner') {

            if (dbPath === 'invoices') {

                data = Object.fromEntries(
                    Object.entries(data).filter(([id, item]) =>
                        item.salesEmployeeId === req.user.uid
                    )
                );

            }

            if (dbPath === 'tasks') {

                data = Object.fromEntries(
                    Object.entries(data).filter(([id, item]) =>
                        item.assignedTo === req.user.uid ||
                        item.createdBy === req.user.uid
                    )
                );

            }

            if (dbPath === 'customers') {

                data = Object.fromEntries(
                    Object.entries(data).filter(([id, item]) =>
                        item.employeeId === req.user.uid
                    )
                );

            }

        }

        return res.json({
            success: true,
            data
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            error: error.message
        });

    }

});

// ==========================
// CREATE DATA
// ==========================

app.post('/db/:path', authMiddleware, async (req, res) => {

    try {

        const dbPath = req.params.path;

        const permission = getPermission(dbPath, 'create');

        if (permission) {

            const allowed = await hasPermission(
                req.user,
                permission
            );

            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    error: 'No permission'
                });
            }

        }

        const data = {
            ...req.body,
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid
        };

        const ref = await db.ref(dbPath).push(data);

        return res.json({
            success: true,
            id: ref.key
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
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

        const permission = getPermission(dbPath, 'update');

        if (permission) {

            const allowed = await hasPermission(
                req.user,
                permission
            );

            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    error: 'No permission'
                });
            }

        }

        await db
            .ref(`${dbPath}/${id}`)
            .update({
                ...req.body,
                updatedAt: new Date().toISOString(),
                updatedBy: req.user.uid
            });

        return res.json({
            success: true
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
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

        const permission = getPermission(dbPath, 'delete');

        if (permission) {

            const allowed = await hasPermission(
                req.user,
                permission
            );

            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    error: 'No permission'
                });
            }

        }

        await db.ref(`${dbPath}/${id}`).remove();

        return res.json({
            success: true
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
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
