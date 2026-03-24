-- 账号身份字段补齐由 mysql-db.js 按列检测后执行。
-- 这里仅保留跨版本兼容的新表创建语句，避免旧版 MySQL / MariaDB
-- 因 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 语法差异导致启动失败。

CREATE TABLE IF NOT EXISTS friend_risk_profiles (
    id BIGINT NOT NULL AUTO_INCREMENT,
    account_id INT NOT NULL,
    friend_gid BIGINT NOT NULL,
    friend_uin VARCHAR(64) DEFAULT NULL,
    friend_open_id VARCHAR(128) DEFAULT NULL,
    friend_name VARCHAR(255) DEFAULT NULL,
    risk_score INT NOT NULL DEFAULT 0,
    risk_level VARCHAR(16) NOT NULL DEFAULT 'low',
    strategy_state VARCHAR(32) NOT NULL DEFAULT 'observe',
    tags JSON DEFAULT NULL,
    last_hit_reason VARCHAR(100) DEFAULT NULL,
    last_hit_at DATETIME DEFAULT NULL,
    last_observed_at DATETIME DEFAULT NULL,
    meta JSON DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_friend_risk_profile_account_gid (account_id, friend_gid),
    KEY idx_friend_risk_profile_level (account_id, risk_level, updated_at),
    KEY idx_friend_risk_profile_last_hit (account_id, last_hit_at),
    CONSTRAINT fk_friend_risk_profile_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS friend_risk_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    account_id INT NOT NULL,
    friend_gid BIGINT NOT NULL,
    friend_uin VARCHAR(64) DEFAULT NULL,
    friend_open_id VARCHAR(128) DEFAULT NULL,
    friend_name VARCHAR(255) DEFAULT NULL,
    event_type VARCHAR(64) NOT NULL,
    score_delta INT NOT NULL DEFAULT 0,
    event_payload JSON DEFAULT NULL,
    observed_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_friend_risk_events_account_observed (account_id, observed_at),
    KEY idx_friend_risk_events_account_gid_observed (account_id, friend_gid, observed_at),
    CONSTRAINT fk_friend_risk_events_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS friend_steal_stats (
    id BIGINT NOT NULL AUTO_INCREMENT,
    account_id INT NOT NULL,
    friend_gid BIGINT NOT NULL,
    friend_uin VARCHAR(64) DEFAULT NULL,
    friend_open_id VARCHAR(128) DEFAULT NULL,
    friend_name VARCHAR(255) DEFAULT NULL,
    steal_count INT NOT NULL DEFAULT 0,
    land_count INT NOT NULL DEFAULT 0,
    last_mode VARCHAR(32) NOT NULL DEFAULT 'auto',
    last_plant_names JSON DEFAULT NULL,
    last_steal_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_friend_steal_stats_account_gid (account_id, friend_gid),
    KEY idx_friend_steal_stats_account_updated (account_id, updated_at),
    KEY idx_friend_steal_stats_account_steal (account_id, steal_count),
    CONSTRAINT fk_friend_steal_stats_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
