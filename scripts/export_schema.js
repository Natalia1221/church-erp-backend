const fs = require('fs');
const path = require('path');
const db = require('../config/db');

async function exportSchema() {
    try {
        console.log('Mengambil skema tabel dan relasi Foreign Key...');

        // Urutan tabel yang sudah diurutkan berdasarkan ketergantungan Foreign Key (Topological Sort)
        // 1. Master Tables (Tabel Induk yang tidak memiliki FK ke tabel lain)
        // 2. Child Tables (Tabel Anak yang memiliki FK ke tabel induk)
        const orderedTables = [
            // --- TABEL INDUK (MASTER) ---
            'm_roles',
            'm_menus',
            'm_categories',
            'm_finance_categories',
            'm_settings',
            'users',
            't_events',

            // --- TABEL RELASI & TRANSAKSI (DEPENDENT) ---
            'user_roles',          // FK: users(id), m_roles(id)
            'role_menus',          // FK: m_roles(id), m_menus(id)
            't_attendances',       // FK: t_events(id), users(id)
            't_assignments',       // FK: t_events(id), users(id), m_categories(id)
            't_cash_transactions'  // FK: m_finance_categories(id), t_events(id), users(id)
        ];

        let sqlOutput = `-- ========================================================\n`;
        sqlOutput += `-- EXPORT SKEMA & MASTER DATA ERP CHURCH (TIDB / MYSQL)\n`;
        sqlOutput += `-- Generated at: ${new Date().toISOString()}\n`;
        sqlOutput += `-- Urutan DDL & DML disesuaikan berdasarkan Foreign Key (FK)\n`;
        sqlOutput += `-- ========================================================\n\n`;

        sqlOutput += `SET FOREIGN_KEY_CHECKS = 0;\n`;
        sqlOutput += `SET NAMES utf8mb4;\n\n`;

        // 1. DROP TABLES (Urutan terbalik: Tabel Anak dihapus duluan agar tidak melanggar FK)
        sqlOutput += `-- ========================================================\n`;
        sqlOutput += `-- 1. DROP TABLES (Urutan dari tabel anak ke tabel induk)\n`;
        sqlOutput += `-- ========================================================\n`;
        for (let i = orderedTables.length - 1; i >= 0; i--) {
            sqlOutput += `DROP TABLE IF EXISTS \`${orderedTables[i]}\`;\n`;
        }
        sqlOutput += `\n`;

        // 2. CREATE TABLES (Urutan maju: Tabel Induk dibuat duluan sebelum tabel anak)
        sqlOutput += `-- ========================================================\n`;
        sqlOutput += `-- 2. CREATE TABLES (Tabel Induk terlebih dahulu, lalu Tabel Anak)\n`;
        sqlOutput += `-- ========================================================\n\n`;

        for (const tableName of orderedTables) {
            const [createRes] = await db.query(`SHOW CREATE TABLE \`${tableName}\``);
            const createSql = createRes[0]['Create Table'];

            sqlOutput += `-- --------------------------------------------------------\n`;
            sqlOutput += `-- Struktur Tabel: ${tableName}\n`;
            sqlOutput += `-- --------------------------------------------------------\n`;
            sqlOutput += `${createSql};\n\n`;
        }

        // 3. INSERT DATA MASTER (Urutan maju: Data induk dimasukkan terlebih dahulu)
        sqlOutput += `-- ========================================================\n`;
        sqlOutput += `-- 3. DATA MASTER AWAL (Urutan: Master -> Relasi)\n`;
        sqlOutput += `-- ========================================================\n\n`;

        const dataInsertOrder = [
            'm_roles',
            'm_menus',
            'm_categories',
            'm_finance_categories',
            'm_settings',
            'users',
            'user_roles',
            'role_menus'
        ];

        for (const tbl of dataInsertOrder) {
            const [rows] = await db.query(`SELECT * FROM \`${tbl}\``);
            if (rows.length > 0) {
                sqlOutput += `-- Data tabel: ${tbl} (${rows.length} baris)\n`;
                for (const r of rows) {
                    const columns = Object.keys(r).map(k => `\`${k}\``).join(', ');
                    const values = Object.values(r).map(v => {
                        if (v === null) return 'NULL';
                        if (typeof v === 'boolean') return v ? 1 : 0;
                        if (typeof v === 'number') return v;
                        if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
                        // Escape single quote
                        const escaped = String(v).replace(/'/g, "\\'");
                        return `'${escaped}'`;
                    }).join(', ');

                    sqlOutput += `INSERT INTO \`${tbl}\` (${columns}) VALUES (${values});\n`;
                }
                sqlOutput += `\n`;
            }
        }

        sqlOutput += `SET FOREIGN_KEY_CHECKS = 1;\n`;

        const outputPath = path.join(__dirname, '..', 'schema_and_master_data.sql');
        fs.writeFileSync(outputPath, sqlOutput, 'utf8');

        console.log(`✅ Berhasil menyusun skema terurut FK ke:`);
        console.log(`   ${outputPath}`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Gagal mengekspor skema:', error);
        process.exit(1);
    }
}

exportSchema();
