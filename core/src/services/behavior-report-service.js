const { CONFIG } = require('../config/config');
const { types } = require('../utils/proto');
const { sendMsgAsync } = require('../utils/network');

const FLOW = Object.freeze({
    LOADING_START: 1,
    PRELOAD_COMPLETE: 2,
    LOADING_END: 3,
    GAME_LOGIN: 4,
    GAME_PLAY_TIME: 5,
});

function mapOsType(os = '') {
    const lower = String(os || '').toLowerCase();
    if (lower.includes('ios')) return 2;
    if (lower.includes('android')) return 1;
    if (lower.includes('harmony')) return 3;
    if (lower.includes('pc') || lower.includes('windows')) return 4;
    return 0;
}

function mapPlatformType(platform = '') {
    const normalized = String(platform || '').trim().toLowerCase();
    if (normalized === 'qq') return 2;
    if (normalized.startsWith('wx')) return 1;
    return 0;
}

function toSafeInt64(value) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return 0;
    return Math.trunc(normalized);
}

function createBehaviorReportService(options = {}) {
    const getUserState = typeof options.getUserState === 'function'
        ? options.getUserState
        : () => ({});
    const log = typeof options.log === 'function'
        ? options.log
        : () => {};

    const state = {
        enabled: false,
        buffer: [],
        startedAt: 0,
        totalFlushed: 0,
        lastFlushAt: 0,
        lastError: '',
        config: {
            startupSequenceEnabled: true,
            playTimeReportEnabled: true,
            flushIntervalSec: 10,
            maxBufferSize: 10,
        },
    };

    function applyConfig(nextConfig = {}) {
        const config = (nextConfig && typeof nextConfig === 'object') ? nextConfig : {};
        state.enabled = !!config.enabled;
        state.config = {
            startupSequenceEnabled: config.startupSequenceEnabled !== false,
            playTimeReportEnabled: config.playTimeReportEnabled !== false,
            flushIntervalSec: Math.max(5, Math.min(3600, Number.parseInt(config.flushIntervalSec, 10) || 10)),
            maxBufferSize: Math.max(1, Math.min(100, Number.parseInt(config.maxBufferSize, 10) || 10)),
        };
        return getSnapshot();
    }

    function buildFlow(eventName, flowType, params = []) {
        const userState = getUserState() || {};
        return {
            os_type: mapOsType(CONFIG.os),
            plat_from_type: mapPlatformType(CONFIG.platform),
            open_id: String(userState.openId || '').trim(),
            gid: toSafeInt64(userState.gid),
            name: String(userState.name || '').trim(),
            now: toSafeInt64(Date.now()),
            level: toSafeInt64(userState.level),
            flow_type: toSafeInt64(flowType),
            flow_type_str: String(eventName || '').trim(),
            param_int1: toSafeInt64(params[0]),
            param_int2: toSafeInt64(params[1]),
            param_int3: toSafeInt64(params[2]),
            param_int4: toSafeInt64(params[3]),
            param_int5: toSafeInt64(params[4]),
            param_str6: params[5] !== undefined ? String(params[5]) : '',
            param_str7: params[6] !== undefined ? String(params[6]) : '',
            param_str8: params[7] !== undefined ? String(params[7]) : '',
            param_str9: params[8] !== undefined ? String(params[8]) : '',
            param_str10: params[9] !== undefined ? String(params[9]) : '',
        };
    }

    function enqueue(eventName, flowType, ...params) {
        if (!state.enabled) return false;
        const flow = buildFlow(eventName, flowType, params);
        state.buffer.push(flow);
        if (state.buffer.length >= state.config.maxBufferSize) {
            void flush();
        }
        return true;
    }

    function startSession() {
        if (!state.enabled) return;
        if (!state.startedAt) {
            state.startedAt = Date.now();
        }
    }

    async function flush() {
        if (!state.enabled || state.buffer.length <= 0) return false;
        const payload = state.buffer.splice(0, state.buffer.length);
        try {
            const body = types.BatchClientReportFlowRequest.encode(
                types.BatchClientReportFlowRequest.create({ flows: payload }),
            ).finish();
            await sendMsgAsync('gamepb.userpb.UserService', 'BatchClientReportFlow', body, 10000);
            state.totalFlushed += payload.length;
            state.lastFlushAt = Date.now();
            state.lastError = '';
            log('行为流', `已上报 ${payload.length} 条行为流`, {
                module: 'behavior-report',
                event: 'batch_client_report_flow',
                result: 'ok',
                count: payload.length,
            });
            return true;
        } catch (error) {
            state.buffer.unshift(...payload);
            state.lastError = error && error.message ? error.message : String(error || '上报失败');
            log('行为流', `行为流上报失败: ${state.lastError}`, {
                module: 'behavior-report',
                event: 'batch_client_report_flow',
                result: 'error',
            });
            return false;
        }
    }

    async function stopSession(options = {}) {
        const includePlayTime = options.includePlayTime !== false;
        if (state.enabled && includePlayTime && state.config.playTimeReportEnabled && state.startedAt > 0) {
            const playTimeSec = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
            enqueue('GAME_PLAY_TIME', FLOW.GAME_PLAY_TIME, playTimeSec);
        }
        await flush();
        state.startedAt = 0;
    }

    function clearBuffer() {
        state.buffer = [];
    }

    function getSnapshot() {
        return {
            enabled: state.enabled,
            buffered: state.buffer.length,
            startedAt: state.startedAt,
            totalFlushed: state.totalFlushed,
            lastFlushAt: state.lastFlushAt,
            lastError: state.lastError,
            config: { ...state.config },
        };
    }

    return {
        FLOW,
        applyConfig,
        enqueue,
        flush,
        startSession,
        stopSession,
        clearBuffer,
        getSnapshot,
    };
}

module.exports = {
    FLOW,
    createBehaviorReportService,
};
