require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const ejs = require('ejs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATATRANS_API_KEY = process.env.DATATRANS_API_KEY;
const DATATRANS_MERCHANT_ID = process.env.DATATRANS_MERCHANT_ID;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;
const DATATRANS_API_URL = process.env.DATATRANS_API_URL;

// --- Data Store ---
// In-memory store. For persistence, use SQLite, JSON file, Firebase, etc.
let songRequests = [
    // { id: 'uuid1', name: 'Test User', songTitle: 'Sample Song 1', timestamp: new Date(Date.now() - 3600000), played: true, transactionId: 'test-tx-1' },
    // { id: 'uuid2', name: 'Another User', songTitle: 'Sample Song 2', timestamp: new Date(), played: false, transactionId: 'test-tx-2' }
];
let transactions = {}; // { internalRefno: { datatransTransactionId, status, songData, timestamp } }

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Datatrans API Helper ---
const datatransApi = axios.create({
    baseURL: DATATRANS_API_URL,
    auth: { username: DATATRANS_MERCHANT_ID, password: DATATRANS_API_KEY },
    headers: { 'Content-Type': 'application/json' },
});

// --- API Routes for Song Requests ---

// GET all songs (primarily for admin, could be filtered for queue)
app.get('/api/songs', (req, res) => {
    // For admin, we might want all details. For queue, we'd filter.
    // Here, we provide all and let admin client-side handle if needed.
    const sortedRequests = [...songRequests].sort((a, b) => b.timestamp - a.timestamp);
    res.json(sortedRequests);
});

// POST to mark a song as played
app.put('/api/songs/mark-played/:id', (req, res) => {
    // Basic protection: Could check for admin key if this endpoint were public,
    // but it's called from admin page JS, which is already key-protected.
    const { id } = req.params;
    const song = songRequests.find(s => s.id === id);
    if (song) {
        song.played = true;
        console.log(`Song marked as played: ${song.songTitle} (ID: ${id})`);
        res.json({ message: 'Song marked as played', song });
    } else {
        res.status(404).json({ error: 'Song not found' });
    }
});

// GET songs for the public queue
app.get('/api/songs/queue', (req, res) => {
    const queueSongs = songRequests
        .map(s => ({ // Select only necessary fields for public view
            name: s.name,
            songTitle: s.songTitle,
            timestamp: s.timestamp, // Could be used to show age or for sorting
            played: s.played,
            id: s.id // Useful for client-side keying if needed
        }))
        .sort((a, b) => { // Unplayed first, then by time
            if (a.played !== b.played) {
                return a.played ? 1 : -1; // false (unplayed) comes before true (played)
            }
            return new Date(a.timestamp) - new Date(b.timestamp); // Oldest unplayed first
        });
    res.json(queueSongs);
});


// --- Payment and Submission Logic (similar to before) ---

app.post('/api/initiate-payment', async (req, res) => {
    if (!DATATRANS_API_KEY || DATATRANS_API_KEY === 'YOUR_DATATRANS_API_KEY_SECRET') {
        return res.status(500).json({ error: "Payment gateway not configured." });
    }
    const { name, songTitle } = req.body;
    if (!songTitle) return res.status(400).json({ error: "Song title is required." });

    const internalRefno = uuidv4();
    try {
        const paymentData = {
            currency: 'CHF', amount: 100, refno: internalRefno,
            paymentMethods: ['TWI'], autoSettle: true,
        };
        const response = await datatransApi.post('/v1/transactions', paymentData);
        const { transactionId, detail } = response.data;
        const qrCodeData = detail?.twint?.qrCode;

        if (!transactionId || !qrCodeData) {
            return res.status(500).json({ error: "Failed to initiate TWINT payment. QR data missing." });
        }
        transactions[internalRefno] = {
            datatransTransactionId: transactionId, status: 'pending',
            songData: { name, songTitle }, timestamp: new Date()
        };
        res.json({ internalRefno, datatransTransactionId: transactionId, qrCodeData });
    } catch (error) {
        console.error('Datatrans Init Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to initiate payment.' });
    }
});

app.get('/api/check-payment-status', async (req, res) => {
    const { internalRefno } = req.query;
    if (!internalRefno || !transactions[internalRefno]) {
        return res.status(400).json({ error: "Invalid reference." });
    }
    const transactionInfo = transactions[internalRefno];
    if (['paid', 'failed'].includes(transactionInfo.status)) {
        return res.json({ status: transactionInfo.status, message: `Payment ${transactionInfo.status}.`});
    }

    try {
        const response = await datatransApi.get(`/v1/transactions/${transactionInfo.datatransTransactionId}`);
        const paymentStatus = response.data.status; // 'authorized', 'settled', 'failed', etc.

        if (['settled', 'authorized'].includes(paymentStatus)) {
            transactions[internalRefno].status = 'paid';
            return res.json({ status: 'paid', message: "Payment successful!" });
        } else if (['failed', 'canceled', 'expired'].includes(paymentStatus)) {
            transactions[internalRefno].status = 'failed';
            return res.json({ status: 'failed', message: `Payment ${paymentStatus}.` });
        }
        return res.json({ status: 'pending', message: `Payment ${paymentStatus}. Waiting...` });
    } catch (error) {
        console.error('Datatrans Status Check Error:', error.response?.data || error.message);
        res.status(500).json({ status: 'error', error: 'Error checking payment status.' });
    }
});

app.post('/api/submit-song', (req, res) => {
    const { internalRefno } = req.body;
    if (!internalRefno || !transactions[internalRefno]) {
        return res.status(400).json({ error: "Invalid reference for submission." });
    }
    const transactionInfo = transactions[internalRefno];

    if (transactionInfo.status !== 'paid') {
        return res.status(402).json({ error: "Payment not confirmed for this request." });
    }

    const newRequest = {
        id: uuidv4(), // Unique ID for the song request itself
        ...transactionInfo.songData,
        timestamp: new Date(transactionInfo.timestamp),
        played: false, // New song is initially not played
        transactionId: transactionInfo.datatransTransactionId, // Store for reference
    };
    songRequests.push(newRequest);
    console.log("Song request saved:", newRequest);
    // Optionally clear from transactions: delete transactions[internalRefno];
    res.status(201).json({ message: 'Song request submitted successfully!', request: newRequest });
});


// --- HTML Page Routes ---

// Main visitor page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin panel
app.get('/admin', (req, res) => {
    const { key } = req.query;
    if (key !== ADMIN_SECRET_KEY) {
        return res.status(403).send('Forbidden: Invalid secret key.');
    }
    // Initial songs are fetched by admin_app.js via /api/songs
    res.render('admin', {
        pageTitle: "Admin - Song Requests",
        adminSecretKey: ADMIN_SECRET_KEY // Pass key for client-side use if needed, or just for server-side checks
    });
});

// Public queue page
app.get('/queue', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'queue.html'));
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Visitor page: http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin?key=${ADMIN_SECRET_KEY}`);
    console.log(`Queue page: http://localhost:${PORT}/queue`);
    if (!DATATRANS_API_KEY || DATATRANS_API_KEY === 'YOUR_DATATRANS_API_KEY_SECRET') {
        console.warn("\nWARNING: DATATRANS_API_KEY not configured. Payment will fail.\n");
    }
});