/**
 * 开服红包每日领取
 * 
 * 归档机制：
 * - 「活动已结束」等永久性错误 → 持久化归档，跨重启/跨天永久跳过
 * - 「活动未解锁」等临时性错误 → 仅当天跳过，次日重新检查（可能解锁）
 */

const process = require('node:process');
const path = require('node:path');
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, toNum } = require('../utils/utils');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');
const { ensureDataDir } = require('../config/runtime-paths');

const DAILY_KEY = 'open_server_gift';
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;

let doneDateKey = '';
let lastCheckAt = 0;
let lastClaimAt = 0;
let lastResult = '';
let lastHasClaimable = null;

// ============ 归档持久化 ============

/**
 * 获取当前账号的归档文件路径
 * 路径: data/redpacket_archive_<accountId>.json
 */
function getArchiveFilePath() {
    const accountId = process.env.FARM_ACCOUNT_ID || 'default';
    const dataDir = ensureDataDir();
    return path.join(dataDir, `redpacket_archive_${accountId}.json`);
}

/**
 * 加载归档数据
 * @returns {{ archivedIds: Record<string, { reason: string, archivedAt: string }> }}
 */
function loadArchive() {
    return readJsonFile(getArchiveFilePath(), () => ({ archivedIds: {} }));
}

/**
 * 将红包 ID 写入归档（永久跳过）
 * @param {number} packetId - 红包 ID
 * @param {string} reason - 归档原因（错误信息摘要）
 */
function archivePacket(packetId, reason) {
    const archive = loadArchive();
    if (!archive.archivedIds) archive.archivedIds = {};
    archive.archivedIds[String(packetId)] = {
        reason: reason,
        archivedAt: new Date().toISOString(),
    };
    try {
        writeJsonFileAtomic(getArchiveFilePath(), archive);
    } catch (e) {
        // 写入失败不影响主流程，下次还会重试
        log('开服', `归档写入失败: ${e.message}`, { module: 'task', event: DAILY_KEY, result: 'error' });
    }
}

/**
 * 检查红包 ID 是否已被归档
 * @param {number} packetId
 * @returns {boolean}
 */
function isArchived(packetId) {
    const archive = loadArchive();
    return !!(archive.archivedIds && archive.archivedIds[String(packetId)]);
}

// ============ 日期/状态辅助 ============

function getDateKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function markDoneToday() {
    doneDateKey = getDateKey();
}

function isDoneToday() {
    return doneDateKey === getDateKey();
}

function getRewardSummary(items) {
    const list = Array.isArray(items) ? items : [];
    const summary = [];
    for (const it of list) {
        const id = toNum(it.id);
        const count = toNum(it.count);
        if (count <= 0) continue;
        if (id === 1 || id === 1001) summary.push(`金币${count}`);
        else if (id === 2 || id === 1101) summary.push(`经验${count}`);
        else if (id === 1002) summary.push(`点券${count}`);
        else summary.push(`物品#${id}x${count}`);
    }
    return summary.join('/');
}

function isAlreadyClaimedError(err) {
    const msg = String((err && err.message) || '');
    return msg.includes('已领取') || msg.includes('今日参与次数已达上限') || msg.includes('次数已达上限');
}

/**
 * 判断是否应永久归档（活动彻底结束，不可能再领取）
 * 这类错误写入持久化归档文件，重启后也不再尝试
 */
function isPermanentError(err) {
    const msg = String((err && err.message) || '');
    return msg.includes('活动已结束') || msg.includes('活动不存在') || msg.includes('已过期');
}

/**
 * 判断是否为临时不可恢复错误（今天不行，明天可能行）
 * 例如：活动未解锁（等级不够，但升级后可能解锁）
 * 这类错误仅当天跳过，不做永久归档
 */
function isTemporaryUnrecoverableError(err) {
    const msg = String((err && err.message) || '');
    return msg.includes('未解锁') || msg.includes('不满足') || msg.includes('未开启');
}

// ============ RPC 调用 ============

