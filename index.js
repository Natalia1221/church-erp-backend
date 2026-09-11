require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./config/db'); // Memanggil file koneksi database tadi

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Mengizinkan Vue.js mengakses API ini
app.use(express.json()); // Agar Express bisa membaca request body berformat JSON

// Routes
const authRoutes = require('./routes/authRoutes');
const roleRoutes = require('./routes/roleRoutes');
const userRoutes = require('./routes/userRoutes');
const menuRoutes = require('./routes/menuRoutes');
const settingRoutes = require('./routes/settingRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const sermonRoutes = require('./routes/sermonRoutes');
const mingguRoutes = require('./routes/mingguRoutes');
const lainnyaRoutes = require('./routes/lainnyaRoutes');

// Route dasar (Root) untuk memastikan API berjalan
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Selamat datang di API ERP Gereja!'
    });
});

// Endpoint Modul Auth, Role, User, Menu, Setting, Kategori, Sermon, Minggu, dan Lainnya
app.use('/api/auth', authRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/menus', menuRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sermons', sermonRoutes);
app.use('/api/minggu', mingguRoutes);
app.use('/api/lainnya', lainnyaRoutes);

// Menyalakan Server jika dijalankan secara lokal/standalone
if (require.main === module || !process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`🚀 Server Express berjalan di http://localhost:${port}`);
    });
}

// Export instance express untuk Vercel Serverless Function
module.exports = app;