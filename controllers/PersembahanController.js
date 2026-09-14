const crypto = require('crypto');
const db = require('../config/db');
const {
    successResponse,
    createdResponse,
    badRequestResponse,
    notFoundResponse,
    errorResponse
} = require('../helpers/responseHelper');
const { logAudit } = require('../helpers/auditHelper');

/**
 * Controller untuk mengelola pencatatan & rangkuman Persembahan Ibadah Minggu
 * Menggunakan relasi t_events (event_type = 'MINGGU'), m_finance_categories (group = 'm_persembahan'),
 * dan t_cash_transactions
 */

// 1. Mengambil seluruh ibadah MINGGU beserta persembahan & rangkuman nominal per kategori m_persembahan
const getPersembahanOverview = async (req, res) => {
    try {
        const { search, month, year, event_type } = req.query;

        // A. Ambil seluruh kategori keuangan aktif yang memiliki group = 'm_persembahan'
        const [categories] = await db.query(
            "SELECT id, name, `group`, type, is_active FROM m_finance_categories WHERE `group` = 'm_persembahan' AND is_active = 1 ORDER BY type ASC, name ASC"
        );

        // B. Ambil seluruh data acara dari t_events dengan is_persembahan = 1
        let eventQuery = `
            SELECT 
                id, 
                event_type, 
                DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date, 
                title, 
                is_attendance, 
                is_persembahan, 
                created_at 
            FROM t_events 
            WHERE is_persembahan = 1
        `;
        const eventParams = [];

        if (event_type && event_type.trim() && event_type !== 'ALL') {
            eventQuery += ' AND event_type = ?';
            eventParams.push(event_type.trim());
        }

        if (search && search.trim()) {
            eventQuery += ' AND (title LIKE ? OR event_date LIKE ?)';
            const term = `%${search.trim()}%`;
            eventParams.push(term, term);
        }

        if (month && !isNaN(month)) {
            eventQuery += ' AND MONTH(event_date) = ?';
            eventParams.push(Number(month));
        }

        if (year && !isNaN(year)) {
            eventQuery += ' AND YEAR(event_date) = ?';
            eventParams.push(Number(year));
        }

        eventQuery += ' ORDER BY event_date DESC, created_at DESC';

        const [events] = await db.query(eventQuery, eventParams);

        if (events.length === 0) {
            return successResponse(res, {
                events: [],
                categories,
                summary: {
                    grand_total: 0,
                    total_events: 0,
                    recorded_events: 0,
                    category_totals: {}
                }
            }, 'Data persembahan berhasil diambil');
        }

        const eventIds = events.map(e => e.id);

        // C. Ambil transaksi kas untuk ibadah-ibadah ini pada kategori m_persembahan
        const placeholders = eventIds.map(() => '?').join(',');
        const [transactions] = await db.query(
            `SELECT 
                ct.id,
                ct.transaction_date,
                ct.category_id,
                ct.type,
                ct.amount,
                ct.description,
                ct.event_id,
                ct.recorded_by,
                u.name AS recorded_by_name
             FROM t_cash_transactions ct
             JOIN m_finance_categories fc ON ct.category_id = fc.id
             LEFT JOIN users u ON ct.recorded_by = u.id
             WHERE fc.\`group\` = 'm_persembahan' AND ct.event_id IN (${placeholders})`,
            eventIds
        );

        // D. Petakan transaksi berdasarkan event_id & category_id
        const eventTransactionsMap = {};
        for (const t of transactions) {
            if (!eventTransactionsMap[t.event_id]) {
                eventTransactionsMap[t.event_id] = {};
            }
            eventTransactionsMap[t.event_id][t.category_id] = {
                id: t.id,
                amount: Number(t.amount) || 0,
                type: t.type,
                description: t.description || '',
                recorded_by: t.recorded_by_name || 'Admin'
            };
        }

        // Inisialisasi rangkuman total per kategori
        const categoryTotals = {};
        for (const cat of categories) {
            categoryTotals[cat.id] = {
                category_id: cat.id,
                category_name: cat.name,
                category_type: cat.type,
                total_amount: 0,
                event_count: 0
            };
        }

        let grandTotal = 0;
        let recordedEventsCount = 0;

        // E. Susun data setiap ibadah MINGGU beserta nominalnya
        const formattedEvents = events.map(event => {
            const eventTx = eventTransactionsMap[event.id] || {};
            let eventTotal = 0;
            let hasOfferings = false;

            const offeringsBreakdown = {};

            for (const cat of categories) {
                const item = eventTx[cat.id];
                const amt = item ? item.amount : 0;
                offeringsBreakdown[cat.id] = {
                    category_id: cat.id,
                    category_name: cat.name,
                    category_type: cat.type,
                    amount: amt,
                    transaction_id: item?.id || null,
                    description: item?.description || ''
                };

                if (amt > 0) {
                    eventTotal += amt;
                    hasOfferings = true;
                    categoryTotals[cat.id].total_amount += amt;
                    categoryTotals[cat.id].event_count += 1;
                }
            }

            if (hasOfferings) {
                recordedEventsCount += 1;
                grandTotal += eventTotal;
            }

            return {
                id: event.id,
                title: event.title,
                event_type: event.event_type,
                event_date: event.event_date,
                is_attendance: Boolean(event.is_attendance),
                is_persembahan: Boolean(event.is_persembahan),
                offerings: offeringsBreakdown,
                total_amount: eventTotal,
                has_offerings: hasOfferings,
                status_label: hasOfferings ? 'Sudah Diisi' : 'Belum Diisi'
            };
        });

        const summary = {
            grand_total: grandTotal,
            total_events: events.length,
            recorded_events: recordedEventsCount,
            category_totals: categoryTotals
        };

        return successResponse(res, {
            events: formattedEvents,
            categories,
            summary
        }, 'Data persembahan ibadah minggu dan rangkuman nominal berhasil diambil');
    } catch (error) {
        console.error('Error getPersembahanOverview:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data persembahan', 500, error.message);
    }
};

