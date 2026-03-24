const {
    createExternalApiMiddleware,
    listExternalApiClients,
    createExternalApiClient,
    rotateExternalApiClient,
    revokeExternalApiClient,
} = require('../../services/external-api-auth');

function filterAccountsForClient(accounts = [], client = null) {
    const list = Array.isArray(accounts) ? accounts : [];
    const allowedAccountIds = Array.isArray(client && client.allowedAccountIds)
        ? client.allowedAccountIds.map(item => String(item || '').trim()).filter(Boolean)
        : [];
    const filtered = allowedAccountIds.length > 0
        ? list.filter(item => allowedAccountIds.includes(String(item && item.id || '').trim()))
        : list;

    return filtered.map((item) => {
        const wsError = item && item.wsError && typeof item.wsError === 'object' ? item.wsError : null;
        return {
            id: String(item && item.id || '').trim(),
            name: String(item && (item.name || item.nick || item.username || item.id) || '').trim(),
            username: String(item && item.username || '').trim(),
            level: Number(item && item.level) || 0,
            status: item && item.status ? item.status : null,
            needsRelogin: Number(wsError && wsError.code) === 400,
            banned: Number(wsError && wsError.code) === 1000016,
            lastLoginAt: item && (item.lastLoginAt || item.last_login_at) ? (item.lastLoginAt || item.last_login_at) : null,
        };
    });
}

function ensureAdmin(req, res) {
    if (req.currentUser?.role !== 'admin') {
        res.status(403).json({ ok: false, error: 'Forbidden' });
        return false;
    }
    return true;
}

function registerExternalApiRoutes({
    app,
    authRequired,
    userRequired,
    getAccountsSnapshot,
    statsSummaryService,
    healthProbeService,
}) {
    const externalAny = createExternalApiMiddleware([]);
    const externalHealth = createExternalApiMiddleware(['read:health']);
    const externalAccounts = createExternalApiMiddleware(['read:accounts']);
    const externalStats = createExternalApiMiddleware(['read:stats']);

    app.get('/api/external/ping', externalAny, async (req, res) => {
        res.json({
            ok: true,
            data: {
                ok: true,
                checkedAt: Date.now(),
                client: req.externalApiClient,
            },
        });
    });

    app.get('/api/external/health', externalHealth, async (req, res) => {
        try {
            const basic = healthProbeService ? await healthProbeService.getBasicSnapshot() : null;
            const dependencies = healthProbeService ? await healthProbeService.getDependenciesSnapshot() : null;
            res.json({ ok: true, data: { basic, dependencies } });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/external/accounts', externalAccounts, async (req, res) => {
        try {
            const snapshot = typeof getAccountsSnapshot === 'function'
                ? await getAccountsSnapshot()
                : { accounts: [] };
            res.json({
                ok: true,
                data: {
                    total: Array.isArray(snapshot && snapshot.accounts) ? snapshot.accounts.length : 0,
                    items: filterAccountsForClient(snapshot && snapshot.accounts, req.externalApiClient),
                },
            });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/external/stats/summary', externalStats, async (req, res) => {
        try {
            const data = statsSummaryService
                ? await statsSummaryService.getSummary()
                : null;
            res.json({ ok: true, data });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/admin/external-api-clients', authRequired, userRequired, async (req, res) => {
        if (!ensureAdmin(req, res)) return;
        try {
            const clients = await listExternalApiClients();
            res.json({ ok: true, data: clients });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/external-api-clients', authRequired, userRequired, async (req, res) => {
        if (!ensureAdmin(req, res)) return;
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const data = await createExternalApiClient(body, String(req.currentUser?.username || '').trim());
            res.json({ ok: true, data });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/external-api-clients/:id/rotate', authRequired, userRequired, async (req, res) => {
        if (!ensureAdmin(req, res)) return;
        try {
            const data = await rotateExternalApiClient(req.params.id, String(req.currentUser?.username || '').trim());
            res.json({ ok: true, data });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/external-api-clients/:id/revoke', authRequired, userRequired, async (req, res) => {
        if (!ensureAdmin(req, res)) return;
        try {
            const data = await revokeExternalApiClient(req.params.id);
            res.json({ ok: true, data });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = {
    registerExternalApiRoutes,
};
