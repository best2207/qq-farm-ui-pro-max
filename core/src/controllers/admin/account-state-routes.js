function registerAccountStateRoutes({
    app,
    accountOwnershipRequired,
    getAccId,
    getProvider,
    handleApiError,
    getLevelExpProgress,
    loadFriendsCacheApi,
}) {
    async function getCachedFriendsData(id) {
        const { getCachedFriends } = loadFriendsCacheApi();
        if (!getCachedFriends) return [];
        const data = await getCachedFriends(id);
        return Array.isArray(data) ? data : [];
    }

    function syncFriendsCache(id, data) {
        const { updateFriendsCache, mergeFriendsCache } = loadFriendsCacheApi();
        const syncFn = mergeFriendsCache || updateFriendsCache;
        if (!syncFn || !Array.isArray(data) || data.length === 0) return;
        syncFn(id, data).catch(() => { });
    }

    function normalizeFriendsMeta(meta) {
        if (!meta || typeof meta !== 'object') {
            return null;
        }
        const source = String(meta.source || '').trim();
        const reason = String(meta.reason || '').trim();
        const platform = String(meta.platform || '').trim();
        const cacheSource = String(meta.cacheSource || '').trim();
        const seededCount = Math.max(0, Number(meta.seededCount || 0));
        const conservative = typeof meta.conservative === 'boolean' ? meta.conservative : undefined;
        const realtimeAvailable = typeof meta.realtimeAvailable === 'boolean' ? meta.realtimeAvailable : undefined;
        const cooldownUntil = Math.max(0, Number(meta.cooldownUntil || 0));
        const syncAllUnsupportedUntil = Math.max(0, Number(meta.syncAllUnsupportedUntil || 0));
        const hasPayload = source || reason || platform || cacheSource || conservative !== undefined || realtimeAvailable !== undefined || cooldownUntil > 0 || syncAllUnsupportedUntil > 0 || seededCount > 0;
        if (!hasPayload) {
            return null;
        }
        const normalized = {};
        if (source) normalized.source = source;
        if (reason) normalized.reason = reason;
        if (platform) normalized.platform = platform;
        if (cacheSource) normalized.cacheSource = cacheSource;
        if (seededCount > 0) normalized.seededCount = seededCount;
        if (conservative !== undefined) normalized.conservative = conservative;
        if (realtimeAvailable !== undefined) normalized.realtimeAvailable = realtimeAvailable;
        if (cooldownUntil > 0) normalized.cooldownUntil = cooldownUntil;
        if (syncAllUnsupportedUntil > 0) normalized.syncAllUnsupportedUntil = syncAllUnsupportedUntil;
        return normalized;
    }

    function extractFriendsDataAndMeta(payload) {
        if (Array.isArray(payload)) {
            return {
                data: payload,
                meta: normalizeFriendsMeta(payload._meta),
            };
        }
        if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
            return {
                data: payload.data,
                meta: normalizeFriendsMeta(payload.meta),
            };
        }
        return {
            data: [],
            meta: null,
        };
    }

    function buildFriendsCacheMeta(baseMeta, fallbackReason) {
        const normalized = normalizeFriendsMeta(baseMeta) || {};
        return normalizeFriendsMeta({
            ...normalized,
            source: 'cache',
            reason: normalized.reason || fallbackReason || 'cache_fallback',
        });
    }

    function isTruthyQueryFlag(value) {
        const text = String(value || '').trim().toLowerCase();
        return text === '1' || text === 'true' || text === 'yes' || text === 'on';
    }

    function countInteractSeedCandidates(records) {
        return [...new Set(
            (Array.isArray(records) ? records : [])
                .map(record => Number(record && record.visitorGid) || 0)
                .filter(gid => gid > 0)
        )].length;
    }

    async function getAccountPlatform(id) {
        try {
            const status = await getProvider().getStatus(id);
            return String(status && status.status && status.status.platform || '').trim();
        } catch {
            return '';
        }
    }

    async function getFriendsWithFallback(id, options = {}) {
        try {
            const payload = await getProvider().getFriends(id, options);
            const { data, meta } = extractFriendsDataAndMeta(payload);
            if (Array.isArray(data) && data.length > 0) {
                syncFriendsCache(id, data);
                return { data, meta };
            }
            const cached = await getCachedFriendsData(id);
            if (cached.length > 0) {
                return {
                    data: cached,
                    meta: buildFriendsCacheMeta(meta, 'cache_fallback'),
                };
            }
            return {
                data: Array.isArray(data) ? data : [],
                meta,
            };
        } catch (err) {
            const cached = await getCachedFriendsData(id);
            if (cached.length > 0) {
                return {
                    data: cached,
                    meta: buildFriendsCacheMeta({
                        source: 'cache',
                        reason: 'worker_error',
                    }, 'worker_error'),
                };
            }
            throw err;
        }
    }

    app.get('/api/status', accountOwnershipRequired, async (req, res) => {
        const id = await getAccId(req);
        if (!id) return res.json({ ok: false, error: '缺少账号标识 (x-account-id)' });

        try {
            const data = await getProvider().getStatus(id);
            if (data && data.status) {
                const { level, exp } = data.status;
                data.levelProgress = getLevelExpProgress(level, exp);
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    app.get('/api/lands', accountOwnershipRequired, async (req, res) => {
        const id = await getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const data = await getProvider().getLands(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.get('/api/friends', accountOwnershipRequired, async (req, res) => {
        const id = await getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const result = await getFriendsWithFallback(id, {
                manualRefresh: isTruthyQueryFlag(req.query && req.query.refresh),
            });
            res.json({
                ok: true,
                data: Array.isArray(result.data) ? [...result.data] : [],
                ...(result.meta ? { meta: result.meta } : {}),
            });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.get('/api/friends/cache', accountOwnershipRequired, async (req, res) => {
        const id = await getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            let data = await getCachedFriendsData(id);
            if (data.length === 0) {
                const result = await getFriendsWithFallback(id);
                data = Array.isArray(result && result.data) ? result.data : [];
            }
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.post('/api/friends/seed-cache', accountOwnershipRequired, async (req, res) => {
        const id = await getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: '缺少账号标识 (x-account-id)' });

        const limit = Math.max(1, Math.min(200, Number(req.body && req.body.limit || 100) || 100));
        const platform = await getAccountPlatform(id);
        let records = [];
        let interactError = null;
        let interactErrorCode = '';

        try {
            records = await getProvider().getInteractRecords(id, limit);
        } catch (e) {
            interactError = e;
            interactErrorCode = String((e && e.code) || '').trim();
        }

        const cached = await getCachedFriendsData(id);
        const seededCount = countInteractSeedCandidates(records);
        const baseMeta = normalizeFriendsMeta({
            source: cached.length > 0 ? 'cache' : 'empty',
            reason: cached.length > 0
                ? (seededCount > 0 ? 'interact_seeded' : 'cache_fallback')
                : (interactError ? 'interact_seed_error' : 'interact_seed_empty'),
            platform,
            conservative: true,
            realtimeAvailable: false,
            cacheSource: 'interact_records',
            seededCount,
        });

        if (cached.length > 0) {
            return res.json({
                ok: true,
                data: cached,
                meta: baseMeta,
                seededCount,
                interactCount: Array.isArray(records) ? records.length : 0,
            });
        }

        if (interactError && interactErrorCode.startsWith('INTERACT_')) {
            return res.json({
                ok: false,
                error: String(interactError.message || '访客记录接口失败'),
                errorCode: interactErrorCode,
                data: [],
                meta: baseMeta,
                seededCount,
                interactCount: Array.isArray(records) ? records.length : 0,
            });
        }

        if (interactError) {
            return handleApiError(res, interactError);
        }

        return res.json({
            ok: true,
            data: [],
            meta: baseMeta,
            seededCount,
            interactCount: Array.isArray(records) ? records.length : 0,
        });
    });

    app.get('/api/friend/:gid/lands', accountOwnershipRequired, async (req, res) => {
        const id = await getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const data = await getProvider().getFriendLands(id, req.params.gid);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.get('/api/interact-records', accountOwnershipRequired, async (req, res) => {
        const id = await getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: '缺少账号标识 (x-account-id)' });
        try {
            const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50) || 50));
            const data = await getProvider().getInteractRecords(id, limit);
            res.json({ ok: true, data });
        } catch (e) {
            const errorCode = String((e && e.code) || '').trim();
            if (errorCode.startsWith('INTERACT_')) {
                return res.json({ ok: false, error: String(e.message || '访客记录接口失败'), errorCode });
            }
            handleApiError(res, e);
        }
    });
}

module.exports = {
    registerAccountStateRoutes,
};