// 2. Mengambil detail persembahan untuk satu ibadah MINGGU tertentu
const getPersembahanByEventId = async (req, res) => {
    try {
        const { eventId } = req.params;

        // Ambil data event
        const [eventRows] = await db.query(
            "SELECT id, event_type, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date, title, is_attendance, is_persembahan FROM t_events WHERE id = ?",
            [eventId]
        );

        if (eventRows.length === 0) {
            return notFoundResponse(res, `Acara dengan ID '${eventId}' tidak ditemukan`);
        }

        const event = eventRows[0];

        // Ambil seluruh kategori m_persembahan
        const [categories] = await db.query(
            "SELECT id, name, `group`, type, is_active FROM m_finance_categories WHERE `group` = 'm_persembahan' AND is_active = 1 ORDER BY type ASC, name ASC"
        );

        // Ambil transaksi yang sudah ada untuk event ini
        const [transactions] = await db.query(
            `SELECT ct.id, ct.category_id, ct.type, ct.amount, ct.description 
             FROM t_cash_transactions ct
             JOIN m_finance_categories fc ON ct.category_id = fc.id
             WHERE ct.event_id = ? AND fc.\`group\` = 'm_persembahan'`,
            [eventId]
        );

        const txMap = {};
        for (const t of transactions) {
            txMap[t.category_id] = {
                id: t.id,
                amount: Number(t.amount) || 0,
                type: t.type,
                description: t.description || ''
            };
        }

        let totalAmount = 0;
        const items = categories.map(cat => {
            const existing = txMap[cat.id];
            const amt = existing ? existing.amount : 0;
            totalAmount += amt;

            return {
                category_id: cat.id,
                category_name: cat.name,
                category_type: cat.type,
                amount: amt,
                description: existing ? existing.description : '',
                transaction_id: existing ? existing.id : null
            };
        });

        return successResponse(res, {
            event,
            categories,
            items,
            total_amount: totalAmount
        }, 'Detail persembahan ibadah berhasil diambil');
    } catch (error) {
        console.error('Error getPersembahanByEventId:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil detail persembahan', 500, error.message);
    }
};

