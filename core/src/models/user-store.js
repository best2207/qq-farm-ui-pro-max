const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { CARD_TYPES, isValidCardType, getDefaultDaysForType } = require('../config/card-types');
const { logUserAction } = require('../utils/logger');

const { getPool, transaction } = require('../services/mysql-db');

const TRIAL_IP_FILE = getDataFile('trial-ip-history.json');

const security = require('../services/security');

const hashPassword = (password) => {
    return security.hashPassword(password);
};

const generateCardCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const limit = 256 - (256 % chars.length);
    let result = '';
    while (result.length < 16) {
        const bytes = crypto.randomBytes(16);
        for (const b of bytes) {
            if (b < limit && result.length < 16) {
                result += chars[b % chars.length];
            }
        }
    }
    return result;
};

/**
 * 生成体验卡专用卡密（TRIAL-XXXXXXXXXXXX 格式）
 * @returns {string} 体验卡密码
 */
function generateTrialCardCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const limit = 256 - (256 % chars.length);
    let suffix = '';
    while (suffix.length < 12) {
        const bytes = crypto.randomBytes(12);
        for (const b of bytes) {
            if (b < limit && suffix.length < 12) {
                suffix += chars[b % chars.length];
            }
        }
    }
    return `TRIAL-${suffix}`;
}

// ============ 体验卡 IP 限流 ============
// 内存缓存：{ ip: { lastCreatedAt, todayCount, todayDate } }
const trialCardIPMap = new Map();
let trialCardDailyTotal = 0;
let trialCardDailyDate = '';

/**
 * 获取今天的日期字符串（用于日计数器重置）
 */
function getTodayStr() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * 重置日计数器（如果跨天）
 */
function resetDailyCounterIfNeeded() {
    const today = getTodayStr();
    if (trialCardDailyDate !== today) {
        trialCardDailyTotal = 0;
        trialCardDailyDate = today;
        // 清理过期的 IP 缓存记录（超过 24h）
        const now = Date.now();
        let changed = false;
        for (const [ip, info] of trialCardIPMap.entries()) {
            if (now - info.lastCreatedAt > 24 * 60 * 60 * 1000) {
                trialCardIPMap.delete(ip);
                changed = true;
            }
        }
        if (changed) saveIPHistory();
    }
}

function loadIPHistory() {
    ensureDataDir();
    try {
        if (fs.existsSync(TRIAL_IP_FILE)) {
            const data = JSON.parse(fs.readFileSync(TRIAL_IP_FILE, 'utf8'));
            trialCardDailyTotal = data.dailyTotal || 0;
            trialCardDailyDate = data.dailyDate || '';

            if (data.ipMap) {
                const now = Date.now();
                for (const [ip, info] of Object.entries(data.ipMap)) {
                    // 只加载 24 小时内的记录
                    if (now - info.lastCreatedAt < 24 * 60 * 60 * 1000) {
                        trialCardIPMap.set(ip, info);
                    }
                }
            }
            resetDailyCounterIfNeeded();
        }
    } catch (e) {
        console.error('加载体验卡 IP 记录失败:', e.message);
    }
}

