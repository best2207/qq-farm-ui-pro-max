const { performDailyOpenServerGift } = require('../../services/openserver');
const { RuntimeModuleBase } = require('../runtime-module-base');

class RedpacketRuntimeModule extends RuntimeModuleBase {
    constructor(context = {}) {
        super('redpacket', context);
        this.currentConfig = null;
        this.lastTriggeredAt = 0;
    }

    onStart() {
        this.onRuntime('lifecycle:login_ready', this.handleLoginReady);
        this.onRuntime('farm:harvested', this.handleSoftTrigger);
        this.syncConfigFromSnapshot(typeof this.context.getConfigSnapshot === 'function'
            ? this.context.getConfigSnapshot()
            : {});
    }

    onStop() {
        this.scheduler.clear('redpacket_periodic_check');
        this.scheduler.clear('redpacket_soft_trigger');
    }

    onConfigApplied(payload = {}) {
        this.syncConfigFromSnapshot(payload.snapshot || {});
    }

    handleLoginReady() {
        if (!this.context.isLoginReady || !this.context.isLoginReady()) return;
        this.scheduleCheckLoop();
        void this.requestCheck(true, 'login_ready');
    }

    handleSoftTrigger() {
        if (!this.isEnabled()) return;
        if (this.currentConfig.mode === 'daily') return;
        if (this.currentConfig.notifyTriggeredEnabled !== true && this.currentConfig.mode !== 'hybrid') return;
        this.scheduler.setTimeoutTask('redpacket_soft_trigger', 8000, async () => {
            await this.requestCheck(false, 'soft_trigger');
        });
    }

    normalizeConfig(snapshot = {}) {
        const automation = (snapshot.automation && typeof snapshot.automation === 'object') ? snapshot.automation : {};
        const redpacketConfig = (snapshot.redpacketConfig && typeof snapshot.redpacketConfig === 'object') ? snapshot.redpacketConfig : {};
        const experimentalFeatures = (snapshot.experimentalFeatures && typeof snapshot.experimentalFeatures === 'object') ? snapshot.experimentalFeatures : {};
        return {
            enabled: automation.open_server_gift !== false && redpacketConfig.enabled === true,
            mode: String(redpacketConfig.mode || 'daily').trim().toLowerCase() || 'daily',
            checkIntervalSec: Math.max(60, Number.parseInt(redpacketConfig.checkIntervalSec, 10) || 3600),
            notifyTriggeredEnabled: redpacketConfig.notifyTriggeredEnabled === true || experimentalFeatures.advancedRedpacketTriggerEnabled === true,
            claimCooldownSec: Math.max(30, Number.parseInt(redpacketConfig.claimCooldownSec, 10) || 600),
        };
    }

    syncConfigFromSnapshot(snapshot = {}) {
        this.currentConfig = this.normalizeConfig(snapshot);
        if (!this.isEnabled()) {
            this.scheduler.clear('redpacket_periodic_check');
            this.scheduler.clear('redpacket_soft_trigger');
            return;
        }
        if (this.context.isLoginReady && this.context.isLoginReady()) {
            this.scheduleCheckLoop();
        }
    }

    isEnabled() {
        return !!(this.currentConfig && this.currentConfig.enabled);
    }

    async requestCheck(force = false, scene = 'periodic') {
        if (!this.isEnabled()) return false;
        const now = Date.now();
        const cooldownMs = Math.max(30000, Number(this.currentConfig.claimCooldownSec || 600) * 1000);
        if (!force && now - this.lastTriggeredAt < cooldownMs) {
            return false;
        }
        this.lastTriggeredAt = now;
        return await performDailyOpenServerGift(force === true);
    }

    scheduleCheckLoop() {
        this.scheduler.clear('redpacket_periodic_check');
        if (!this.isEnabled()) return;
        if (this.currentConfig.mode === 'notify') return;
        this.scheduler.setIntervalTask(
            'redpacket_periodic_check',
            Math.max(60000, Number(this.currentConfig.checkIntervalSec || 3600) * 1000),
            async () => {
                await this.requestCheck(false, 'periodic');
            },
            { preventOverlap: true },
        );
    }
}

function createRedpacketRuntimeModule(context = {}) {
    return new RedpacketRuntimeModule(context);
}

module.exports = {
    RedpacketRuntimeModule,
    createRedpacketRuntimeModule,
};