// 3. Menyimpan / Memperbarui nominal persembahan untuk suatu ibadah MINGGU (Batch Upsert)
const savePersembahanByEvent = async (req, res) => {
    let connection;
    try {
        const { eventId } = req.params;
        const { items } = req.body; // Array: [{ category_id, amount, description }]

        if (!Array.isArray(items)) {
            return badRequestResponse(res, 'Format items harus berupa array objek persembahan');
        }

        // Pastikan acara ada dan merupakan ibadah MINGGU
        const [events] = await db.query('SELECT id, event_type, event_date, title FROM t_events WHERE id = ?', [eventId]);
        if (events.length === 0) {
            return notFoundResponse(res, `Acara ibadah dengan ID '${eventId}' tidak ditemukan`);
        }

        const event = events[0];
        const userId = req.user?.id;

        connection = await db.getConnection();
        await connection.beginTransaction();

        // Ambil kategori valid ber-group m_persembahan
        const [validCategories] = await connection.query(
            "SELECT id, name, type FROM m_finance_categories WHERE `group` = 'm_persembahan'"
        );
        const categoryMap = {};
        for (const vc of validCategories) {
            categoryMap[vc.id] = vc;
        }

        let totalSavedAmount = 0;

        for (const item of items) {
            if (!item.category_id || !categoryMap[item.category_id]) {
                continue;
            }

            const cat = categoryMap[item.category_id];
            const parsedAmount = Math.max(0, Number(item.amount) || 0);
            const desc = item.description && item.description.trim()
                ? item.description.trim()
                : `Persembahan ${cat.name} - ${event.title}`;

            // Cek apakah sudah ada transaksi untuk event dan category ini
            const [existingTx] = await connection.query(
                'SELECT id FROM t_cash_transactions WHERE event_id = ? AND category_id = ?',
                [eventId, cat.id]
            );

            if (parsedAmount > 0) {
                totalSavedAmount += parsedAmount;
                if (existingTx.length > 0) {
                    // Update
                    await connection.query(
                        `UPDATE t_cash_transactions 
                         SET amount = ?, description = ?, type = ?, transaction_date = ?, recorded_by = ? 
                         WHERE id = ?`,
                        [parsedAmount, desc, cat.type, event.event_date, userId, existingTx[0].id]
                    );
                } else {
                    // Insert
                    const txId = crypto.randomUUID();
                    await connection.query(
                        `INSERT INTO t_cash_transactions 
                         (id, transaction_date, category_id, type, amount, description, event_id, recorded_by) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [txId, event.event_date, cat.id, cat.type, parsedAmount, desc, eventId, userId]
                    );
                }
            } else {
                // Jika nominal diubah jadi 0 atau kosong, hapus record transaksi yang ada
                if (existingTx.length > 0) {
                    await connection.query(
                        'DELETE FROM t_cash_transactions WHERE id = ?',
                        [existingTx[0].id]
                    );
                }
            }
        }

        await connection.commit();

        // Catat ke audit log
        await logAudit({
            userId,
            action: 'UPDATE',
            tableName: 't_cash_transactions',
            description: `Menyimpan persembahan untuk ibadah ${event.title} (${event.event_date}) senilai Rp ${totalSavedAmount.toLocaleString('id-ID')}`
        });

        return successResponse(res, {
            event_id: eventId,
            total_amount: totalSavedAmount
        }, 'Data nominal persembahan berhasil disimpan');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error savePersembahanByEvent:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menyimpan persembahan', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// 4. Menghapus seluruh data persembahan pada satu ibadah MINGGU tertentu
const deletePersembahanByEvent = async (req, res) => {
    try {
        const { eventId } = req.params;

        // Ambil transaksi m_persembahan pada event ini
        const [transactions] = await db.query(
            `SELECT ct.id FROM t_cash_transactions ct
             JOIN m_finance_categories fc ON ct.category_id = fc.id
             WHERE ct.event_id = ? AND fc.\`group\` = 'm_persembahan'`,
            [eventId]
        );

        if (transactions.length === 0) {
            return notFoundResponse(res, 'Tidak ada data persembahan yang tercatat untuk ibadah ini');
        }

        const txIds = transactions.map(t => t.id);
        const placeholders = txIds.map(() => '?').join(',');

        await db.query(`DELETE FROM t_cash_transactions WHERE id IN (${placeholders})`, txIds);

        // Audit Log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 't_cash_transactions',
            description: `Menghapus seluruh persembahan untuk ibadah dengan event ID ${eventId}`
        });

        return successResponse(res, null, 'Data persembahan ibadah berhasil dihapus');
    } catch (error) {
        console.error('Error deletePersembahanByEvent:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus data persembahan', 500, error.message);
    }
};

module.exports = {
    getPersembahanOverview,
    getPersembahanByEventId,
    savePersembahanByEvent,
    deletePersembahanByEvent
};
