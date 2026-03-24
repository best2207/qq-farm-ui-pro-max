const crypto = require('node:crypto');
const { getSystemSetting, setSystemSetting, SYSTEM_SETTING_KEYS } = require('./system-settings');

const DEFAULT_EXTERNAL_API_CLIENTS_CONFIG = Object.freeze({
    clients: [],
    defaultRateLimitPerMinute: 60,
    defaultIpAllowlist: [],
});

function createClientId() {
    return `ext_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function generatePlainToken() {
    return `xfa_${crypto.randomBytes(24).toString('hex')}`;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => String(item || '').trim()).filter(Boolean);
}

function normalizeAccountIds(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => String(item || '').trim()).filter(Boolean);
}

function normalizeExternalApiClient(input, fallback = {}) {
    const data = (input && typeof input === 'object') ? input : {};
    return {
        id: String(data.id || fallback.id || createClientId()).trim(),
        name: String(data.name || fallback.name || '').trim() || '未命名外部客户端',
        tokenHash: String(data.tokenHash || fallback.tokenHash || '').trim(),
        status: String(data.status || fallback.status || 'active').trim() === 'revoked' ? 'revoked' : 'active',
        scopes: normalizeStringArray(data.scopes !== undefined ? data.scopes : fallback.scopes),
        allowedPaths: normalizeStringArray(data.allowedPaths !== undefined ? data.allowedPaths : fallback.allowedPaths),
        allowedAccountIds: normalizeAccountIds(data.allowedAccountIds !== undefined ? data.allowedAccountIds : fallback.allowedAccountIds),
        expiresAt: Number(data.expiresAt || fallback.expiresAt || 0) || 0,
        lastUsedAt: Number(data.lastUsedAt || fallback.lastUsedAt || 0) || 0,
        createdAt: Number(data.createdAt || fallback.createdAt || Date.now()) || Date.now(),
        createdBy: String(data.createdBy || fallback.createdBy || '').trim(),
        updatedAt: Number(data.updatedAt || fallback.updatedAt || Date.now()) || Date.now(),
        note: String(data.note || fallback.note || '').trim(),
    };
}

function normalizeExternalApiClientsConfig(input, fallback = DEFAULT_EXTERNAL_API_CLIENTS_CONFIG) {
    const data = (input && typeof input === 'object') ? input : {};
    const current = (fallback && typeof fallback === 'object') ? fallback : DEFAULT_EXTERNAL_API_CLIENTS_CONFIG;
    return {
        clients: Array.isArray(data.clients)
            ? data.clients.map(item => normalizeExternalApiClient(item))
            : Array.isArray(current.clients) ? current.clients.map(item => normalizeExternalApiClient(item)) : [],
        defaultRateLimitPerMinute: Math.max(1, Number(data.defaultRateLimitPerMinute) || current.defaultRateLimitPerMinute || DEFAULT_EXTERNAL_API_CLIENTS_CONFIG.defaultRateLimitPerMinute),
        defaultIpAllowlist: normalizeStringArray(data.defaultIpAllowlist !== undefined ? data.defaultIpAllowlist : current.defaultIpAllowlist),
    };
}

async function getExternalApiClientsConfig() {
    const stored = await getSystemSetting(
        SYSTEM_SETTING_KEYS.EXTERNAL_API_CLIENTS,
        DEFAULT_EXTERNAL_API_CLIENTS_CONFIG,
    );
    return normalizeExternalApiClientsConfig(stored, DEFAULT_EXTERNAL_API_CLIENTS_CONFIG);
}

async function saveExternalApiClientsConfig(nextConfig) {
    const normalized = normalizeExternalApiClientsConfig(nextConfig, DEFAULT_EXTERNAL_API_CLIENTS_CONFIG);
    await setSystemSetting(SYSTEM_SETTING_KEYS.EXTERNAL_API_CLIENTS, normalized);
    return normalized;
}

function sanitizeClient(client) {
    return {
        id: client.id,
        name: client.name,
        status: client.status,
        scopes: [...client.scopes],
        allowedPaths: [...client.allowedPaths],
        allowedAccountIds: [...client.allowedAccountIds],
        expiresAt: client.expiresAt,
        lastUsedAt: client.lastUsedAt,
        createdAt: client.createdAt,
        createdBy: client.createdBy,
        updatedAt: client.updatedAt,
        note: client.note,
    };
}

function isClientScopeSatisfied(client, requiredScopes = []) {
    const scopes = new Set((client.scopes || []).map(item => String(item || '').trim()));
    if (scopes.has('*') || scopes.has('read:all')) {
        return true;
    }
    return requiredScopes.every(scope => scopes.has(scope));
}

function isPathAllowed(client, requestPath) {
    const allowedPaths = Array.isArray(client.allowedPaths) ? client.allowedPaths : [];
    if (allowedPaths.length === 0) {
        return true;
    }
    const path = String(requestPath || '').trim();
    return allowedPaths.some(prefix => path.startsWith(String(prefix || '').trim()));
}

async function listExternalApiClients() {
    const config = await getExternalApiClientsConfig();
    return config.clients.map(sanitizeClient);
}

async function createExternalApiClient(payload = {}, actorUsername = '') {
    const config = await getExternalApiClientsConfig();
    const plainToken = generatePlainToken();
    const now = Date.now();
    const client = normalizeExternalApiClient({
        ...payload,
        id: createClientId(),
        tokenHash: hashToken(plainToken),
        createdAt: now,
        updatedAt: now,
        createdBy: actorUsername,
        status: 'active',
    });
    config.clients.unshift(client);
    await saveExternalApiClientsConfig(config);
    return {
        client: sanitizeClient(client),
        plainToken,
    };
}

async function rotateExternalApiClient(id, actorUsername = '') {
    const config = await getExternalApiClientsConfig();
    const targetId = String(id || '').trim();
    const index = config.clients.findIndex(item => item.id === targetId);
    if (index < 0) {
        throw new Error('外部 API 客户端不存在');
    }
    const plainToken = generatePlainToken();
    config.clients[index] = normalizeExternalApiClient({
        ...config.clients[index],
        tokenHash: hashToken(plainToken),
        updatedAt: Date.now(),
        createdBy: config.clients[index].createdBy || actorUsername,
        status: 'active',
    }, config.clients[index]);
    await saveExternalApiClientsConfig(config);
    return {
        client: sanitizeClient(config.clients[index]),
        plainToken,
    };
}

async function revokeExternalApiClient(id) {
    const config = await getExternalApiClientsConfig();
    const targetId = String(id || '').trim();
    const index = config.clients.findIndex(item => item.id === targetId);
    if (index < 0) {
        throw new Error('外部 API 客户端不存在');
    }
    config.clients[index] = normalizeExternalApiClient({
        ...config.clients[index],
        status: 'revoked',
        updatedAt: Date.now(),
    }, config.clients[index]);
    await saveExternalApiClientsConfig(config);
    return sanitizeClient(config.clients[index]);
}

async function touchExternalApiClient(id) {
    const config = await getExternalApiClientsConfig();
    const targetId = String(id || '').trim();
    const index = config.clients.findIndex(item => item.id === targetId);
    if (index < 0) return;
    config.clients[index] = normalizeExternalApiClient({
        ...config.clients[index],
        lastUsedAt: Date.now(),
        updatedAt: Date.now(),
    }, config.clients[index]);
    await saveExternalApiClientsConfig(config);
}

function extractRequestToken(req) {
    const headerToken = String(req.headers['x-api-key'] || '').trim();
    if (headerToken) return headerToken;
    const authHeader = String(req.headers.authorization || '').trim();
    if (/^Bearer\s+/i.test(authHeader)) {
        return authHeader.replace(/^Bearer\s+/i, '').trim();
    }
    return '';
}

async function authenticateExternalApiRequest(req, requiredScopes = []) {
    const token = extractRequestToken(req);
    if (!token) {
        return { ok: false, statusCode: 401, error: '缺少外部 API Key' };
    }
    const tokenHash = hashToken(token);
    const config = await getExternalApiClientsConfig();
    const client = config.clients.find(item => item.tokenHash === tokenHash);
    if (!client) {
        return { ok: false, statusCode: 401, error: '外部 API Key 无效' };
    }
    if (client.status === 'revoked') {
        return { ok: false, statusCode: 403, error: '外部 API Key 已吊销' };
    }
    if (client.expiresAt && client.expiresAt > 0 && client.expiresAt < Date.now()) {
        return { ok: false, statusCode: 403, error: '外部 API Key 已过期' };
    }
    if (!isClientScopeSatisfied(client, requiredScopes)) {
        return { ok: false, statusCode: 403, error: '外部 API Key 权限不足' };
    }
    if (!isPathAllowed(client, req.path || req.originalUrl || '')) {
        return { ok: false, statusCode: 403, error: '当前路径不在外部 API Key 白名单内' };
    }

    req.externalApiClient = sanitizeClient(client);
    touchExternalApiClient(client.id).catch(() => null);
    return { ok: true, client: req.externalApiClient };
}

function createExternalApiMiddleware(requiredScopes = []) {
    return async (req, res, next) => {
        try {
            const result = await authenticateExternalApiRequest(req, requiredScopes);
            if (!result.ok) {
                return res.status(result.statusCode || 401).json({ ok: false, error: result.error || 'Unauthorized' });
            }
            return next();
        } catch (error) {
            return res.status(500).json({
                ok: false,
                error: error && error.message ? error.message : String(error),
            });
        }
    };
}

module.exports = {
    DEFAULT_EXTERNAL_API_CLIENTS_CONFIG,
    normalizeExternalApiClient,
    normalizeExternalApiClientsConfig,
    getExternalApiClientsConfig,
    saveExternalApiClientsConfig,
    listExternalApiClients,
    createExternalApiClient,
    rotateExternalApiClient,
    revokeExternalApiClient,
    authenticateExternalApiRequest,
    createExternalApiMiddleware,
    sanitizeClient,
};