function saveIPHistory() {
    ensureDataDir();
    try {
        const ipData = Object.fromEntries(trialCardIPMap);
        const data = {
            dailyTotal: trialCardDailyTotal,
            dailyDate: trialCardDailyDate,
            ipMap: ipData
        };
        fs.writeFileSync(TRIAL_IP_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('保存体验卡 IP 记录失败:', e.message);
    }
}

/**
 * 公开生成体验卡（注册页调用，无需登录）
 * @param {string} clientIP - 客户端 IP
 * @returns {{ ok: boolean, code?: string, error?: string, retryAfterMs?: number }}
 */
async function createTrialCard(clientIP) {
    const store = require('./store');
    const config = store.getTrialCardConfig();

    // 检查总开关
    if (!config.enabled) {
        return { ok: false, error: '体验卡生成功能已关闭' };
    }

    // 重置日计数器
    resetDailyCounterIfNeeded();

    // 检查每日全局上限
    if (trialCardDailyTotal >= config.dailyLimit) {
        return { ok: false, error: '今日体验卡已发放完毕，请明天再试' };
    }

    // 检查 IP 冷却
    const now = Date.now();
    const ipInfo = trialCardIPMap.get(clientIP);
    if (ipInfo && (now - ipInfo.lastCreatedAt) < config.cooldownMs) {
        const retryAfterMs = config.cooldownMs - (now - ipInfo.lastCreatedAt);
        return { ok: false, error: '请求过于频繁，请稍后再试', retryAfterMs };
    }

    // 生成体验卡
    const days = config.days || 1;
    const trialCode = generateTrialCardCode();
    const card = await createCard({
        description: '体验卡（自动生成）',
        type: CARD_TYPES.TRIAL,
        days,
        forcedCode: trialCode,
        source: 'trial_public',
        channel: 'public-register',
        note: `IP ${clientIP} 自动发放体验卡`,
        createdBy: 'system',
        operator: 'system',
    });

    // 更新 IP 缓存和日计数
    trialCardIPMap.set(clientIP, { lastCreatedAt: now });
    trialCardDailyTotal++;
    saveIPHistory();

    return { ok: true, code: card.code, days };
}

/**
 * 一键续费体验卡（管理员 或 用户自助）
 * @param {string} username - 目标用户名
 * @param {'admin'|'user'} callerRole - 调用者角色
 * @returns {{ ok: boolean, card?: object, error?: string }}
 */
async function renewTrialUser(username, callerRole) {
    const store = require('./store');
    const config = store.getTrialCardConfig();

    // 权限校验
    if (callerRole === 'admin' && !config.adminRenewEnabled) {
        return { ok: false, error: '管理员续费功能已关闭' };
    }
    if (callerRole === 'user' && !config.userRenewEnabled) {
        return { ok: false, error: '用户自助续费功能已关闭' };
    }

    // 校验目标用户是否为体验卡用户
    await loadUsers();
    const user = users.find(u => u.username === username);
    if (!user || user.card?.type !== CARD_TYPES.TRIAL) {
        return { ok: false, error: '仅体验卡用户可使用此功能' };
    }

    // 自动生成体验卡 → 续费
    const days = config.days || 1;
    const trialCode = generateTrialCardCode();
    const newCard = await createCard({
        description: '体验卡续费（自动）',
        type: CARD_TYPES.TRIAL,
        days,
        forcedCode: trialCode,
        source: 'trial_renew',
        channel: callerRole === 'admin' ? 'admin-renew' : 'self-renew',
        note: `${callerRole === 'admin' ? '管理员' : '用户自助'}续费体验卡`,
        createdBy: callerRole === 'admin' ? 'admin' : username,
        operator: callerRole === 'admin' ? 'admin' : username,
    });
    const result = await renewUser(username, newCard.code);
    if (!result.ok) {
        try {
            await deleteCard(newCard.code, 'system');
        } catch (cleanupError) {
            console.error('体验卡续费失败后的回滚清理失败:', cleanupError.message);
        }
    }
    return result;
}

let users = [];
let cards = [];

function normalizeCardDays(days, type) {
    return Number.isFinite(Number(days)) ? Number(days) : getDefaultDaysForType(type);
}

function normalizeCardText(value, maxLength = 255) {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim().slice(0, maxLength);
}

function normalizeCardNullableText(value, maxLength = 255) {
    const text = normalizeCardText(value, maxLength);
    return text || null;
}

function normalizeCardSource(source) {
    const normalized = normalizeCardText(source, 32).toLowerCase();
    return normalized || 'manual';
}

function normalizeCardChannel(channel) {
    return normalizeCardText(channel, 64);
}

function normalizeCardDescription(description) {
    return normalizeCardText(description, 255);
}

function normalizeCardNote(note) {
    if (note === undefined || note === null) {
        return '';
    }
    return String(note).trim().slice(0, 2000);
}

function normalizeCardDaysByType(days, type) {
    if (type === CARD_TYPES.FOREVER) {
        return null;
    }

    const parsed = Number.parseInt(days, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return getDefaultDaysForType(type);
}

function generateCardBatchNo() {
    const now = new Date();
    const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    return `B${stamp}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function parseLogJson(value) {
    if (!value) {
        return null;
    }
    if (typeof value === 'object') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function buildCardSnapshot(card) {
    return {
        code: card.code,
        batchNo: card.batchNo || null,
        batchName: card.batchName || null,
        type: card.type,
        days: card.days ?? null,
        description: card.description || '',
        source: card.source || 'manual',
        channel: card.channel || '',
        note: card.note || '',
        createdBy: card.createdBy || null,
        enabled: !!card.enabled,
        usedBy: card.usedBy || null,
        usedAt: card.usedAt || null,
        expiresAt: card.expiresAt || null,
        createdAt: card.createdAt || null,
        updatedAt: card.updatedAt || null,
    };
}

function getCardStatusKey(card, now = Date.now()) {
    if (card.usedBy) {
        if (card.expiresAt && card.expiresAt <= now) {
            return 'used_expired';
        }
        if (card.type === CARD_TYPES.FOREVER || !card.expiresAt) {
            return 'used_forever';
        }
        if (card.expiresAt - now <= 7 * 24 * 60 * 60 * 1000) {
            return 'used_expiring';
        }
        return 'used_active';
    }

    return card.enabled ? 'unused' : 'disabled';
}

function getCardStatusMeta(card, now = Date.now()) {
    const key = getCardStatusKey(card, now);
    const meta = {
        unused: { label: '待使用', tone: 'blue' },
        disabled: { label: '已禁用', tone: 'gray' },
        used_active: { label: '已使用', tone: 'green' },
        used_expiring: { label: '即将到期', tone: 'amber' },
        used_expired: { label: '已过期', tone: 'red' },
        used_forever: { label: '永久生效', tone: 'purple' },
    }[key] || { label: key, tone: 'gray' };

    return { key, ...meta };
}

function decorateCard(card, now = Date.now()) {
    const status = getCardStatusMeta(card, now);
    return {
        ...card,
        status: status.key,
        statusLabel: status.label,
        statusTone: status.tone,
        isUsed: !!card.usedBy,
        isExpired: status.key === 'used_expired',
        canDelete: !card.usedBy,
        canToggleEnabled: !card.usedBy,
        canEditType: !card.usedBy,
    };
}

function buildCardSummary(cardList) {
    const summary = {
        total: cardList.length,
        unused: 0,
        disabled: 0,
        used: 0,
        usedActive: 0,
        usedExpiring: 0,
        usedExpired: 0,
        usedForever: 0,
        trial: 0,
        permanent: 0,
        batches: new Set(),
        sources: new Set(),
        creators: new Set(),
    };

    for (const card of cardList) {
        if (card.batchNo) {
            summary.batches.add(card.batchNo);
        }
        if (card.source) {
            summary.sources.add(card.source);
        }
        if (card.createdBy) {
            summary.creators.add(card.createdBy);
        }

        if (card.type === CARD_TYPES.TRIAL) {
            summary.trial++;
        }
        if (card.type === CARD_TYPES.FOREVER) {
            summary.permanent++;
        }

        switch (card.status || getCardStatusKey(card)) {
            case 'unused':
                summary.unused++;
                break;
            case 'disabled':
                summary.disabled++;
                break;
            case 'used_expiring':
                summary.used++;
                summary.usedExpiring++;
                break;
            case 'used_expired':
                summary.used++;
                summary.usedExpired++;
                break;
            case 'used_forever':
                summary.used++;
                summary.usedForever++;
                break;
            case 'used_active':
                summary.used++;
                summary.usedActive++;
                break;
            default:
                break;
        }
    }

    return {
        total: summary.total,
        unused: summary.unused,
        disabled: summary.disabled,
        used: summary.used,
        usedActive: summary.usedActive,
        usedExpiring: summary.usedExpiring,
        usedExpired: summary.usedExpired,
        usedForever: summary.usedForever,
        trial: summary.trial,
        permanent: summary.permanent,
        batches: summary.batches.size,
        sources: Array.from(summary.sources).sort(),
        creators: Array.from(summary.creators).sort(),
    };
}

async function insertCardOperationLog(executor, payload) {
    await executor.query(
        `INSERT INTO card_operation_logs
            (card_id, card_code, action, operator, target_username, remark, before_snapshot, after_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            payload.cardId || null,
            payload.cardCode,
            payload.action,
            payload.operator || null,
            payload.targetUsername || null,
            payload.remark || null,
            payload.beforeSnapshot ? JSON.stringify(payload.beforeSnapshot) : null,
            payload.afterSnapshot ? JSON.stringify(payload.afterSnapshot) : null,
        ]
    );
}

async function getCardLogs(cardCode, limit = 50) {
    const pool = getPool();
    const [rows] = await pool.query(
        `SELECT id, card_id, card_code, action, operator, target_username, remark, before_snapshot, after_snapshot, created_at
         FROM card_operation_logs
         WHERE card_code = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        [cardCode, limit]
    );

    return rows.map(row => ({
        id: row.id,
        cardId: row.card_id,
        cardCode: row.card_code,
        action: row.action,
        operator: row.operator,
        targetUsername: row.target_username,
        remark: row.remark,
        beforeSnapshot: parseLogJson(row.before_snapshot),
        afterSnapshot: parseLogJson(row.after_snapshot),
        createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    }));
}

function getCardEffectiveTime(row) {
    if (row.used_at) {
        return new Date(row.used_at).getTime();
    }
    if (row.created_at) {
        return new Date(row.created_at).getTime();
    }
    return Date.now();
}

function computeCardExpiresAt(previousExpiresAt, usedAt, type, days) {
    if (type === CARD_TYPES.FOREVER) {
        return null;
    }

    const normalizedDays = normalizeCardDays(days, type);
    if (!normalizedDays || normalizedDays <= 0) {
        return null;
    }

    const baseTime = previousExpiresAt && previousExpiresAt > usedAt
        ? previousExpiresAt
        : usedAt;
    return baseTime + normalizedDays * 24 * 60 * 60 * 1000;
}

function getTrialMaxAccounts() {
    try {
        const store = require('./store');
        return store.getTrialCardConfig().maxAccounts || 1;
    } catch (e) {
        return 1;
    }
}

async function loadUsers() {
    try {
        const pool = getPool();
        const [rows] = await pool.query('SELECT * FROM users');
        users = rows.map(r => ({
            id: r.id,
            username: r.username,
            password: r.password_hash,
            role: r.role,
            status: r.status || 'active',
            createdAt: new Date(r.created_at).getTime()
        }));

        const usersByName = new Map(users.map(u => [u.username, u]));

        // 顺序回放用户已使用卡密，确保续费后的当前卡状态可从历史中稳定重建。
        const [cardRows] = await pool.query(`
            SELECT cards.*, users.username as usedBy
            FROM cards
            INNER JOIN users ON cards.used_by = users.id
            WHERE cards.used_by IS NOT NULL
            ORDER BY cards.used_by ASC, COALESCE(cards.used_at, cards.created_at) ASC, cards.id ASC
        `);

        const repairs = [];
        cardRows.forEach(c => {
            const u = usersByName.get(c.usedBy);
            if (u) {
                const days = normalizeCardDays(c.days, c.type);
                const usedAt = getCardEffectiveTime(c);
                const expiresAt = computeCardExpiresAt(u.card?.expiresAt || null, usedAt, c.type, days);
                const dbExpiresAt = c.expires_at ? new Date(c.expires_at).getTime() : null;

                if (expiresAt !== dbExpiresAt) {
                    repairs.push({ id: c.id, expiresAt });
                }

                u.cardCode = c.code;
                u.card = {
                    code: c.code,
                    description: c.description,
                    type: c.type,
                    typeChar: c.type,
                    days,
                    expiresAt,
                    enabled: (u.status || 'active') !== 'banned'
                };
                u.maxAccounts = c.type === CARD_TYPES.TRIAL ? getTrialMaxAccounts() : 0;
            }
        });

        if (repairs.length > 0) {
            try {
                await transaction(async (conn) => {
                    for (const repair of repairs) {
                        await conn.query(
                            'UPDATE cards SET expires_at=? WHERE id=?',
                            [repair.expiresAt ? new Date(repair.expiresAt) : null, repair.id]
                        );
                    }
                });
                console.log(`[用户系统] 已修复 ${repairs.length} 条卡密 expires_at 历史记录`);
            } catch (repairError) {
                console.error('修复卡密 expires_at 历史记录失败:', repairError.message);
            }
        }
    } catch (e) { console.error('加载用户数据失败:', e.message); }
}

async function saveUsers() {
    const pool = getPool();
    try {
        await transaction(async (conn) => {
            for (const u of users) {
                await conn.query(
                    "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE password_hash=?, role=?, status=?",
                    [u.username, u.password, u.role || 'user', u.status || 'active', u.password, u.role || 'user', u.status || 'active']
                );
            }
        });
    } catch (e) {
        console.error('保存用户数据失败:', e.message);
    }
}

async function loadCards() {
    try {
        const pool = getPool();
        const [rows] = await pool.query('SELECT cards.*, users.username as usedBy FROM cards LEFT JOIN users ON cards.used_by = users.id');
        cards = rows.map(r => ({
            id: r.id,
            code: r.code,
            batchNo: r.batch_no || null,
            batchName: r.batch_name || null,
            type: r.type,
            typeChar: r.type,
            description: r.description,
            days: normalizeCardDays(r.days, r.type),
            source: r.source || 'manual',
            channel: r.channel || '',
            note: r.note || '',
            createdBy: r.created_by || null,
            enabled: r.enabled === 1,
            usedBy: r.usedBy,
            usedAt: r.used_at ? new Date(r.used_at).getTime() : null,
            createdAt: new Date(r.created_at).getTime(),
            updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : new Date(r.created_at).getTime(),
            expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : null
        }));
    } catch (e) { console.error('加载卡密数据失败:', e.message); }
}

async function saveCards() {
    const pool = getPool();
    try {
        await transaction(async (conn) => {
            for (const c of cards) {
                if (c.code) {
                    await conn.query(
                        "INSERT INTO cards (code, batch_no, batch_name, type, description, days, source, channel, note, created_by, enabled, used_by, used_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM users WHERE username = ?), ?, ?, ?, ?) ON DUPLICATE KEY UPDATE batch_no=?, batch_name=?, type=?, description=?, days=?, source=?, channel=?, note=?, created_by=?, enabled=?, used_by=(SELECT id FROM users WHERE username = ?), used_at=?, expires_at=?, updated_at=?",
                        [
                            c.code,
                            c.batchNo || null,
                            c.batchName || null,
                            c.type,
                            c.description || '',
                            c.days ?? getDefaultDaysForType(c.type),
                            c.source || 'manual',
                            c.channel || '',
                            c.note || '',
                            c.createdBy || null,
                            c.enabled ? 1 : 0,
                            c.usedBy || null,
                            c.usedAt ? new Date(c.usedAt) : null,
                            c.expiresAt ? new Date(c.expiresAt) : null,
                            c.createdAt ? new Date(c.createdAt) : new Date(),
                            c.updatedAt ? new Date(c.updatedAt) : new Date(),
                            c.batchNo || null,
                            c.batchName || null,
                            c.type,
                            c.description || '',
                            c.days ?? getDefaultDaysForType(c.type),
                            c.source || 'manual',
                            c.channel || '',
                            c.note || '',
                            c.createdBy || null,
                            c.enabled ? 1 : 0,
                            c.usedBy || null,
                            c.usedAt ? new Date(c.usedAt) : null,
                            c.expiresAt ? new Date(c.expiresAt) : null,
                            c.updatedAt ? new Date(c.updatedAt) : new Date()
                        ]
                    );
                }
            }
        });
    } catch (e) {
        console.error('保存卡密数据失败:', e.message);
    }
}

async function initDefaultAdmin() {
    await loadUsers();
    const adminExists = users.find(u => u.username === 'admin');
    if (!adminExists) {
        // 从环境变量读取管理员初始密码，若未设置则回退到 'admin'
        const { CONFIG } = require('../config/config');
        const defaultPassword = CONFIG.adminPassword || 'admin';
        users.push({
            username: 'admin',
            password: hashPassword(defaultPassword),
            role: 'admin',
            status: 'active',
            card: null,
            createdAt: Date.now()
        });
        await saveUsers();
        const maskedPwd = defaultPassword.length > 2
            ? defaultPassword[0] + '*'.repeat(defaultPassword.length - 2) + defaultPassword.slice(-1)
            : '***';
        console.log(`[用户系统] 已创建默认管理员账号：admin / ${maskedPwd}（来源：${CONFIG.adminPassword ? '.env ADMIN_PASSWORD' : '内置默认值'}）`);
    }
}

async function validateUser(username, password) {
    await loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) return null;

    const verify = security.verifyPassword(password, user.password);
    if (!verify.valid) return null;

    if (verify.needsMigration) {
        user.password = security.hashPassword(password);
        await saveUsers();
        console.log('[验证用户] 密码已自动迁移为 PBKDF2 格式:', username);
    }

    console.log('[验证用户]', username, '- Card 类型:', user.card?.type || '无卡密', ', 启用:', user.card?.enabled ?? 'N/A');

    if (user.role === 'admin') {
        return {
            username: user.username,
            role: user.role,
            status: user.status || 'active',
            maxAccounts: 0,
            card: null
        };
    }

    if ((user.status || 'active') === 'banned') {
        return { ...user, error: '账号已被封禁' };
    }

    if (user.card) {
        if (user.card.expiresAt && user.card.expiresAt < Date.now()) {
            return { ...user, error: '账号已过期' };
        }
    }

    return {
        username: user.username,
        role: user.role,
        status: user.status || 'active',
        maxAccounts: user.maxAccounts || (user.card?.type === CARD_TYPES.TRIAL ? getTrialMaxAccounts() : 0),
        card: user.card
            ? { ...user.card, enabled: (user.status || 'active') !== 'banned' }
            : null
    };
}

async function registerUser(username, password, cardCode) {
    await loadUsers();
    await loadCards();

    // 检查用户名是否已存在
    if (users.find(u => u.username === username)) {
        return { ok: false, error: '用户名已存在' };
    }

    // 查找卡密
    const card = cards.find(c => c.code === cardCode);
    if (!card) {
        return { ok: false, error: '卡密不存在' };
    }

    // 验证卡密状态
    if (!card.enabled) {
        return { ok: false, error: '卡密已被禁用' };
    }

    if (card.usedBy) {
        return { ok: false, error: '卡密已被使用' };
    }

    // 验证卡密类型
    if (!isValidCardType(card.type)) {
        return { ok: false, error: '卡密类型无效' };
    }

    const now = Date.now();

    // 计算过期时间
    let expiresAt = null;
    if (card.type !== CARD_TYPES.FOREVER) {
        const days = card.days || getDefaultDaysForType(card.type);
        if (days <= 0) {
            return { ok: false, error: '卡密天数无效' };
        }
        expiresAt = now + days * 24 * 60 * 60 * 1000;
    }

    // 体验卡用户：从配置读取绑定账号数上限
    let maxAccounts = 0; // 0 = 不限制
    if (card.type === CARD_TYPES.TRIAL) {
        const store = require('./store');
        const trialConfig = store.getTrialCardConfig();
        maxAccounts = trialConfig.maxAccounts || 1;
    }

    // 创建新用户
    const newUser = {
        username,
        password: hashPassword(password),
        role: 'user',
        status: 'active',
        cardCode,
        card: {
            code: card.code,
            description: card.description,
            type: card.type,
            typeChar: card.typeChar,
            days: card.days || getDefaultDaysForType(card.type),
            expiresAt,
            enabled: true
        },
        maxAccounts,
        createdAt: now
    };

    const beforeSnapshot = buildCardSnapshot(card);

    await transaction(async (conn) => {
        await conn.query(
            "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)",
            [newUser.username, newUser.password, newUser.role || 'user', newUser.status]
        );
        await conn.query(
            "UPDATE cards SET enabled=?, used_by=(SELECT id FROM users WHERE username = ?), used_at=?, expires_at=? WHERE code=?",
            [0, username, new Date(now), expiresAt ? new Date(expiresAt) : null, card.code]
        );
        await insertCardOperationLog(conn, {
            cardId: card.id,
            cardCode: card.code,
            action: 'register_use',
            operator: username,
            targetUsername: username,
            remark: '注册时使用卡密',
            beforeSnapshot,
            afterSnapshot: {
                ...beforeSnapshot,
                enabled: false,
                usedBy: username,
                usedAt: now,
                expiresAt,
            },
        });
    });

    users.push(newUser);
    card.usedBy = username;
    card.usedAt = now;
    card.enabled = false;
    card.expiresAt = expiresAt;
    card.updatedAt = now;

    // 记录操作日志
    logUserAction('register', username, {
        cardCode,
        cardType: card.type,
        cardDays: card.days,
        expiresAt: newUser.card.expiresAt,
    });

    return { ok: true, user: { username: newUser.username, role: newUser.role, card: newUser.card } };
}

async function renewUser(username, cardCode) {
    await loadUsers();
    await loadCards();

    // 查找用户
    const user = users.find(u => u.username === username);
    if (!user) {
        return { ok: false, error: '用户不存在' };
    }

    // 查找卡密
    const card = cards.find(c => c.code === cardCode);
    if (!card) {
        return { ok: false, error: '卡密不存在' };
    }

    // 验证卡密状态
    if (!card.enabled) {
        return { ok: false, error: '卡密已被禁用' };
    }

    if (card.usedBy && card.usedBy !== username) {
        return { ok: false, error: '卡密已被其他用户使用' };
    }

    // 验证卡密类型
    if (!isValidCardType(card.type)) {
        return { ok: false, error: '卡密类型无效' };
    }

    const now = Date.now();

    // 初始化用户卡密记录（如果不存在）
    if (!user.card) {
        user.card = {};
    }

    // 计算新的过期时间
    let newExpiresAt = null;
    const currentExpires = user.card.expiresAt || 0;

    if (card.type === CARD_TYPES.FOREVER) {
        // 永久卡
        newExpiresAt = null;
    } else {
        // 计算续费天数
        const days = card.days || getDefaultDaysForType(card.type);
        if (days <= 0) {
            return { ok: false, error: '卡密天数无效' };
        }

        // 续费时间计算逻辑：未过期则累加，已过期则从现在开始
        if (currentExpires && currentExpires > now) {
            newExpiresAt = currentExpires + days * 24 * 60 * 60 * 1000;
        } else {
            newExpiresAt = now + days * 24 * 60 * 60 * 1000;
        }
    }

    const renewDays = card.days || getDefaultDaysForType(card.type);
    const beforeSnapshot = buildCardSnapshot(card);

    await transaction(async (conn) => {
        await conn.query(
            "UPDATE cards SET enabled=?, used_by=(SELECT id FROM users WHERE username = ?), used_at=?, expires_at=? WHERE code=?",
            [0, username, new Date(now), newExpiresAt ? new Date(newExpiresAt) : null, card.code]
        );
        await insertCardOperationLog(conn, {
            cardId: card.id,
            cardCode: card.code,
            action: 'renew_use',
            operator: username,
            targetUsername: username,
            remark: '续费时使用卡密',
            beforeSnapshot,
            afterSnapshot: {
                ...beforeSnapshot,
                enabled: false,
                usedBy: username,
                usedAt: now,
                expiresAt: newExpiresAt,
            },
        });
    });

    user.card.code = card.code;
    user.card.description = card.description;
    user.card.type = card.type;
    user.card.typeChar = card.typeChar;
    user.card.days = renewDays;
    user.card.expiresAt = newExpiresAt;
    user.card.enabled = true;
    user.maxAccounts = card.type === CARD_TYPES.TRIAL ? getTrialMaxAccounts() : 0;
    if (user.status !== 'banned') {
        user.status = 'active';
    }

    card.usedBy = username;
    card.usedAt = now;
    card.enabled = false;
    card.expiresAt = newExpiresAt;
    card.updatedAt = now;

    // 记录操作日志
    logUserAction('renew', username, {
        cardCode,
        cardType: card.type,
        cardDays: card.days,
        newExpiresAt: user.card.expiresAt,
    });

    return { ok: true, card: user.card };
}

async function getAllUsers() {
    await loadUsers();
    return users.map(u => ({
        username: u.username,
        role: u.role,
        status: u.status || 'active',
        card: u.card
            ? { ...u.card, enabled: (u.status || 'active') !== 'banned' }
            : u.card
    }));
}

async function getAllUsersWithPassword() {
    await loadUsers();
    return users.map(u => ({
        username: u.username,
        password: u.plainPassword || '',
        role: u.role,
        status: u.status || 'active',
        card: u.card
            ? { ...u.card, enabled: (u.status || 'active') !== 'banned' }
            : u.card
    }));
}

async function updateUser(username, updates) {
    await loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) return null;

    console.log('[更新用户] 用户名:', username, '更新内容:', updates);
    console.log('[更新前] 用户状态:', JSON.stringify(user.card));

    if (updates.expiresAt !== undefined) {
        if (!user.card) user.card = {};
        user.card.expiresAt = updates.expiresAt;
    }

    if (updates.enabled !== undefined) {
        if (!user.card) user.card = {};
        user.status = updates.enabled ? 'active' : 'banned';
        user.card.enabled = updates.enabled;
    }

    console.log('[更新后] 用户状态:', JSON.stringify(user.card));

    const pool = getPool();
    if (pool) {
        // cards 结构更新
        await pool.query(
            "UPDATE cards SET expires_at=? WHERE used_by=(SELECT id FROM users WHERE username = ?)",
            [user.card.expiresAt ? new Date(user.card.expiresAt) : null, username]
        );
        await pool.query(
            "UPDATE users SET status=? WHERE username=?",
            [user.status || 'active', username]
        );
    } else {
        await saveUsers();
    }
    console.log('[保存完成] 用户状态已保存到数据库');

    return {
        username: user.username,
        role: user.role,
        status: user.status || 'active',
        card: user.card
            ? { ...user.card, enabled: (user.status || 'active') !== 'banned' }
            : user.card
    };
}

async function deleteUser(username) {
    await loadUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) return { ok: false, error: '用户不存在' };

    // 不允许删除管理员账号
    if (users[idx].role === 'admin') {
        return { ok: false, error: '不能删除管理员账号' };
    }

    await getPool().query("DELETE FROM users WHERE username=?", [username]);

    users.splice(idx, 1);
    return { ok: true };
}

async function changePassword(username, oldPassword, newPassword) {
    await loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) {
        return { ok: false, error: '用户不存在' };
    }

    const verify = security.verifyPassword(oldPassword, user.password);
    if (!verify.valid) {
        return { ok: false, error: '旧密码错误' };
    }

    const strength = security.checkPasswordStrength(newPassword);
    if (!strength.strong) {
        return { ok: false, error: strength.errors.join('；') };
    }

    user.password = security.hashPassword(newPassword);
    user.plainPassword = newPassword;

    const pool = getPool();
    if (pool) {
        await pool.query("UPDATE users SET password_hash=? WHERE username=?", [user.password, username]).catch(e => console.error("Change Password DB Error:", e.message));
    } else {
        await saveUsers();
    }

    return { ok: true };
}

/**
 * 管理员密码修改（跳过强密码校验，仅由路由层校验最低长度）
 * @param {string} username - 用户名
 * @param {string} oldPassword - 旧密码
 * @param {string} newPassword - 新密码
 * @returns {{ ok: boolean, error?: string }}
 */
async function changeAdminPassword(username, oldPassword, newPassword) {
    await loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) {
        return { ok: false, error: '用户不存在' };
    }

    const verify = security.verifyPassword(oldPassword, user.password);
    if (!verify.valid) {
        return { ok: false, error: '旧密码错误' };
    }

    // 管理员走简化校验，不执行 checkPasswordStrength
    user.password = security.hashPassword(newPassword);
    user.plainPassword = newPassword;

    const pool = getPool();
    if (pool) {
        await pool.query("UPDATE users SET password_hash=? WHERE username=?", [user.password, username]).catch(e => console.error("Change Admin Password DB Error:", e.message));
    } else {
        await saveUsers();
    }

    return { ok: true };
}

async function getAllCards() {
    await loadCards();
    const decoratedCards = cards
        .map(card => decorateCard(card))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return decoratedCards;
}

async function getCardCatalog() {
    const decoratedCards = await getAllCards();
    const batchMap = new Map();

    for (const card of decoratedCards) {
        if (card.batchNo) {
            batchMap.set(card.batchNo, {
                value: card.batchNo,
                label: card.batchName || card.batchNo,
            });
        }
    }

    return {
        cards: decoratedCards,
        summary: buildCardSummary(decoratedCards),
        filterOptions: {
            sources: Array.from(new Set(decoratedCards.map(card => card.source).filter(Boolean))).sort(),
            creators: Array.from(new Set(decoratedCards.map(card => card.createdBy).filter(Boolean))).sort(),
            batches: Array.from(batchMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
        },
    };
}

async function getCardDetail(code) {
    await loadCards();
    const card = cards.find(item => item.code === code);
    if (!card) {
        return null;
    }

    const detail = decorateCard(card);
    let logs = [];
    try {
        logs = await getCardLogs(code, 50);
    } catch (error) {
        console.error('加载卡密操作日志失败:', error.message);
    }

    return { card: detail, logs };
}

async function createCardsBatch(payload = {}) {
    await loadCards();

    let type = payload.type;
    if (!isValidCardType(type)) {
        type = CARD_TYPES.MONTH;
    }

    const count = Math.max(1, Math.min(200, Number.parseInt(payload.count, 10) || 1));
    const description = normalizeCardDescription(payload.description);
    const days = normalizeCardDaysByType(payload.days, type);
    const source = normalizeCardSource(payload.source);
    const channel = normalizeCardChannel(payload.channel);
    const note = normalizeCardNote(payload.note);
    const createdBy = normalizeCardNullableText(payload.createdBy || payload.operator, 100);
    const batchName = normalizeCardNullableText(payload.batchName, 100);
    const batchNo = normalizeCardNullableText(payload.batchNo, 64) || (count > 1 || batchName ? generateCardBatchNo() : null);
    const existingCodes = new Set(cards.map(card => card.code));
    const now = Date.now();

    const newCards = [];
    for (let i = 0; i < count; i++) {
        let code = payload.forcedCode && i === 0 ? String(payload.forcedCode).trim() : '';
        if (!code) {
            do {
                code = generateCardCode();
            } while (existingCodes.has(code));
        } else if (existingCodes.has(code)) {
            throw new Error(`卡密已存在: ${code}`);
        }
        existingCodes.add(code);

        newCards.push({
            code,
            batchNo,
            batchName,
            type,
            typeChar: type,
            description,
            days,
            source,
            channel,
            note,
            createdBy,
            enabled: true,
            usedBy: null,
            usedAt: null,
            createdAt: now,
            updatedAt: now,
            expiresAt: null,
        });
    }

    const pool = getPool();
    if (pool) {
        await transaction(async (conn) => {
            for (const card of newCards) {
                const [result] = await conn.query(
                    `INSERT INTO cards
                        (code, batch_no, batch_name, type, description, days, source, channel, note, created_by, enabled, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        card.code,
                        card.batchNo,
                        card.batchName,
                        card.type,
                        card.description || '',
                        card.days,
                        card.source,
                        card.channel,
                        card.note || '',
                        card.createdBy,
                        1,
                        new Date(card.createdAt),
                        new Date(card.updatedAt),
                    ]
                );
                card.id = result.insertId;
                await insertCardOperationLog(conn, {
                    cardId: card.id,
                    cardCode: card.code,
                    action: 'create',
                    operator: payload.operator || createdBy,
                    remark: count > 1 ? `批量生成 ${count} 张卡密` : '生成卡密',
                    afterSnapshot: buildCardSnapshot(card),
                });
            }
        });
    } else {
        cards.push(...newCards);
        await saveCards();
        return newCards.map(card => decorateCard(card));
    }

    cards.push(...newCards);
    return newCards.map(card => decorateCard(card));
}

