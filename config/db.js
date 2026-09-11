const mysql = require('mysql2/promise');
require('dotenv').config();

// Membuat connection pool untuk efisiensi performa
const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
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