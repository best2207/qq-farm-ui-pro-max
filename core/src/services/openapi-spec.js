const { getSystemSetting, setSystemSetting, SYSTEM_SETTING_KEYS } = require('./system-settings');

const DEFAULT_OPENAPI_CONFIG = Object.freeze({
    enabled: true,
    title: 'QQ Farm Bot External API',
    version: '1.0.0',
    serverBaseUrl: '',
    exposeExternalApiOnly: true,
    includeAdminReadOnlyRoutes: true,
    tags: ['external', 'health', 'system'],
    authModes: ['apiKey', 'cookie'],
    hiddenPaths: [],
});

function normalizeStringArray(value, fallback = []) {
    if (!Array.isArray(value)) return [...fallback];
    return value.map(item => String(item || '').trim()).filter(Boolean);
}

function normalizeOpenApiConfig(input, fallback = DEFAULT_OPENAPI_CONFIG) {
    const data = (input && typeof input === 'object') ? input : {};
    const current = (fallback && typeof fallback === 'object') ? fallback : DEFAULT_OPENAPI_CONFIG;
    return {
        enabled: data.enabled !== undefined ? !!data.enabled : !!current.enabled,
        title: String(data.title ?? current.title ?? DEFAULT_OPENAPI_CONFIG.title).trim() || DEFAULT_OPENAPI_CONFIG.title,
        version: String(data.version ?? current.version ?? DEFAULT_OPENAPI_CONFIG.version).trim() || DEFAULT_OPENAPI_CONFIG.version,
        serverBaseUrl: String(data.serverBaseUrl ?? current.serverBaseUrl ?? '').trim(),
        exposeExternalApiOnly: data.exposeExternalApiOnly !== undefined ? !!data.exposeExternalApiOnly : !!current.exposeExternalApiOnly,
        includeAdminReadOnlyRoutes: data.includeAdminReadOnlyRoutes !== undefined ? !!data.includeAdminReadOnlyRoutes : !!current.includeAdminReadOnlyRoutes,
        tags: normalizeStringArray(data.tags, current.tags || DEFAULT_OPENAPI_CONFIG.tags),
        authModes: normalizeStringArray(data.authModes, current.authModes || DEFAULT_OPENAPI_CONFIG.authModes),
        hiddenPaths: normalizeStringArray(data.hiddenPaths, current.hiddenPaths || DEFAULT_OPENAPI_CONFIG.hiddenPaths),
    };
}

async function getOpenApiConfig() {
    const stored = await getSystemSetting(SYSTEM_SETTING_KEYS.OPENAPI_CONFIG, DEFAULT_OPENAPI_CONFIG);
    return normalizeOpenApiConfig(stored, DEFAULT_OPENAPI_CONFIG);
}

async function setOpenApiConfig(input) {
    const next = normalizeOpenApiConfig(input, await getOpenApiConfig());
    await setSystemSetting(SYSTEM_SETTING_KEYS.OPENAPI_CONFIG, next);
    return next;
}

function buildServerUrl(req, config) {
    if (config.serverBaseUrl) {
        return config.serverBaseUrl;
    }
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
    return `${protocol}://${host}`;
}

async function buildOpenApiSpec(req, version) {
    const config = await getOpenApiConfig();
    return {
        openapi: '3.0.3',
        info: {
            title: config.title,
            version: config.version || version || '1.0.0',
            description: '对外稳定接口、健康检查和只读概览接口文档。',
        },
        servers: [
            {
                url: buildServerUrl(req, config),
                description: '当前运行实例',
            },
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-api-key',
                },
                AdminCookie: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'access_token',
                },
            },
        },
        tags: [
            { name: 'health', description: '服务和依赖健康检查' },
            { name: 'external', description: '外部 API Key 访问入口' },
            { name: 'system', description: '系统信息与服务模式' },
        ],
        paths: {
            '/api/ping': {
                get: {
                    tags: ['health'],
                    summary: '基础存活探针',
                    responses: { 200: { description: '服务存活' } },
                },
            },
            '/api/health/basic': {
                get: {
                    tags: ['health'],
                    summary: '基础健康快照',
                    responses: { 200: { description: '基础健康信息' } },
                },
            },
            '/api/health/dependencies': {
                get: {
                    tags: ['health'],
                    summary: '依赖健康检查',
                    security: [{ AdminCookie: [] }],
                    responses: { 200: { description: '依赖健康信息' } },
                },
            },
            '/api/health/runtime': {
                get: {
                    tags: ['health'],
                    summary: '运行时健康检查',
                    security: [{ AdminCookie: [] }],
                    responses: { 200: { description: '运行时健康信息' } },
                },
            },
            '/api/system/service-profile': {
                get: {
                    tags: ['system'],
                    summary: '当前服务模式',
                    responses: { 200: { description: '服务模式快照' } },
                },
            },
            '/api/external/ping': {
                get: {
                    tags: ['external'],
                    summary: '外部 API 探针',
                    security: [{ ApiKeyAuth: [] }],
                    responses: { 200: { description: '外部 API 可用' } },
                },
            },
            '/api/external/health': {
                get: {
                    tags: ['external', 'health'],
                    summary: '外部依赖健康摘要',
                    security: [{ ApiKeyAuth: [] }],
                    responses: { 200: { description: '依赖健康摘要' } },
                },
            },
            '/api/external/accounts': {
                get: {
                    tags: ['external'],
                    summary: '账号概览',
                    security: [{ ApiKeyAuth: [] }],
                    responses: { 200: { description: '账号概览列表' } },
                },
            },
            '/api/external/stats/summary': {
                get: {
                    tags: ['external'],
                    summary: '收益汇总概览',
                    security: [{ ApiKeyAuth: [] }],
                    responses: { 200: { description: '收益汇总数据' } },
                },
            },
            '/api/admin/external-api-clients': {
                get: {
                    tags: ['system'],
                    summary: '管理员读取外部 API 客户端列表',
                    security: [{ AdminCookie: [] }],
                    responses: { 200: { description: '客户端列表' } },
                },
                post: {
                    tags: ['system'],
                    summary: '管理员创建外部 API 客户端',
                    security: [{ AdminCookie: [] }],
                    responses: { 200: { description: '客户端创建成功' } },
                },
            },
        },
    };
}

module.exports = {
    DEFAULT_OPENAPI_CONFIG,
    normalizeOpenApiConfig,
    getOpenApiConfig,
    setOpenApiConfig,
    buildOpenApiSpec,
};