async function createCard(descriptionOrPayload, type, days, forcedCode, extraPayload = {}) {
    const payload = typeof descriptionOrPayload === 'object' && descriptionOrPayload !== null
        ? { ...descriptionOrPayload }
        : {
                description: descriptionOrPayload,
                type,
                days,
                forcedCode,
                ...extraPayload,
            };
    const createdCards = await createCardsBatch({ ...payload, count: 1 });
    return createdCards[0];
}

async function updateCard(code, updates = {}, operator = null, options = {}) {
    if (!options.skipLoad) {
        await loadCards();
    }

    const card = cards.find(c => c.code === code);
    if (!card) {
        return null;
    }

    const isUsed = !!card.usedBy;
    if (isUsed && updates.enabled !== undefined && Boolean(updates.enabled) !== card.enabled) {
        return { ok: false, error: '已使用卡密不可修改启用状态' };
    }
    if (isUsed && (updates.type !== undefined || updates.days !== undefined)) {
        return { ok: false, error: '已使用卡密不可修改类型或时长' };
    }

    let nextType = updates.type !== undefined ? String(updates.type).trim() : card.type;
    if (!isValidCardType(nextType)) {
        nextType = card.type;
    }

    const beforeSnapshot = buildCardSnapshot(card);
    const nextCard = {
        ...card,
        batchNo: updates.batchNo !== undefined ? normalizeCardNullableText(updates.batchNo, 64) : card.batchNo || null,
        batchName: updates.batchName !== undefined ? normalizeCardNullableText(updates.batchName, 100) : card.batchName || null,
        type: nextType,
        typeChar: nextType,
        description: updates.description !== undefined ? normalizeCardDescription(updates.description) : card.description,
        days: updates.days !== undefined || updates.type !== undefined ? normalizeCardDaysByType(updates.days ?? card.days, nextType) : card.days,
        source: updates.source !== undefined ? normalizeCardSource(updates.source) : card.source || 'manual',
        channel: updates.channel !== undefined ? normalizeCardChannel(updates.channel) : card.channel || '',
        note: updates.note !== undefined ? normalizeCardNote(updates.note) : card.note || '',
        createdBy: updates.createdBy !== undefined ? normalizeCardNullableText(updates.createdBy, 100) : card.createdBy || null,
        enabled: updates.enabled !== undefined ? Boolean(updates.enabled) : card.enabled,
        updatedAt: Date.now(),
    };

    if (nextCard.type === CARD_TYPES.FOREVER) {
        nextCard.days = null;
    }

    const pool = getPool();
    if (pool) {
        await transaction(async (conn) => {
            await conn.query(
                `UPDATE cards
                 SET batch_no=?, batch_name=?, type=?, description=?, days=?, source=?, channel=?, note=?, created_by=?, enabled=?, updated_at=?
                 WHERE code=?`,
                [
                    nextCard.batchNo,
                    nextCard.batchName,
                    nextCard.type,
                    nextCard.description || '',
                    nextCard.days,
                    nextCard.source,
                    nextCard.channel,
                    nextCard.note || '',
                    nextCard.createdBy,
                    nextCard.enabled ? 1 : 0,
                    new Date(nextCard.updatedAt),
                    card.code,
                ]
            );
            await insertCardOperationLog(conn, {
                cardId: card.id,
                cardCode: card.code,
                action: 'update',
                operator,
                remark: '更新卡密信息',
                beforeSnapshot,
                afterSnapshot: buildCardSnapshot(nextCard),
            });
        });
    } else {
        Object.assign(card, nextCard);
        await saveCards();
        return { ok: true, card: decorateCard(card) };
    }

    Object.assign(card, nextCard);
    return { ok: true, card: decorateCard(card) };
}

