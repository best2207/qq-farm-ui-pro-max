const net = require('node:net');
const { getSystemSetting, setSystemSetting, SYSTEM_SETTING_KEYS } = require('./system-settings');

const DEFAULT_PROXY_POOL_CONFIG = Object.freeze({
    enabled: true,
    healthCheckTimeoutMs: 6000,
    healthCheckBatchSize: 20,
    defaultMaxUsersPerProxy: 10,
    cooldownMs: 5 * 60 * 1000,
    selectionStrategy: 'healthy_first',
    autoAssignEnabled: false,
});

function normalizeProxyPoolConfig(input, fallback = DEFAULT_PROXY_POOL_CONFIG) {
    const data = (input && typeof input === 'object') ? input : {};
    const current = (fallback && typeof fallback === 'object') ? fallback : DEFAULT_PROXY_POOL_CONFIG;
    const selectionStrategy = new Set(['round_robin', 'least_load', 'healthy_first']).has(String(data.selectionStrategy || '').trim())
        ? String(data.selectionStrategy || '').trim()
        : String(current.selectionStrategy || DEFAULT_PROXY_POOL_CONFIG.selectionStrategy);
    return {
        enabled: data.enabled !== undefined ? !!data.enabled : !!current.enabled,
        healthCheckTimeoutMs: Math.max(1000, Number(data.healthCheckTimeoutMs) || current.healthCheckTimeoutMs),
        healthCheckBatchSize: Math.max(1, Number(data.healthCheckBatchSize) || current.healthCheckBatchSize),
        defaultMaxUsersPerProxy: Math.max(1, Number(data.defaultMaxUsersPerProxy) || current.defaultMaxUsersPerProxy),
        cooldownMs: Math.max(1000, Number(data.cooldownMs) || current.cooldownMs),
        selectionStrategy,
        autoAssignEnabled: data.autoAssignEnabled !== undefined ? !!data.autoAssignEnabled : !!current.autoAssignEnabled,
    };
}

async function getProxyPoolConfig() {
    const stored = await getSystemSetting(SYSTEM_SETTING_KEYS.PROXY_POOL_CONFIG, DEFAULT_PROXY_POOL_CONFIG);
    return normalizeProxyPoolConfig(stored, DEFAULT_PROXY_POOL_CONFIG);
}

async function setProxyPoolConfig(input) {
    const next = normalizeProxyPoolConfig(input, await getProxyPoolConfig());
    await setSystemSetting(SYSTEM_SETTING_KEYS.PROXY_POOL_CONFIG, next);
    return next;
}

function maskProxyUrl(proxyUrl = '') {
    try {
        const url = new URL(String(proxyUrl || '').trim());
        if (url.password) {
            url.password = '***';
        }
        return url.toString();
    } catch {
        return String(proxyUrl || '').trim().replace(/:([^:@/]+)@/g, ':***@');
    }
}

function parseProxyUrl(proxyUrl = '') {
    const raw = String(proxyUrl || '').trim();
    if (!raw) {
        throw new Error('代理地址不能为空');
    }
    const normalized = raw.includes('://') ? raw : `socks5://${raw}`;
    const url = new URL(normalized);
    const protocol = String(url.protocol || '').replace(/:$/, '').toLowerCase();
    if (!new Set(['socks5', 'socks5h']).has(protocol)) {
        throw new Error('当前仅支持 socks5 / socks5h 代理');
    }
    const port = Number.parseInt(url.port || '', 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new Error('代理端口无效');
    }
    return {
        proxyUrl: normalized,
        maskedProxyUrl: maskProxyUrl(normalized),
        protocol,
        host: String(url.hostname || '').trim(),
        port,
        username: url.username ? decodeURIComponent(url.username) : '',
        password: url.password ? decodeURIComponent(url.password) : '',
    };
}

function serializeRow(row = {}) {
    return {
        id: String(row.id || '').trim(),
        proxyUrl: String(row.proxy_url || '').trim(),
        maskedProxyUrl: String(row.masked_proxy_url || '').trim(),
        protocol: String(row.protocol || 'socks5').trim(),
        host: String(row.host || '').trim(),
        port: Number(row.port) || 0,
        username: String(row.username || '').trim(),
        note: String(row.note || '').trim(),
        status: String(row.status || 'unknown').trim(),
        maxUsers: Math.max(1, Number(row.max_users) || 10),
        successCount: Math.max(0, Number(row.success_count) || 0),
        failCount: Math.max(0, Number(row.fail_count) || 0),
        avgLatencyMs: Math.max(0, Number(row.avg_latency_ms) || 0),
        lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).getTime() : 0,
        lastFailAt: row.last_fail_at ? new Date(row.last_fail_at).getTime() : 0,
        cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0,
        lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at).getTime() : 0,
        createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
    };
}

function createTcpHealthProbe(target, timeoutMs = 6000) {
    return new Promise((resolve) => {
        const startAt = Date.now();
        const socket = new net.Socket();
        let settled = false;

        const finish = (payload) => {
            if (settled) return;
            settled = true;
            try {
                socket.destroy();
            } catch { }
            resolve(payload);
        };

        socket.setTimeout(Math.max(1000, Number(timeoutMs) || 6000));
        socket.once('connect', () => finish({
            ok: true,
            latencyMs: Math.max(1, Date.now() - startAt),
        }));
        socket.once('timeout', () => finish({
            ok: false,
            latencyMs: Math.max(1, Date.now() - startAt),
            error: '连接超时',
        }));
        socket.once('error', (error) => finish({
            ok: false,
            latencyMs: Math.max(1, Date.now() - startAt),
            error: error && error.message ? error.message : '连接失败',
        }));
        socket.connect(target.port, target.host);
    });
}

