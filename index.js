require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./config/db'); // Memanggil file koneksi database tadi

const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Pastikan direktori uploads untuk foto absensi tersedia
const uploadsDir = path.join(__dirname, 'uploads', 'attendances');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors()); // Mengizinkan Vue.js mengakses API ini
app.use(express.json({ limit: '10mb' })); // Limit 10mb untuk foto selfie base64
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Static file serving untuk foto absensi

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
const attendanceRoutes = require('./routes/attendanceRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const financeCategoryRoutes = require('./routes/financeCategoryRoutes');
const persembahanRoutes = require('./routes/persembahanRoutes');
const kasLainnyaRoutes = require('./routes/kasLainnyaRoutes');
const financialReportRoutes = require('./routes/financialReportRoutes');

// Route dasar (Root) untuk memastikan API berjalan
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Selamat datang di API ERP Gereja!'
    });
});

// Endpoint Modul Auth, Role, User, Menu, Setting, Kategori, Sermon, Minggu, Lainnya, Absensi, Dashboard, Kategori Keuangan, Persembahan, Kas Lainnya, dan Laporan Keuangan
app.use('/api/auth', authRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/menus', menuRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sermons', sermonRoutes);
app.use('/api/minggu', mingguRoutes);
app.use('/api/lainnya', lainnyaRoutes);
app.use('/api/attendances', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/finance-categories', financeCategoryRoutes);
app.use('/api/persembahan', persembahanRoutes);
app.use('/api/kas-lainnya', kasLainnyaRoutes);
app.use('/api/laporan-keuangan', financialReportRoutes);
app.use('/api/financial-report', financialReportRoutes);

// Menyalakan Server jika dijalankan secara lokal/standalone
if (require.main === module || !process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`🚀 Server Express berjalan di http://localhost:${port}`);
    });
}

// Export instance express untuk Vercel Serverless Function
module.exports = app;