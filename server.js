require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Bağlantısı (Neon / Supabase / Render uyumlu)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Veritabanı tablolarını otomatik oluşturma
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS notes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(150) NOT NULL,
                content TEXT,
                category VARCHAR(50) DEFAULT 'Genel',
                color VARCHAR(20) DEFAULT '#ffffff',
                is_pinned BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("PostgreSQL tabloları başarıyla kontrol edildi/oluşturuldu.");
    } catch (err) {
        console.error("Veritabanı başlatma hatası:", err.message);
    }
}
initDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'varsayilan_gizli_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Prod ortamında HTTPS üzerinden çerez gönderimi için
        maxAge: 24 * 60 * 60 * 1000 // 1 gün oturum süresi
    }
}));

// Oturum Doğrulama Middleware'i
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Lütfen önce giriş yapın.' });
    }
    next();
}

/* ================== KULLANICI İŞLEMLERİ ================== */

// Kayıt Ol
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Tüm alanları doldurun.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash) 
             VALUES ($1, $2, $3) RETURNING id, username`,
            [username.trim(), email.trim().toLowerCase(), hashedPassword]
        );

        const newUser = result.rows[0];
        req.session.userId = newUser.id;
        req.session.username = newUser.username;
        res.json({ message: 'Kayıt başarılı!', user: newUser });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta zaten kullanımda.' });
        }
        res.status(500).json({ error: 'Sunucu hatası oluştu.' });
    }
});

// Giriş Yap
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(
            `SELECT * FROM users WHERE email = $1`, 
            [email.trim().toLowerCase()]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        res.json({ message: 'Giriş başarılı!', user: { id: user.id, username: user.username } });
    } catch (err) {
        res.status(500).json({ error: 'Giriş işlemi sırasında hata oluştu.' });
    }
});

// Oturum Kontrolü
app.get('/api/me', (req, res) => {
    if (req.session.userId) {
        res.json({ loggedIn: true, username: req.session.username });
    } else {
        res.json({ loggedIn: false });
    }
});

// Çıkış Yap
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Çıkış yapıldı.' });
});

/* ================== NOT İŞLEMLERİ ================== */

// Notları Getir
app.get('/api/notes', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM notes WHERE user_id = $1 ORDER BY is_pinned DESC, id DESC`,
            [req.session.userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Notlar getirilemedi.' });
    }
});

// Yeni Not Ekle
app.post('/api/notes', requireAuth, async (req, res) => {
    const { title, content, category, color, is_pinned } = req.body;
    if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Başlık gereklidir.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO notes (user_id, title, content, category, color, is_pinned) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [req.session.userId, title.trim(), content || '', category || 'Genel', color || '#ffffff', Boolean(is_pinned)]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Not kaydedilemedi.' });
    }
});

// Not Sil
app.delete('/api/notes/:id', requireAuth, async (req, res) => {
    try {
        await pool.query(
            `DELETE FROM notes WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.session.userId]
        );
        res.json({ message: 'Not silindi.' });
    } catch (err) {
        res.status(500).json({ error: 'Silme hatası.' });
    }
});

// Not Sabitle/Kaldır
app.patch('/api/notes/:id/pin', requireAuth, async (req, res) => {
    const { is_pinned } = req.body;
    try {
        await pool.query(
            `UPDATE notes SET is_pinned = $1 WHERE id = $2 AND user_id = $3`,
            [Boolean(is_pinned), req.params.id, req.session.userId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Güncelleme hatası.' });
    }
});

app.listen(PORT, () => {
    console.log(`Sunucu aktif: http://localhost:${PORT}`);
});