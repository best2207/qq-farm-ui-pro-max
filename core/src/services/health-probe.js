const { getPoolStatus } = require('./mysql-db');
const { getRedisClient } = require('./redis-cache');
const { getSystemSetting, setSystemSetting, SYSTEM_SETTING_KEYS } = require('./system-settings');

const DEFAULT_HEALTH_PROBE_CONFIG = Object.freeze({
    dependencyTimeoutMs: 2500,
    runtimeWorkerOfflineThresholdSec: 120,
    warnReloginQueueCount: 5,
    warnFailedAccountCount: 3,
    includeAiService: true,
});

function normalizeHealthProbeConfig(input, fallback = DEFAULT_HEALTH_PROBE_CONFIG) {
    const data = (input && typeof input === 'object') ? input : {};
    const current = (fallback && typeof fallback === 'object') ? fallback : DEFAULT_HEALTH_PROBE_CONFIG;
    return {
        dependencyTimeoutMs: Math.max(300, Number(data.dependencyTimeoutMs) || current.dependencyTimeoutMs),
        runtimeWorkerOfflineThresholdSec: Math.max(10, Number(data.runtimeWorkerOfflineThresholdSec) || current.runtimeWorkerOfflineThresholdSec),
        warnReloginQueueCount: Math.max(0, Number(data.warnReloginQueueCount) || current.warnReloginQueueCount),
        warnFailedAccountCount: Math.max(0, Number(data.warnFailedAccountCount) || current.warnFailedAccountCount),
        includeAiService: data.includeAiService !== undefined ? !!data.includeAiService : !!current.includeAiService,
    };
}

async function getHealthProbeConfig() {
    const stored = await getSystemSetting(SYSTEM_SETTING_KEYS.HEALTH_PROBE_CONFIG, DEFAULT_HEALTH_PROBE_CONFIG);
    return normalizeHealthProbeConfig(stored, DEFAULT_HEALTH_PROBE_CONFIG);
}

async function setHealthProbeConfig(input) {
    const next = normalizeHealthProbeConfig(input, await getHealthProbeConfig());
    await setSystemSetting(SYSTEM_SETTING_KEYS.HEALTH_PROBE_CONFIG, next);
    return next;
}

