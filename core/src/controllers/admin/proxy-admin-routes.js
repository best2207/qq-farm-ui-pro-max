function registerProxyAdminRoutes({
    app,
    authRequired,
    userRequired,
    proxyPoolService,
}) {
    function ensureAdmin(req, res) {
        if (req.currentUser?.role !== 'admin') {
            res.status(403).json({ ok: false, error: '仅管理员可管理代理池' });
            return false;
        }
        return true;
    }

    app.get('/api/admin/proxies', authRequired, userRequired, async (req, res) => {
        try {
            if (!ensureAdmin(req, res)) return;
            const list = proxyPoolService ? await proxyPoolService.list() : [];
            return res.json({ ok: true, data: list });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/proxies', authRequired, userRequired, async (req, res) => {
        try {
            if (!ensureAdmin(req, res)) return;
            const record = proxyPoolService ? await proxyPoolService.createProxy(req.body || {}) : null;
            return res.json({ ok: true, data: record });
        } catch (error) {
            return res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/proxies/import', authRequired, userRequired, async (req, res) => {
        try {
            if (!ensureAdmin(req, res)) return;
            const result = proxyPoolService
                ? await proxyPoolService.importFromText(req.body?.text || '', req.body?.mode || 'append')
                : { added: 0, skipped: 0, total: 0 };
            return res.json({ ok: true, data: result });
        } catch (error) {
            return res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/proxies/health-check', authRequired, userRequired, async (req, res) => {
        try {
            if (!ensureAdmin(req, res)) return;
            const result = proxyPoolService
                ? await proxyPoolService.healthCheck(req.body?.ids, { timeoutMs: req.body?.timeoutMs })
                : { checkedAt: Date.now(), results: [], list: [] };
            return res.json({ ok: true, data: result });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.delete('/api/admin/proxies/:id', authRequired, userRequired, async (req, res) => {
        try {
            if (!ensureAdmin(req, res)) return;
            if (proxyPoolService) {
                await proxyPoolService.remove(req.params.id);
            }
            return res.json({ ok: true });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = {
    registerProxyAdminRoutes,
};
