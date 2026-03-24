function getStartOfWeek(date = new Date()) {
    const current = new Date(date);
    const day = current.getDay();
    const diff = day === 0 ? -6 : (1 - day);
    current.setHours(0, 0, 0, 0);
    current.setDate(current.getDate() + diff);
    return current;
}

function getStartOfMonth(date = new Date()) {
    const current = new Date(date);
    current.setHours(0, 0, 0, 0);
    current.setDate(1);
    return current;
}

function buildEmptyBucket(label = '') {
    return {
        label,
        exp: 0,
        gold: 0,
        steal: 0,
        help: 0,
    };
}

function mergeTotals(rows = []) {
    return rows.reduce((acc, row) => {
        acc.exp += Number(row.total_exp) || 0;
        acc.gold += Number(row.total_gold) || 0;
        acc.steal += Number(row.total_steal) || 0;
        acc.help += Number(row.total_help) || 0;
        return acc;
    }, buildEmptyBucket());
}

function createStatsSummaryService({
    getPool,
    getAccountsSnapshot,
}) {
    async function loadRecentRows(limit = 90) {
        const pool = typeof getPool === 'function' ? getPool() : null;
        if (!pool) {
            return [];
        }
        const safeLimit = Math.max(1, Math.min(365, Number(limit) || 90));
        const [rows] = await pool.query(
            `SELECT record_date, total_exp, total_gold, total_steal, total_help
             FROM stats_daily
             ORDER BY record_date DESC
             LIMIT ?`,
            [safeLimit],
        );
        return Array.isArray(rows) ? rows.slice().reverse() : [];
    }

    async function getSummary() {
        const rows = await loadRecentRows(90);
        const now = new Date();
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);
        const startOfWeek = getStartOfWeek(now);
        const startOfMonth = getStartOfMonth(now);
        const history = [];
        const todayRows = [];
        const weekRows = [];
        const monthRows = [];

        for (const row of rows) {
            const recordDate = new Date(row.record_date);
            recordDate.setHours(0, 0, 0, 0);
            const isoDate = Number.isNaN(recordDate.getTime())
                ? String(row.record_date || '')
                : recordDate.toISOString().slice(0, 10);
            history.push({
                date: isoDate,
                exp: Number(row.total_exp) || 0,
                gold: Number(row.total_gold) || 0,
                steal: Number(row.total_steal) || 0,
                help: Number(row.total_help) || 0,
            });
            if (recordDate.getTime() === startOfToday.getTime()) todayRows.push(row);
            if (recordDate >= startOfWeek) weekRows.push(row);
            if (recordDate >= startOfMonth) monthRows.push(row);
        }

        const accountsSnapshot = typeof getAccountsSnapshot === 'function'
            ? await getAccountsSnapshot().catch(() => ({ accounts: [] }))
            : { accounts: [] };
        const accounts = Array.isArray(accountsSnapshot && accountsSnapshot.accounts)
            ? accountsSnapshot.accounts
            : [];

        return {
            checkedAt: Date.now(),
            totalDays: rows.length,
            accounts: {
                total: accounts.length,
                reloginRequired: accounts.filter(item => Number(item && item.wsError && item.wsError.code) === 400).length,
                banned: accounts.filter(item => Number(item && item.wsError && item.wsError.code) === 1000016).length,
            },
            buckets: {
                today: { ...mergeTotals(todayRows), label: '今日' },
                week: { ...mergeTotals(weekRows), label: '本周' },
                month: { ...mergeTotals(monthRows), label: '本月' },
                all: { ...mergeTotals(rows), label: '累计' },
            },
            history,
        };
    }

    return {
        loadRecentRows,
        getSummary,
    };
}

module.exports = {
    createStatsSummaryService,
};
