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

// Route dasar (Root) untuk memastikan API berjalan
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Selamat datang di API ERP Gereja!'
    });
});

// Endpoint Modul Auth, Role, User, Menu, dan Setting
app.use('/api/auth', authRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/menus', menuRoutes);
app.use('/api/settings', settingRoutes);

// Menyalakan Server
app.listen(port, () => {
    console.log(`🚀 Server Express berjalan di http://localhost:${port}`);
});