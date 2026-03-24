const { getOpenApiConfig, setOpenApiConfig } = require('../../services/openapi-spec');
const { getHealthProbeConfig, setHealthProbeConfig } = require('../../services/health-probe');
const { getServiceProfileConfig, setServiceProfileConfig } = require('../../services/service-profile');
const { getProxyPoolConfig, setProxyPoolConfig } = require('../../services/proxy-pool-service');

function registerPlatformCapabilitiesRoutes({
    app,
    authRequired,
    userRequired,
}) {
    function ensureAdmin(req, res) {
        if (req.currentUser?.role !== 'admin') {
            res.status(403).json({ ok: false, error: '仅管理员可管理系统级能力配置' });
            return false;
        }
        return true;
    }

    app.get('/api/admin/platform-capabilities', authRequired, userRequired, async (req, res) => {
        try {
            if (!ensureAdmin(req, res)) return;
            const [openapiConfig, healthProbeConfig, serviceProfileConfig, proxyPoolConfig] = await Promise.all([
                getOpenApiConfig(),
                getHealthProbeConfig(),
                getServiceProfileConfig(),
                getProxyPoolConfig(),
            ]);
            return res.json({
                ok: true,
                data: {
                    openapiConfig,
                    healthProbeConfig,
                    serviceProfileConfig,
                    proxyPoolConfig,
                },
            });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/platform-capabilities', authRequired, userRequired, async (req, res) => {
        try {
            if (!ensureAdmin(req, res)) return;
            const payload = req.body && typeof req.body === 'object' ? req.body : {};
            const current = await Promise.all([
                getOpenApiConfig(),
                getHealthProbeConfig(),
                getServiceProfileConfig(),
                getProxyPoolConfig(),
            ]);
            const [currentOpenapiConfig, currentHealthProbeConfig, currentServiceProfileConfig, currentProxyPoolConfig] = current;
            const [openapiConfig, healthProbeConfig, serviceProfileConfig, proxyPoolConfig] = await Promise.all([
                setOpenApiConfig({
                    ...currentOpenapiConfig,
                    ...(payload.openapiConfig && typeof payload.openapiConfig === 'object' ? payload.openapiConfig : {}),
                }),
                setHealthProbeConfig({
                    ...currentHealthProbeConfig,
                    ...(payload.healthProbeConfig && typeof payload.healthProbeConfig === 'object' ? payload.healthProbeConfig : {}),
                }),
                setServiceProfileConfig({
                    ...currentServiceProfileConfig,
                    ...(payload.serviceProfileConfig && typeof payload.serviceProfileConfig === 'object' ? payload.serviceProfileConfig : {}),
                }),
                setProxyPoolConfig({
                    ...currentProxyPoolConfig,
                    ...(payload.proxyPoolConfig && typeof payload.proxyPoolConfig === 'object' ? payload.proxyPoolConfig : {}),
                }),
            ]);
            return res.json({
                ok: true,
                data: {
                    openapiConfig,
                    healthProbeConfig,
                    serviceProfileConfig,
                    proxyPoolConfig,
                },
            });
        } catch (error) {
            return res.status(400).json({ ok: false, error: error.message });
        }
    });
}

module.exports = {
    registerPlatformCapabilitiesRoutes,
};
