const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();


// ==========================
// MIDDLEWARE
// ==========================

app.use(cors());

app.use(express.json());


// ==========================
// FIREBASE
// ==========================

const serviceAccount = require('./firebase-admin.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://test-3b890-default-rtdb.firebaseio.com/'
});

const db = admin.database();


// ==========================
// HOME
// ==========================

app.get('/', (req, res) => {

    res.send('Backend Connected To Firebase');

});


// ==========================
// GET ANY TABLE
// Example:
// /db/employees
// /db/invoices
// /db/products
// ==========================

app.get('/db/:path', async (req, res) => {

    try {

        const dbPath = req.params.path;

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

app.post('/db/:path', async (req, res) => {

    try {

        const dbPath = req.params.path;

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

app.put('/db/:path/:id', async (req, res) => {

    try {

        const dbPath = req.params.path;

        const id = req.params.id;

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

app.delete('/db/:path/:id', async (req, res) => {

    try {

        const dbPath = req.params.path;

        const id = req.params.id;

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