function withTimeout(promise, timeoutMs, label) {
    let timer = null;
    return Promise.race([
        Promise.resolve(promise).finally(() => {
            if (timer) clearTimeout(timer);
        }),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label || 'probe'} timeout`)), timeoutMs);
        }),
    ]);
}

function summarizeWebAssets(inspectWebDistState) {
    if (typeof inspectWebDistState !== 'function') {
        return {
            ok: false,
            status: 'unknown',
            activeDir: '',
            reason: 'web_dist_probe_unavailable',
        };
    }
    const state = inspectWebDistState();
    return {
        ok: !!state.activeHasAssets,
        status: state.activeHasAssets ? 'ready' : 'missing',
        activeDir: state.activeDirRelative,
        activeSource: state.activeSource,
        selectionReason: state.selectionReason,
        buildTargetDir: state.buildTargetDirRelative,
        defaultDir: state.defaultDirRelative,
        fallbackDir: state.fallbackDirRelative,
    };
}

function createHealthProbeService({
    getPool,
    getAccountsSnapshot,
    inspectSystemSettingsHealth,
    inspectWebDistState,
    getSchedulerRegistrySnapshot,
    version,
    processRef,
    readAiServiceStatus,
    resolveServiceProfile,
}) {
    async function getBasicSnapshot() {
        const profile = typeof resolveServiceProfile === 'function'
            ? await Promise.resolve(resolveServiceProfile()).catch(() => null)
            : null;
        return {
            ok: true,
            version,
            uptimeSec: Number(processRef && typeof processRef.uptime === 'function' ? processRef.uptime() : 0),
            checkedAt: Date.now(),
            profile,
        };
    }

    async function getDependenciesSnapshot() {
        const config = await getHealthProbeConfig();
        const pool = typeof getPool === 'function' ? getPool() : null;
        const mysql = {
            ok: false,
            status: 'down',
            error: '',
            pool: getPoolStatus(),
        };
        const redis = {
            ok: false,
            status: 'disabled',
            error: '',
        };
        const systemSettings = {
            ok: false,
            status: 'unknown',
            data: null,
            error: '',
        };
        const webAssets = summarizeWebAssets(inspectWebDistState);
        const aiService = {
            ok: false,
            status: config.includeAiService ? 'unknown' : 'skipped',
            error: '',
            data: null,
        };

        if (pool) {
            try {
                await withTimeout(pool.query('SELECT 1 AS ok'), config.dependencyTimeoutMs, 'mysql');
                mysql.ok = true;
                mysql.status = 'up';
            } catch (error) {
                mysql.error = error && error.message ? error.message : String(error);
            }
        } else {
            mysql.error = 'mysql pool unavailable';
        }

        const redisClient = getRedisClient();
        if (redisClient) {
            try {
                await withTimeout(redisClient.ping(), config.dependencyTimeoutMs, 'redis');
                redis.ok = true;
                redis.status = 'up';
            } catch (error) {
                redis.status = 'down';
                redis.error = error && error.message ? error.message : String(error);
            }
        }

        if (typeof inspectSystemSettingsHealth === 'function') {
            try {
                const data = await withTimeout(inspectSystemSettingsHealth(), config.dependencyTimeoutMs, 'system_settings');
                systemSettings.ok = !!(data && data.ok);
                systemSettings.status = systemSettings.ok ? 'ready' : 'warning';
                systemSettings.data = data;
            } catch (error) {
                systemSettings.status = 'down';
                systemSettings.error = error && error.message ? error.message : String(error);
            }
        }

        if (config.includeAiService && typeof readAiServiceStatus === 'function') {
            try {
                const data = await withTimeout(readAiServiceStatus(), config.dependencyTimeoutMs, 'ai_service');
                aiService.data = data;
                aiService.ok = !!(data && data.daemon && data.daemon.running);
                aiService.status = aiService.ok ? 'up' : 'degraded';
            } catch (error) {
                aiService.status = 'down';
                aiService.error = error && error.message ? error.message : String(error);
            }
        }

        return {
            ok: mysql.ok && systemSettings.ok && webAssets.ok,
            checkedAt: Date.now(),
            config,
            dependencies: {
                mysql,
                redis,
                systemSettings,
                webAssets,
                aiService,
            },
        };
    }

    async function getRuntimeSnapshot() {
        const config = await getHealthProbeConfig();
        const snapshot = typeof getAccountsSnapshot === 'function'
            ? await getAccountsSnapshot().catch(() => ({ accounts: [] }))
            : { accounts: [] };
        const accounts = Array.isArray(snapshot && snapshot.accounts) ? snapshot.accounts : [];
        const reloginRequired = accounts.filter(item => Number(item && item.wsError && item.wsError.code) === 400);
        const banned = accounts.filter(item => Number(item && item.wsError && item.wsError.code) === 1000016);
        const running = accounts.filter((item) => {
            const status = item && item.status && typeof item.status === 'object' ? item.status : null;
            return !!(status && (status.online || status.running || status.connected));
        });
        const warn = reloginRequired.length >= config.warnReloginQueueCount
            || banned.length >= config.warnFailedAccountCount;
        return {
            ok: !warn,
            checkedAt: Date.now(),
            accounts: {
                total: accounts.length,
                running: running.length,
                reloginRequired: reloginRequired.length,
                banned: banned.length,
            },
            schedulers: typeof getSchedulerRegistrySnapshot === 'function'
                ? getSchedulerRegistrySnapshot()
                : { schedulerCount: 0, schedulers: [] },
            warning: warn ? '运行时异常账号数量超过阈值' : '',
        };
    }

    return {
        getBasicSnapshot,
        getDependenciesSnapshot,
        getRuntimeSnapshot,
        getHealthProbeConfig,
        setHealthProbeConfig,
    };
}

module.exports = {
    DEFAULT_HEALTH_PROBE_CONFIG,
    normalizeHealthProbeConfig,
    getHealthProbeConfig,
    setHealthProbeConfig,
    createHealthProbeService,
};
