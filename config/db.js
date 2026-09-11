const mysql = require('mysql2/promise');
require('dotenv').config();

// Bersihkan URI jika terdapat tanda petik atau spasi yang tidak sengaja terbawa di Environment Variables
const rawUri = (process.env.DATABASE_URL || '').trim();
const cleanUri = rawUri.replace(/^["']|["']$/g, '').trim();

// Membuat connection pool untuk efisiensi performa
const pool = mysql.createPool({
  uri: cleanUri,
  ssl: { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 10, // Batas maksimal koneksi bersamaan
  queueLimit: 0,
  connectTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

// Mengecek koneksi saat aplikasi pertama kali dijalankan
pool.getConnection()
  .then(conn => {
    console.log('✅ Berhasil terhubung ke database TiDB Cloud!');
    conn.release(); // Lepaskan kembali koneksi ke pool
  })
  .catch(err => {
    console.error('❌ Gagal terhubung ke database:', err.message);
  });

module.exports = pool;