async function getTodayClaimStatus() {
    const body = types.GetTodayClaimStatusRequest.encode(types.GetTodayClaimStatusRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.redpacketpb.RedPacketService', 'GetTodayClaimStatus', body);
    return types.GetTodayClaimStatusReply.decode(replyBody);
}

async function claimRedPacket(id) {
    const body = types.ClaimRedPacketRequest.encode(types.ClaimRedPacketRequest.create({
        id: Number(id) || 0,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.redpacketpb.RedPacketService', 'ClaimRedPacket', body);
    return types.ClaimRedPacketReply.decode(replyBody);
}

// ============ 主流程 ============

async function performDailyOpenServerGift(force = false) {
    const now = Date.now();
    if (!force && isDoneToday()) return false;
    if (!force && now - lastCheckAt < CHECK_COOLDOWN_MS) return false;
    lastCheckAt = now;

    try {
        const status = await getTodayClaimStatus();
        const infos = Array.isArray(status && status.infos) ? status.infos : [];

        // 一次性加载归档缓存，避免循环内多次读盘
        const archive = loadArchive();
        const archivedSet = new Set(Object.keys(archive.archivedIds || {}));

        // 过滤掉已归档的红包 ID，不再向服务端发起请求
        const claimable = infos.filter((x) => {
            if (!x || !x.can_claim || Number(x.id || 0) <= 0) return false;
            if (archivedSet.has(String(x.id))) return false;
            return true;
        });
        lastHasClaimable = claimable.length > 0;

        if (!claimable.length) {
            markDoneToday();
            lastResult = 'none';
            log('开服', '今日暂无可领取开服红包', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }

        let claimed = 0;
        let alreadyDoneToday = false;
        let skipCount = 0;
        for (const info of claimable) {
            const packetId = Number(info.id || 0);
            try {
                const ret = await claimRedPacket(packetId);
                const items = ret && ret.item ? [ret.item] : [];
                const reward = getRewardSummary(items);
                log('开服', reward ? `领取成功 → ${reward}` : '领取成功', {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'ok',
                    redPacketId: packetId,
                });
                claimed += 1;
            } catch (e) {
                if (isAlreadyClaimedError(e)) {
                    alreadyDoneToday = true;
                    break;
                }
                if (isPermanentError(e)) {
                    // 永久性错误 → 归档，此后再也不尝试
                    archivePacket(packetId, e.message);
                    log('开服', `红包已归档(id=${packetId}): ${e.message}，后续不再尝试`, {
                        module: 'task',
                        event: DAILY_KEY,
                        result: 'archived',
                        redPacketId: packetId,
                    });
                    skipCount += 1;
                    continue;
                }
                if (isTemporaryUnrecoverableError(e)) {
                    // 临时不可恢复 → 仅当天跳过
                    log('开服', `跳过红包(id=${packetId}): ${e.message}`, {
                        module: 'task',
                        event: DAILY_KEY,
                        result: 'skip',
                        redPacketId: packetId,
                    });
                    skipCount += 1;
                    continue;
                }
                log('开服', `领取失败(id=${packetId}): ${e.message}`, {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'error',
                    redPacketId: packetId,
                });
            }
        }

        // 所有红包都跳过（归档或临时不可恢复），标记当天完成
        if (skipCount > 0 && claimed === 0 && !alreadyDoneToday && skipCount === claimable.length) {
            markDoneToday();
            lastResult = 'skip';
            return false;
        }

        if (claimed > 0 || alreadyDoneToday) {
            lastClaimAt = Date.now();
            markDoneToday();
            lastResult = 'ok';
            if (alreadyDoneToday && claimed === 0) {
                log('开服', '今日开服红包已领取', {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'ok',
                });
                return false;
            }
            return claimed > 0;
        }

        lastResult = 'none';
        return false;
    } catch (e) {
        if (isAlreadyClaimedError(e)) {
            markDoneToday();
            lastResult = 'none';
            log('开服', '今日开服红包已领取', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        lastResult = 'error';
        log('开服', `领取开服红包失败: ${e.message}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'error',
        });
        return false;
    }
}

module.exports = {
    performDailyOpenServerGift,
    getOpenServerDailyState: () => ({
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        lastCheckAt,
        lastClaimAt,
        result: lastResult,
        hasClaimable: lastHasClaimable,
    }),
};
