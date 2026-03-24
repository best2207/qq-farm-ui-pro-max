const process = require('node:process');
const { getSystemSetting, setSystemSetting, SYSTEM_SETTING_KEYS } = require('./system-settings');

const ALLOWED_SERVICE_PROFILES = new Set(['full', 'headless-api', 'headless-runtime']);
const DEFAULT_SERVICE_PROFILE_CONFIG = Object.freeze({
    defaultProfile: 'full',
    allowWebPanelInHeadlessApi: true,
    allowAutoStartAccountsInHeadlessApi: false,
});

function normalizeServiceProfile(value, fallback = 'full') {
    const raw = String(value || '').trim().toLowerCase();
    if (ALLOWED_SERVICE_PROFILES.has(raw)) {
        return raw;
    }
    const fallbackValue = String(fallback || '').trim().toLowerCase();
    return ALLOWED_SERVICE_PROFILES.has(fallbackValue) ? fallbackValue : 'full';
}

function normalizeServiceProfileConfig(input, fallback = DEFAULT_SERVICE_PROFILE_CONFIG) {
    const data = (input && typeof input === 'object') ? input : {};
    const current = (fallback && typeof fallback === 'object') ? fallback : DEFAULT_SERVICE_PROFILE_CONFIG;
    return {
        defaultProfile: normalizeServiceProfile(data.defaultProfile, current.defaultProfile),
        allowWebPanelInHeadlessApi: data.allowWebPanelInHeadlessApi !== undefined
            ? !!data.allowWebPanelInHeadlessApi
            : !!current.allowWebPanelInHeadlessApi,
        allowAutoStartAccountsInHeadlessApi: data.allowAutoStartAccountsInHeadlessApi !== undefined
            ? !!data.allowAutoStartAccountsInHeadlessApi
            : !!current.allowAutoStartAccountsInHeadlessApi,
    };
}

async function getServiceProfileConfig() {
    const stored = await getSystemSetting(
        SYSTEM_SETTING_KEYS.SERVICE_PROFILE_CONFIG,
        DEFAULT_SERVICE_PROFILE_CONFIG,
    );
    return normalizeServiceProfileConfig(stored, DEFAULT_SERVICE_PROFILE_CONFIG);
}

async function setServiceProfileConfig(input) {
    const next = normalizeServiceProfileConfig(input, await getServiceProfileConfig());
    await setSystemSetting(SYSTEM_SETTING_KEYS.SERVICE_PROFILE_CONFIG, next);
    return next;
}

function resolveServiceProfileSnapshot(options = {}) {
    const env = options.env || process.env;
    const config = normalizeServiceProfileConfig(options.config, DEFAULT_SERVICE_PROFILE_CONFIG);
    const profile = normalizeServiceProfile(env.FARM_SERVICE_PROFILE, config.defaultProfile);
    const webPanelEnabled = profile !== 'headless-runtime';
    const apiEnabled = webPanelEnabled;
    const runtimeEnabled = profile !== 'headless-api';
    const autoStartAccounts = profile === 'headless-api'
        ? !!config.allowAutoStartAccountsInHeadlessApi
        : runtimeEnabled;

    return {
        profile,
        defaultProfile: config.defaultProfile,
        webPanelEnabled,
        apiEnabled,
        runtimeEnabled,
        autoStartAccounts,
        allowWebPanelInHeadlessApi: !!config.allowWebPanelInHeadlessApi,
        allowAutoStartAccountsInHeadlessApi: !!config.allowAutoStartAccountsInHeadlessApi,
        source: env.FARM_SERVICE_PROFILE ? 'env' : 'system_settings',
        envProfile: String(env.FARM_SERVICE_PROFILE || '').trim(),
        checkedAt: Date.now(),
    };
}

module.exports = {
    ALLOWED_SERVICE_PROFILES,
    DEFAULT_SERVICE_PROFILE_CONFIG,
    normalizeServiceProfile,
    normalizeServiceProfileConfig,
    getServiceProfileConfig,
    setServiceProfileConfig,
    resolveServiceProfileSnapshot,
};
