const db = require('../config/db');
const { successResponse, errorResponse } = require('../helpers/responseHelper');

/**
 * Controller untuk mengelola Laporan Keuangan Gereja
 * Menghitung seluruh transaksi INCOME, EXPENSE, dan Saldo Bersih / Hasil Akhir (Net Balance)
 */

const getFinancialReport = async (req, res) => {
    try {
        const {
            start_date,
            end_date,
            month,
            year,
            type,
            category_id,
            source, // 'ALL' | 'PERSEMBAHAN' | 'OPERASIONAL'
            search
        } = req.query;

        // 1. Tentukan rentang tanggal filter
        let filterStartDate = start_date;
        let filterEndDate = end_date;

        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        if (month && year) {
            const m = String(month).padStart(2, '0');
            const lastDay = new Date(Number(year), Number(month), 0).getDate();
            filterStartDate = `${year}-${m}-01`;
            filterEndDate = `${year}-${m}-${lastDay}`;
        } else if (year && !month) {
            filterStartDate = `${year}-01-01`;
            filterEndDate = `${year}-12-31`;
        }

        // 2. Siapkan kondisi WHERE dasar untuk kalkulasi
        let whereClauses = [];
        let params = [];

        if (filterStartDate) {
            whereClauses.push('ct.transaction_date >= ?');
            params.push(filterStartDate);
        }

        if (filterEndDate) {
            whereClauses.push('ct.transaction_date <= ?');
            params.push(filterEndDate);
        }

        if (category_id && category_id.trim()) {
            whereClauses.push('ct.category_id = ?');
            params.push(category_id.trim());
        }

        if (source === 'PERSEMBAHAN') {
            whereClauses.push('ct.event_id IS NOT NULL');
        } else if (source === 'OPERASIONAL') {
            whereClauses.push('ct.event_id IS NULL');
        }

        if (search && search.trim()) {
            whereClauses.push('(ct.description LIKE ? OR fc.name LIKE ? OR e.title LIKE ? OR u.name LIKE ?)');
            const term = `%${search.trim()}%`;
            params.push(term, term, term, term);
        }

        const baseWhereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // 3. Ringkasan KPI Utama (Total Income, Total Expense, Net Balance)
        // Suatu transaksi HANYA dianggap Income jika kategori keuangannya bertipe 'INCOME'
        // dan dianggap Expense jika kategori keuangannya bertipe 'EXPENSE'
        const summarySql = `
            SELECT 
                COALESCE(SUM(CASE WHEN fc.type = 'INCOME' THEN ct.amount ELSE 0 END), 0) AS total_income,
                COALESCE(SUM(CASE WHEN fc.type = 'EXPENSE' THEN ct.amount ELSE 0 END), 0) AS total_expense,
                COALESCE(SUM(CASE WHEN fc.type = 'BUKAN KEDUANYA' THEN ct.amount ELSE 0 END), 0) AS total_other,
                COUNT(CASE WHEN fc.type = 'INCOME' THEN 1 END) AS income_count,
                COUNT(CASE WHEN fc.type = 'EXPENSE' THEN 1 END) AS expense_count,
                COUNT(CASE WHEN fc.type = 'BUKAN KEDUANYA' THEN 1 END) AS other_count,
                COUNT(*) AS total_count
            FROM t_cash_transactions ct
            JOIN m_finance_categories fc ON ct.category_id = fc.id
            LEFT JOIN t_events e ON ct.event_id = e.id
            LEFT JOIN users u ON ct.recorded_by = u.id
            ${baseWhereSql}
        `;

        const [summaryRows] = await db.query(summarySql, params);
        const totalIncome = Number(summaryRows[0].total_income) || 0;
        const totalExpense = Number(summaryRows[0].total_expense) || 0;
        const totalOther = Number(summaryRows[0].total_other) || 0;
        const netBalance = totalIncome - totalExpense;
        const incomeCount = Number(summaryRows[0].income_count) || 0;
        const expenseCount = Number(summaryRows[0].expense_count) || 0;
        const otherCount = Number(summaryRows[0].other_count) || 0;
        const totalCount = Number(summaryRows[0].total_count) || 0;

        let netStatus = 'SEIMBANG';
        if (netBalance > 0) {
            netStatus = 'SURPLUS';
        } else if (netBalance < 0) {
            netStatus = 'DEFISIT';
        }

        const expenseRatio = totalIncome > 0 ? Number(((totalExpense / totalIncome) * 100).toFixed(1)) : 0;
        const surplusRatio = totalIncome > 0 ? Number(((netBalance / totalIncome) * 100).toFixed(1)) : 0;

        // 4. Rekapitulasi per Kategori Keuangan berdasarkan jenis transaksi kategori (fc.type)
        const categorySql = `
            SELECT 
                fc.id AS category_id,
                fc.name AS category_name,
                fc.\`group\` AS category_group,
                fc.type AS category_type,
                COALESCE(SUM(ct.amount), 0) AS total_amount,
                COUNT(ct.id) AS transaction_count
            FROM t_cash_transactions ct
            JOIN m_finance_categories fc ON ct.category_id = fc.id
            LEFT JOIN t_events e ON ct.event_id = e.id
            LEFT JOIN users u ON ct.recorded_by = u.id
            ${baseWhereSql}
            GROUP BY fc.id, fc.name, fc.\`group\`, fc.type
            ORDER BY total_amount DESC
        `;

        const [categoryRows] = await db.query(categorySql, params);

        const incomeCategories = [];
        const expenseCategories = [];
        const otherCategories = [];

        for (const row of categoryRows) {
            const amount = Number(row.total_amount) || 0;
            const count = Number(row.transaction_count) || 0;

            if (row.category_type === 'INCOME') {
                const percentage = totalIncome > 0 ? Number(((amount / totalIncome) * 100).toFixed(1)) : 0;
                incomeCategories.push({
                    category_id: row.category_id,
                    category_name: row.category_name,
                    category_group: row.category_group,
                    type: 'INCOME',
                    total_amount: amount,
                    transaction_count: count,
                    percentage
                });
            } else if (row.category_type === 'EXPENSE') {
                const percentage = totalExpense > 0 ? Number(((amount / totalExpense) * 100).toFixed(1)) : 0;
                expenseCategories.push({
                    category_id: row.category_id,
                    category_name: row.category_name,
                    category_group: row.category_group,
                    type: 'EXPENSE',
                    total_amount: amount,
                    transaction_count: count,
                    percentage
                });
            } else {
                otherCategories.push({
                    category_id: row.category_id,
                    category_name: row.category_name,
                    category_group: row.category_group,
                    type: row.category_type || 'BUKAN KEDUANYA',
                    total_amount: amount,
                    transaction_count: count,
                    percentage: 0
                });
            }
        }

        // 5. Tren Bulanan (Untuk Grafik & Analisis Tren)
        const trendYear = year || (filterStartDate ? filterStartDate.split('-')[0] : currentYear);
        const [trendRows] = await db.query(`
            SELECT 
                DATE_FORMAT(ct.transaction_date, '%Y-%m') AS period_month,
                MONTH(ct.transaction_date) AS month_num,
                COALESCE(SUM(CASE WHEN fc.type = 'INCOME' THEN ct.amount ELSE 0 END), 0) AS monthly_income,
                COALESCE(SUM(CASE WHEN fc.type = 'EXPENSE' THEN ct.amount ELSE 0 END), 0) AS monthly_expense
            FROM t_cash_transactions ct
            JOIN m_finance_categories fc ON ct.category_id = fc.id
            WHERE YEAR(ct.transaction_date) = ?
            GROUP BY DATE_FORMAT(ct.transaction_date, '%Y-%m'), MONTH(ct.transaction_date)
            ORDER BY period_month ASC
        `, [trendYear]);

        const monthlyTrends = trendRows.map(t => {
            const inc = Number(t.monthly_income) || 0;
            const exp = Number(t.monthly_expense) || 0;
            return {
                period_month: t.period_month,
                month_num: t.month_num,
                income: inc,
                expense: exp,
                net_balance: inc - exp
            };
        });

        // 6. Rincian Seluruh Transaksi Mutasi Kas (Transaction Ledger)
        let listWhereClauses = [...whereClauses];
        let listParams = [...params];

        // Jika ada filter tipe khusus untuk tabel mutasi
        if (type && type.toUpperCase() === 'INCOME_EXPENSE') {
            listWhereClauses.push("fc.type IN ('INCOME', 'EXPENSE')");
        } else if (type && ['INCOME', 'EXPENSE', 'BUKAN KEDUANYA'].includes(type.toUpperCase())) {
            listWhereClauses.push('fc.type = ?');
            listParams.push(type.toUpperCase());
        }

        const listWhereSql = listWhereClauses.length > 0 ? `WHERE ${listWhereClauses.join(' AND ')}` : '';

        const transactionsSql = `
            SELECT 
                ct.id,
                DATE_FORMAT(ct.transaction_date, '%Y-%m-%d') AS transaction_date,
                ct.category_id,
                fc.name AS category_name,
                fc.\`group\` AS category_group,
                ct.type,
                CAST(ct.amount AS DECIMAL(15,2)) AS amount,
                ct.description,
                ct.event_id,
                e.title AS event_title,
                e.event_type,
                ct.recorded_by,
                u.name AS recorded_by_name,
                ct.created_at
            FROM t_cash_transactions ct
            JOIN m_finance_categories fc ON ct.category_id = fc.id
            LEFT JOIN t_events e ON ct.event_id = e.id
            LEFT JOIN users u ON ct.recorded_by = u.id
            ${listWhereSql}
            ORDER BY ct.transaction_date DESC, ct.created_at DESC
        `;

        const [transactions] = await db.query(transactionsSql, listParams);

        const formattedTransactions = transactions.map(tx => {
            const isEvent = Boolean(tx.event_id);
            return {
                id: tx.id,
                transaction_date: tx.transaction_date,
                category_id: tx.category_id,
                category_name: tx.category_name,
                category_group: tx.category_group,
                type: tx.type,
                amount: Number(tx.amount) || 0,
                description: tx.description || '-',
                event_id: tx.event_id,
                event_title: tx.event_title,
                event_type: tx.event_type,
                source_type: isEvent ? 'PERSEMBAHAN' : 'OPERASIONAL',
                source_label: isEvent ? `Ibadah ${tx.event_title || 'Minggu'}` : 'Kas Operasional / Umum',
                recorded_by: tx.recorded_by,
                recorded_by_name: tx.recorded_by_name || 'Admin',
                created_at: tx.created_at
            };
        });

        // 7. Ambil daftar kategori keuangan aktif untuk opsi filter frontend
        const [activeCategories] = await db.query(
            "SELECT id, name, `group`, type FROM m_finance_categories WHERE is_active = 1 ORDER BY type ASC, name ASC"
        );

        return successResponse(res, {
            summary: {
                total_income: totalIncome,
                total_expense: totalExpense,
                total_other: totalOther,
                net_balance: netBalance,
                net_status: netStatus,
                income_count: incomeCount,
                expense_count: expenseCount,
                other_count: otherCount,
                total_count: totalCount,
                expense_ratio: expenseRatio,
                surplus_ratio: surplusRatio
            },
            categories_breakdown: {
                income_categories: incomeCategories,
                expense_categories: expenseCategories,
                other_categories: otherCategories
            },
            monthly_trends: monthlyTrends,
            transactions: formattedTransactions,
            filter_options: {
                categories: activeCategories,
                applied_filter: {
                    start_date: filterStartDate || null,
                    end_date: filterEndDate || null,
                    month: month ? Number(month) : null,
                    year: year ? Number(year) : null,
                    type: type || 'ALL',
                    source: source || 'ALL',
                    category_id: category_id || null,
                    search: search || null
                }
            }
        }, 'Laporan keuangan berhasil dimuat');
    } catch (error) {
        console.error('Error getFinancialReport:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memuat laporan keuangan', 500, error.message);
    }
};

module.exports = {
    getFinancialReport
};
