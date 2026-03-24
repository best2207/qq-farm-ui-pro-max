const { createBehaviorReportService, FLOW } = require('../../services/behavior-report-service');
const { RuntimeModuleBase } = require('../runtime-module-base');

function randomBetween(min, max) {
    const start = Math.max(0, Number(min) || 0);
    const end = Math.max(start, Number(max) || start);
    if (end <= start) return start;
    return start + Math.floor(Math.random() * (end - start + 1));
}

class BehaviorReportRuntimeModule extends RuntimeModuleBase {
    constructor(context = {}) {
        super('behavior-report', context);
        this.behaviorService = createBehaviorReportService({
            getUserState: context.getUserState,
            log: context.log,
        });
        this.currentConfig = null;
        this.sessionActive = false;
    }

    onStart() {
        this.onRuntime('lifecycle:login_ready', this.handleLoginReady);
        this.syncConfigFromSnapshot(typeof this.context.getConfigSnapshot === 'function'
            ? this.context.getConfigSnapshot()
            : {});
    }

    onStop() {
        this.stopFlushTimer();
        this.stopStartupSequence();
        if (this.sessionActive) {
            void this.behaviorService.stopSession({
                includePlayTime: this.currentConfig?.playTimeReportEnabled !== false,
            });
        } else {
            this.behaviorService.clearBuffer();
        }
        this.sessionActive = false;
    }

    onConfigApplied(payload = {}) {
        this.syncConfigFromSnapshot(payload.snapshot || {});
    }

    handleLoginReady() {
        this.syncConfigFromSnapshot(typeof this.context.getConfigSnapshot === 'function'
            ? this.context.getConfigSnapshot()
            : {});
        if (this.isEnabled()) {
            this.activateSession(true);
        }
    }

    isEnabled() {
        return !!(this.currentConfig && this.currentConfig.enabled);
    }

    normalizeConfig(snapshot = {}) {
        const behaviorReportConfig = (snapshot.behaviorReportConfig && typeof snapshot.behaviorReportConfig === 'object')
            ? snapshot.behaviorReportConfig
            : {};
        const experimentalFeatures = (snapshot.experimentalFeatures && typeof snapshot.experimentalFeatures === 'object')
            ? snapshot.experimentalFeatures
            : {};
        return {
            enabled: behaviorReportConfig.enabled === true || experimentalFeatures.tlogFlowReportEnabled === true,
            startupSequenceEnabled: behaviorReportConfig.startupSequenceEnabled !== false,
            playTimeReportEnabled: behaviorReportConfig.playTimeReportEnabled !== false,
            flushIntervalSec: Math.max(5, Number.parseInt(behaviorReportConfig.flushIntervalSec, 10) || 10),
            maxBufferSize: Math.max(1, Number.parseInt(behaviorReportConfig.maxBufferSize, 10) || 10),
        };
    }

    syncConfigFromSnapshot(snapshot = {}) {
        this.currentConfig = this.normalizeConfig(snapshot);
        this.behaviorService.applyConfig(this.currentConfig);
        if (!this.isEnabled()) {
            this.stopFlushTimer();
            this.stopStartupSequence();
            if (this.sessionActive) {
                void this.behaviorService.stopSession({
                    includePlayTime: this.currentConfig.playTimeReportEnabled !== false,
                });
                this.sessionActive = false;
            }
            return;
        }
        this.scheduleFlushTimer();
        if (this.context.isLoginReady && this.context.isLoginReady()) {
            this.activateSession(false);
        }
    }

    activateSession(isFreshLogin) {
        if (!this.isEnabled()) return;
        if (!this.sessionActive) {
            this.behaviorService.startSession();
            this.sessionActive = true;
        }
        this.scheduleFlushTimer();
        if (isFreshLogin && this.currentConfig.startupSequenceEnabled !== false) {
            this.startStartupSequence();
        }
    }

    startStartupSequence() {
        this.stopStartupSequence();
        this.behaviorService.enqueue('LOADING_START', FLOW.LOADING_START);
        const loadingTime = randomBetween(2000, 5000);
        const delayMs = randomBetween(500, 1000);
        this.scheduler.setTimeoutTask('behavior_report_startup_complete', delayMs, async () => {
            this.behaviorService.enqueue('PRELOAD_COMPLETE', FLOW.PRELOAD_COMPLETE);
            this.behaviorService.enqueue('LOADING_END', FLOW.LOADING_END, loadingTime);
            this.behaviorService.enqueue('GAME_LOGIN', FLOW.GAME_LOGIN);
            await this.behaviorService.flush();
        });
    }

    stopStartupSequence() {
        this.scheduler.clear('behavior_report_startup_complete');
    }

    stopFlushTimer() {
        this.scheduler.clear('behavior_report_flush');
    }

    scheduleFlushTimer() {
        this.stopFlushTimer();
        if (!this.isEnabled()) return;
        this.scheduler.setIntervalTask(
            'behavior_report_flush',
            Math.max(5000, (Number(this.currentConfig.flushIntervalSec) || 10) * 1000),
            async () => {
                await this.behaviorService.flush();
            },
            { preventOverlap: true },
        );
    }
}

function createBehaviorReportRuntimeModule(context = {}) {
    return new BehaviorReportRuntimeModule(context);
}

module.exports = {
    BehaviorReportRuntimeModule,
    createBehaviorReportRuntimeModule,
};
