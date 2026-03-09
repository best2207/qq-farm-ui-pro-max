-- 卡密精细化管理增强
-- 为 cards 表补充批次/来源/备注/创建人等字段，并新增卡密操作日志表

ALTER TABLE `cards`
    ADD COLUMN IF NOT EXISTS `batch_no` VARCHAR(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `code`,
    ADD COLUMN IF NOT EXISTS `batch_name` VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `batch_no`,
    ADD COLUMN IF NOT EXISTS `source` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual' AFTER `days`,
    ADD COLUMN IF NOT EXISTS `channel` VARCHAR(64) COLLATE utf8mb4_unicode_ci DEFAULT '' AFTER `source`,
    ADD COLUMN IF NOT EXISTS `note` TEXT COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `channel`,
    ADD COLUMN IF NOT EXISTS `created_by` VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `note`,
    ADD COLUMN IF NOT EXISTS `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;

CREATE TABLE IF NOT EXISTS `card_operation_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `card_id` INT DEFAULT NULL,
    `card_code` VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `action` VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `operator` VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `target_username` VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `remark` VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `before_snapshot` JSON DEFAULT NULL,
    `after_snapshot` JSON DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_card_operation_logs_card_code` (`card_code`),
    KEY `idx_card_operation_logs_action_created` (`action`, `created_at`),
    KEY `idx_card_operation_logs_target_created` (`target_username`, `created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