async function batchUpdateCards(codes = [], updates = {}, operator = null) {
    await loadCards();
    const uniqueCodes = Array.from(new Set((codes || []).map(code => String(code || '').trim()).filter(Boolean)));
    const results = [];
    const skipped = [];

    for (const code of uniqueCodes) {
        const result = await updateCard(code, updates, operator, { skipLoad: true });
        if (result && result.ok) {
            results.push(result.card);
        } else {
            skipped.push({ code, error: result?.error || '卡密不存在' });
        }
    }

    return {
        updatedCount: results.length,
        cards: results,
        skipped,
    };
}

async function deleteCard(code, operator = null, options = {}) {
    if (!options.skipLoad) {
        await loadCards();
    }

    const idx = cards.findIndex(c => c.code === code);
    if (idx === -1) {
        return { ok: false, error: '卡密不存在' };
    }

    const card = cards[idx];
    if (card.usedBy) {
        return { ok: false, error: '已使用卡密不可删除' };
    }

    const beforeSnapshot = buildCardSnapshot(card);
    const pool = getPool();
    if (pool) {
        await transaction(async (conn) => {
            await insertCardOperationLog(conn, {
                cardId: card.id,
                cardCode: card.code,
                action: 'delete',
                operator,
                remark: '删除未使用卡密',
                beforeSnapshot,
            });
            await conn.query("DELETE FROM cards WHERE code=?", [code]);
        });
    } else {
        cards.splice(idx, 1);
        await saveCards();
        return { ok: true };
    }

    cards.splice(idx, 1);
    return { ok: true };
}

