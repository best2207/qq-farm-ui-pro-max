const { getPool } = require('./mysql-db');

function normalizeText(value, maxLength = 255) {
    return String(value || '').trim().slice(0, maxLength);
}

function normalizePositiveInt(value, fallback = 0) {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePlantNames(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map(item => normalizeText(item, 64))
        .filter(Boolean)
        .slice(0, 12);
}

function mapStatRow(row) {
    const updatedAt = row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(String(row.updated_at || ''));
    const lastStealAt = row.last_steal_at instanceof Date ? row.last_steal_at.getTime() : Date.parse(String(row.last_steal_at || ''));
    let plantNames = [];
    try {
        plantNames = typeof row.last_plant_names === 'string'
            ? JSON.parse(row.last_plant_names)
            : (row.last_plant_names || []);
    } catch {
        plantNames = [];
    }
    return {
        id: Number(row.id || 0),
        accountId: String(row.account_id || '').trim(),
        friendGid: Number(row.friend_gid || 0),
        friendUin: normalizeText(row.friend_uin, 64),
        friendOpenId: normalizeText(row.friend_open_id, 128),
        friendName: normalizeText(row.friend_name, 255) || `GID:${row.friend_gid}`,
        stealCount: Math.max(0, Number(row.steal_count || 0)),
        landCount: Math.max(0, Number(row.land_count || 0)),
        lastMode: normalizeText(row.last_mode, 32) || 'auto',
        lastPlantNames: normalizePlantNames(plantNames),
        lastStealAt: Number.isFinite(lastStealAt) ? lastStealAt : 0,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    };
}

async function recordStealSuccess(options = {}) {
    const pool = getPool();
    if (!pool) {
        return null;
    }
    const accountId = normalizeText(options.accountId, 64);
    const friendGid = normalizePositiveInt(options.friendGid, 0);
    if (!accountId || !friendGid) {
        return null;
    }

    const friendUin = normalizeText(options.friendUin, 64);
    const friendOpenId = normalizeText(options.friendOpenId, 128);
    const friendName = normalizeText(options.friendName, 255) || `GID:${friendGid}`;
    const stealCount = Math.max(1, Number(options.stealCount || options.count || 1));
    const landCount = Math.max(1, Number(options.landCount || stealCount || 1));
    const lastMode = normalizeText(options.mode, 32) || 'auto';
    const lastPlantNames = normalizePlantNames(options.plantNames);
    const lastStealAtMs = Math.max(0, Number(options.lastStealAt) || Date.now());

    await pool.execute(
        `INSERT INTO friend_steal_stats
            (account_id, friend_gid, friend_uin, friend_open_id, friend_name, steal_count, land_count, last_mode, last_plant_names, last_steal_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            friend_uin = COALESCE(NULLIF(VALUES(friend_uin), ''), friend_uin),
            friend_open_id = COALESCE(NULLIF(VALUES(friend_open_id), ''), friend_open_id),
            friend_name = COALESCE(NULLIF(VALUES(friend_name), ''), friend_name),
            steal_count = steal_count + VALUES(steal_count),
            land_count = land_count + VALUES(land_count),
            last_mode = VALUES(last_mode),
            last_plant_names = VALUES(last_plant_names),
            last_steal_at = VALUES(last_steal_at)`,
        [
            accountId,
            friendGid,
            friendUin || null,
            friendOpenId || null,
            friendName,
            stealCount,
            landCount,
            lastMode,
            JSON.stringify(lastPlantNames),
            new Date(lastStealAtMs),
        ],
    );

    return {
        accountId,
        friendGid,
        friendName,
        stealCount,
        landCount,
        lastMode,
        lastPlantNames,
        lastStealAt: lastStealAtMs,
    };
}

async function listFriendStealStats(accountId, options = {}) {
    const pool = getPool();
    if (!pool) {
        return [];
    }
    const normalizedAccountId = normalizeText(accountId, 64);
    if (!normalizedAccountId) {
        return [];
    }
    const limit = Math.min(Math.max(normalizePositiveInt(options.limit, 50), 1), 200);
    const keyword = normalizeText(options.keyword, 100);
    const where = ['account_id = ?'];
    const params = [normalizedAccountId];
    if (keyword) {
        const like = `%${keyword}%`;
        where.push('(friend_name LIKE ? OR friend_uin LIKE ? OR friend_open_id LIKE ? OR CAST(friend_gid AS CHAR) LIKE ?)');
        params.push(like, like, like, like);
    }
    const [rows] = await pool.query(
        `SELECT id, account_id, friend_gid, friend_uin, friend_open_id, friend_name, steal_count, land_count, last_mode, last_plant_names, last_steal_at, updated_at
         FROM friend_steal_stats
         WHERE ${where.join(' AND ')}
         ORDER BY steal_count DESC, updated_at DESC, id DESC
         LIMIT ${limit}`,
        params,
    );
    return rows.map(mapStatRow);
}

async function getFriendStealStatsOverview(accountId) {
    const pool = getPool();
    if (!pool) {
        return { totalFriends: 0, totalStealCount: 0, totalLandCount: 0, topFriends: [] };
    }
    const normalizedAccountId = normalizeText(accountId, 64);
    if (!normalizedAccountId) {
        return { totalFriends: 0, totalStealCount: 0, totalLandCount: 0, topFriends: [] };
    }
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS totalFriends, COALESCE(SUM(steal_count), 0) AS totalStealCount, COALESCE(SUM(land_count), 0) AS totalLandCount
         FROM friend_steal_stats
         WHERE account_id = ?`,
        [normalizedAccountId],
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const topFriends = await listFriendStealStats(normalizedAccountId, { limit: 5 });
    return {
        totalFriends: Math.max(0, Number(row?.totalFriends || 0)),
        totalStealCount: Math.max(0, Number(row?.totalStealCount || 0)),
        totalLandCount: Math.max(0, Number(row?.totalLandCount || 0)),
        topFriends,
    };
}

module.exports = {
    recordStealSuccess,
    listFriendStealStats,
    getFriendStealStatsOverview,
};