function createProxyPoolService({ getPool }) {
    async function getPoolRef() {
        const pool = typeof getPool === 'function' ? getPool() : null;
        if (!pool) {
            throw new Error('数据库连接池不可用');
        }
        return pool;
    }

    async function list() {
        const pool = await getPoolRef();
        const [rows] = await pool.query('SELECT * FROM network_proxies ORDER BY updated_at DESC, id DESC');
        return Array.isArray(rows) ? rows.map(serializeRow) : [];
    }

    async function createProxy(input = {}) {
        const parsed = parseProxyUrl(input.proxyUrl || input.proxy_url || '');
        const pool = await getPoolRef();
        const config = await getProxyPoolConfig();
        const maxUsers = Math.max(1, Number.parseInt(input.maxUsers || input.max_users, 10) || config.defaultMaxUsersPerProxy);
        const note = String(input.note || '').trim();
        await pool.query(
            `INSERT INTO network_proxies
            (proxy_url, masked_proxy_url, protocol, host, port, username, password_encrypted, note, status, max_users)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?)
            ON DUPLICATE KEY UPDATE
              masked_proxy_url = VALUES(masked_proxy_url),
              protocol = VALUES(protocol),
              host = VALUES(host),
              port = VALUES(port),
              username = VALUES(username),
              password_encrypted = VALUES(password_encrypted),
              note = VALUES(note),
              max_users = VALUES(max_users)`,
            [
                parsed.proxyUrl,
                parsed.maskedProxyUrl,
                parsed.protocol,
                parsed.host,
                parsed.port,
                parsed.username || null,
                parsed.password ? Buffer.from(parsed.password).toString('base64') : null,
                note || null,
                maxUsers,
            ],
        );
        const [rows] = await pool.query('SELECT * FROM network_proxies WHERE proxy_url = ? LIMIT 1', [parsed.proxyUrl]);
        const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
        return row ? serializeRow(row) : null;
    }

    async function importFromText(text = '', mode = 'append') {
        const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (lines.length <= 0) {
            return { added: 0, skipped: 0, total: 0 };
        }
        const uniqueLines = [...new Set(lines)];
        if (String(mode || '').trim() === 'replace') {
            const pool = await getPoolRef();
            await pool.query('DELETE FROM network_proxies');
        }
        let added = 0;
        let skipped = 0;
        for (const line of uniqueLines) {
            try {
                const created = await createProxy({ proxyUrl: line });
                if (created) added += 1;
            } catch {
                skipped += 1;
            }
        }
        const current = await list();
        return {
            added,
            skipped,
            total: current.length,
        };
    }

    async function remove(id) {
        const pool = await getPoolRef();
        await pool.query('DELETE FROM network_proxies WHERE id = ?', [id]);
        return true;
    }

    async function healthCheck(ids = [], options = {}) {
        const pool = await getPoolRef();
        const config = await getProxyPoolConfig();
        const normalizedIds = Array.isArray(ids) ? ids.map(item => String(item || '').trim()).filter(Boolean) : [];
        const sql = normalizedIds.length > 0
            ? `SELECT * FROM network_proxies WHERE id IN (${normalizedIds.map(() => '?').join(',')}) ORDER BY id DESC`
            : 'SELECT * FROM network_proxies ORDER BY id DESC';
        const [rows] = await pool.query(sql, normalizedIds);
        const timeoutMs = Math.max(1000, Number(options.timeoutMs) || config.healthCheckTimeoutMs);
        const batchSize = Math.max(1, Number(options.batchSize) || config.healthCheckBatchSize);
        const cooldownMs = Math.max(1000, Number(options.cooldownMs) || config.cooldownMs);
        const results = [];
        for (const row of (Array.isArray(rows) ? rows : []).slice(0, batchSize)) {
            const target = serializeRow(row);
            const probe = await createTcpHealthProbe(target, timeoutMs);
            const status = probe.ok ? 'healthy' : 'cooldown';
            const avgLatencyMs = probe.ok
                ? Math.max(1, Math.round(((Number(target.avgLatencyMs) || 0) + probe.latencyMs) / ((target.successCount || 0) > 0 ? 2 : 1)))
                : Math.max(0, Number(target.avgLatencyMs) || 0);
            await pool.query(
                `UPDATE network_proxies
                 SET status = ?,
                     success_count = success_count + ?,
                     fail_count = fail_count + ?,
                     avg_latency_ms = ?,
                     last_success_at = ?,
                     last_fail_at = ?,
                     cooldown_until = ?,
                     last_checked_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    status,
                    probe.ok ? 1 : 0,
                    probe.ok ? 0 : 1,
                    avgLatencyMs,
                    probe.ok ? new Date() : null,
                    probe.ok ? null : new Date(),
                    probe.ok ? null : new Date(Date.now() + cooldownMs),
                    row.id,
                ],
            );
            results.push({
                id: String(row.id || '').trim(),
                ok: probe.ok,
                latencyMs: probe.latencyMs,
                error: probe.error || '',
            });
        }
        return {
            checkedAt: Date.now(),
            results,
            list: await list(),
        };
    }

    return {
        list,
        createProxy,
        importFromText,
        remove,
        healthCheck,
        parseProxyUrl,
    };
}

module.exports = {
    createProxyPoolService,
    parseProxyUrl,
    maskProxyUrl,
    DEFAULT_PROXY_POOL_CONFIG,
    normalizeProxyPoolConfig,
    getProxyPoolConfig,
    setProxyPoolConfig,
};
