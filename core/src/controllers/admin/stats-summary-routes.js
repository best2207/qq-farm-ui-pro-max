function registerStatsSummaryRoutes({
    app,
    authRequired,
    userRequired,
    statsSummaryService,
}) {
    app.get('/api/stats/summary', authRequired, userRequired, async (req, res) => {
        try {
            if (req.currentUser?.role !== 'admin') {
                return res.status(403).json({ ok: false, error: '全局统计汇总仅限管理员查看' });
            }
            const data = statsSummaryService ? await statsSummaryService.getSummary() : null;
            return res.json({ ok: true, data });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/stats/history-summary', authRequired, userRequired, async (req, res) => {
        try {
            if (req.currentUser?.role !== 'admin') {
                return res.status(403).json({ ok: false, error: '全局统计历史仅限管理员查看' });
            }
            const data = statsSummaryService ? await statsSummaryService.getSummary() : null;
            return res.json({
                ok: true,
                data: {
                    checkedAt: data && data.checkedAt ? data.checkedAt : Date.now(),
                    history: data && Array.isArray(data.history) ? data.history : [],
                },
            });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = {
    registerStatsSummaryRoutes,
};