async function batchDeleteCards(codes = [], operator = null) {
    await loadCards();
    const uniqueCodes = Array.from(new Set((codes || []).map(code => String(code || '').trim()).filter(Boolean)));
    let deletedCount = 0;
    const skipped = [];

    for (const code of uniqueCodes) {
        const result = await deleteCard(code, operator, { skipLoad: true });
        if (result.ok) {
            deletedCount++;
        } else {
            skipped.push({ code, error: result.error || '删除失败' });
        }
    }

    return { deletedCount, skipped };
}

// 初始化
async function loadAllFromDB() {
    await loadUsers();
    await loadCards();
    await initDefaultAdmin();
}

// initDefaultAdmin();
loadIPHistory();

/**
 * 按 username 查找用户完整信息（含卡密、角色、过期状态）
 * 用于 JWT 中间件实时校验用户当前状态
 */
async function getUserInfo(username) {
    await loadUsers();
    const u = users.find(item => item.username === username);
    if (!u) return null;
    const isExpired = u.card?.expiresAt ? u.card.expiresAt < Date.now() : false;
    const maxAccounts = u.maxAccounts || (u.card?.type === CARD_TYPES.TRIAL ? getTrialMaxAccounts() : 0);
    return {
        username: u.username,
        role: u.role || 'user',
        status: u.status || 'active',
        maxAccounts,
        cardCode: u.cardCode || null,
        card: u.card
            ? { ...u.card, enabled: (u.status || 'active') !== 'banned' }
            : null,
        isExpired,
    };
}

module.exports = {
    loadAllFromDB,
    loadUsers,
    loadCards,
    validateUser,
    registerUser,
    renewUser,
    getAllUsers,
    getAllUsersWithPassword,
    updateUser,
    deleteUser,
    changePassword,
    changeAdminPassword,
    getCardCatalog,
    getCardDetail,
    getAllCards,
    createCard,
    createCardsBatch,
    updateCard,
    batchUpdateCards,
    deleteCard,
    batchDeleteCards,
    hashPassword,
    createTrialCard,
    renewTrialUser,
    getUserInfo,
};
