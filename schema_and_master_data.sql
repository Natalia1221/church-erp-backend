-- ========================================================
-- EXPORT SKEMA & MASTER DATA ERP CHURCH (TIDB / MYSQL)
-- Generated at: 2026-09-11T12:25:40.528Z
-- Urutan DDL & DML disesuaikan berdasarkan Foreign Key (FK)
-- ========================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ========================================================
-- 1. DROP TABLES (Urutan dari tabel anak ke tabel induk)
-- ========================================================
DROP TABLE IF EXISTS `t_cash_transactions`;
DROP TABLE IF EXISTS `t_assignments`;
DROP TABLE IF EXISTS `t_attendances`;
DROP TABLE IF EXISTS `role_menus`;
DROP TABLE IF EXISTS `user_roles`;
DROP TABLE IF EXISTS `t_events`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `m_settings`;
DROP TABLE IF EXISTS `m_finance_categories`;
DROP TABLE IF EXISTS `m_categories`;
DROP TABLE IF EXISTS `m_menus`;
DROP TABLE IF EXISTS `m_roles`;

-- ========================================================
-- 2. CREATE TABLES (Tabel Induk terlebih dahulu, lalu Tabel Anak)
-- ========================================================

-- --------------------------------------------------------
-- Struktur Tabel: m_roles
-- --------------------------------------------------------
CREATE TABLE `m_roles` (
  `id` varchar(36) NOT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `status` tinyint(1) DEFAULT '1',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: m_menus
-- --------------------------------------------------------
CREATE TABLE `m_menus` (
  `id` varchar(36) NOT NULL,
  `modul` varchar(100) DEFAULT NULL,
  `submodul` varchar(100) DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  `path` varchar(150) DEFAULT NULL,
  `icon` varchar(50) DEFAULT NULL,
  `sequence` decimal(10,2) DEFAULT '0.00',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: m_categories
-- --------------------------------------------------------
CREATE TABLE `m_categories` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `is_active` tinyint(1) DEFAULT '1',
  `sequence` decimal(10,2) DEFAULT '0.00',
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: m_finance_categories
-- --------------------------------------------------------
CREATE TABLE `m_finance_categories` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `group` varchar(100) DEFAULT NULL,
  `type` enum('INCOME','EXPENSE','BUKAN KEDUANYA') NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: m_settings
-- --------------------------------------------------------
CREATE TABLE `m_settings` (
  `id` varchar(36) NOT NULL,
  `group` varchar(100) NOT NULL,
  `key` varchar(100) NOT NULL,
  `value1` text DEFAULT NULL,
  `value2` text DEFAULT NULL,
  `value3` text DEFAULT NULL,
  `value4` text DEFAULT NULL,
  `status` tinyint(1) DEFAULT '1',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: users
-- --------------------------------------------------------
CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `name` varchar(150) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: t_events
-- --------------------------------------------------------
CREATE TABLE `t_events` (
  `id` varchar(36) NOT NULL,
  `event_type` enum('SERMON','MINGGU','LAINNYA') NOT NULL,
  `event_date` date NOT NULL,
  `title` varchar(100) DEFAULT NULL,
  `is_attendance` tinyint(1) DEFAULT '1',
  `is_persembahan` tinyint(1) DEFAULT '0',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: user_roles
-- --------------------------------------------------------
CREATE TABLE `user_roles` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `role_id` varchar(36) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `fk_1` (`user_id`),
  KEY `fk_2` (`role_id`),
  CONSTRAINT `fk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_2` FOREIGN KEY (`role_id`) REFERENCES `m_roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: role_menus
-- --------------------------------------------------------
CREATE TABLE `role_menus` (
  `id` varchar(36) NOT NULL,
  `role_id` varchar(36) NOT NULL,
  `menu_id` varchar(36) NOT NULL,
  `can_show` tinyint(1) DEFAULT '0',
  `can_read` tinyint(1) DEFAULT '0',
  `can_create` tinyint(1) DEFAULT '0',
  `can_update` tinyint(1) DEFAULT '0',
  `can_delete` tinyint(1) DEFAULT '0',
  `can_print` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `fk_1` (`role_id`),
  KEY `fk_2` (`menu_id`),
  CONSTRAINT `fk_1` FOREIGN KEY (`role_id`) REFERENCES `m_roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_2` FOREIGN KEY (`menu_id`) REFERENCES `m_menus` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: t_attendances
-- --------------------------------------------------------
CREATE TABLE `t_attendances` (
  `id` varchar(36) NOT NULL,
  `event_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `check_in_time` timestamp NULL DEFAULT NULL,
  `is_scheduled` tinyint(1) DEFAULT '0',
  `photo_proof` varchar(255) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `fk_1` (`event_id`),
  KEY `fk_2` (`user_id`),
  CONSTRAINT `fk_1` FOREIGN KEY (`event_id`) REFERENCES `t_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: t_assignments
-- --------------------------------------------------------
CREATE TABLE `t_assignments` (
  `id` varchar(36) NOT NULL,
  `event_id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `category_id` varchar(36) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `fk_1` (`event_id`),
  KEY `fk_2` (`user_id`),
  KEY `fk_3` (`category_id`),
  CONSTRAINT `fk_1` FOREIGN KEY (`event_id`) REFERENCES `t_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_3` FOREIGN KEY (`category_id`) REFERENCES `m_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------
-- Struktur Tabel: t_cash_transactions
-- --------------------------------------------------------
CREATE TABLE `t_cash_transactions` (
  `id` varchar(36) NOT NULL,
  `transaction_date` date NOT NULL,
  `category_id` varchar(36) NOT NULL,
  `type` enum('INCOME','EXPENSE','BUKAN KEDUANYA') NOT NULL,
  `amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `description` text DEFAULT NULL,
  `event_id` varchar(36) DEFAULT NULL,
  `recorded_by` varchar(36) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `fk_1` (`category_id`),
  KEY `fk_2` (`event_id`),
  KEY `fk_3` (`recorded_by`),
  CONSTRAINT `fk_1` FOREIGN KEY (`category_id`) REFERENCES `m_finance_categories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_2` FOREIGN KEY (`event_id`) REFERENCES `t_events` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_3` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ========================================================
-- 3. DATA MASTER AWAL (Urutan: Master -> Relasi)
-- ========================================================

-- Data tabel: m_roles (2 baris)
INSERT INTO `m_roles` (`id`, `code`, `name`, `description`, `status`, `created_at`, `updated_at`) VALUES ('de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', 'ADMIN', 'Administrator', 'Memiliki akses penuh ke seluruh sistem ERP gereja', 1, '2026-09-07 03:35:50', '2026-09-07 03:35:50');
INSERT INTO `m_roles` (`id`, `code`, `name`, `description`, `status`, `created_at`, `updated_at`) VALUES ('ff761fbd-9dc3-48ff-a27c-d8520dbd3ebc', 'GSM', 'GSM', 'Melakukan absensi dan melihat jadwal', 1, '2026-09-10 23:43:27', '2026-09-10 23:43:27');

-- Data tabel: m_menus (18 baris)
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('0748a68b-3a36-46a6-9393-ddd05c8a38ec', 'Setup', NULL, 'Settings', '/settings', 'Settings', '2.40', 1, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('22ca2b4e-30de-47ca-a451-78a0a2be2b0b', 'Keuangan', NULL, 'Kategori Keuangan', NULL, 'Layers', '4.10', 1, '2026-09-11 01:11:20');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('29c9f8a2-89f4-4872-8388-1ffad0a45f92', 'Setup', NULL, 'Role', '/roles', 'ShieldCheck', '2.20', 1, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('2a3ff6c7-c574-420b-937f-1353d8655304', 'Penjadwalan', NULL, 'Penjadwalan', NULL, 'Calendar', '3.00', 0, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('330e220e-a78f-4cfc-a1f4-b2d92dba2d80', 'Penjadwalan', 'Jadwal Pelayanan', 'Minggu', '/penjadwalan/jadwal/minggu', 'CalendarDays', '3.22', 1, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('5e38b7aa-b687-4b51-9b88-b0688eec47dc', 'Penjadwalan', 'Jadwal Pelayanan', 'Lainnya', '/penjadwalan/jadwal/lainnya', 'MoreHorizontal', '3.23', 1, '2026-09-10 01:42:26');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('673de218-4cd5-4ca0-8a3e-9d443d8313cc', 'Penjadwalan', 'Jadwal Pelayanan', 'Sermon', '/penjadwalan/jadwal/sermon', 'BookOpen', '3.21', 1, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('67cc239b-fe8a-4548-8209-891f7b573293', 'Keuangan', 'Kas Keuangan', 'Kas Keuangan', NULL, 'Layers', '4.20', 1, '2026-09-11 01:13:49');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('7a9c75fc-9ae2-4b49-84a8-63e8badf0fa9', 'Penjadwalan', 'Jadwal Pelayanan', 'Jadwal Pelayanan', NULL, 'Clock', '3.20', 1, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('7ec4163a-04a8-4776-8927-9937022d2848', 'Absensi', NULL, 'Absensi', '/absensi', 'ClipboardCheck', '4.00', 0, '2026-09-10 01:42:26');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('86e6d7ad-39d6-453e-a016-f63a38455a09', 'Keuangan', NULL, 'Keuangan', NULL, 'Money', '4.00', 1, '2026-09-11 02:04:46');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('a68072c4-dda3-4aa9-81af-722450e2f6c1', 'Keuangan', 'Kas Keuangan', 'Lainnya', NULL, 'Layers', '4.22', 1, '2026-09-11 01:12:34');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('d08d9a6c-4339-40cf-98a4-8466cc6f739f', 'Dashboard', NULL, 'Dashboard', '/dashboard', 'LayoutDashboard', '1.00', 0, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('d5afe3a7-7e30-486e-9f73-d0927845721c', 'Setup', NULL, 'User', '/users', 'Users', '2.30', 1, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('dece3766-f52f-46e8-be74-e3d5fea5c401', 'Setup', NULL, 'Menu', '/menus', 'Layers', '2.10', 1, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('e0386dd3-dc32-47e3-abc8-50f0f979b8a7', 'Keuangan', 'Kas Keuangan', 'Persembahan', NULL, 'Layers', '4.21', 1, '2026-09-11 01:11:49');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('efd2d49b-104b-47bb-b0eb-9cc487fbb753', 'Penjadwalan', NULL, 'Kategori Pelayanan', '/penjadwalan/kategori', 'Tags', '3.10', 1, '2026-09-10 01:42:25');
INSERT INTO `m_menus` (`id`, `modul`, `submodul`, `name`, `path`, `icon`, `sequence`, `is_active`, `created_at`) VALUES ('f111d350-f7e3-4b40-b02b-6a4741de3795', 'Setup', NULL, 'Setup', NULL, 'Settings', '2.00', 1, '2026-09-10 01:42:25');

-- Data tabel: m_categories (5 baris)
INSERT INTO `m_categories` (`id`, `name`, `description`, `created_at`, `is_active`, `sequence`, `updated_at`) VALUES ('0a3b2ec9-fe39-4219-b621-5338c2b4b7a3', 'Pemusik', 'Pelayanan pemusik dan instrumen ibadah', '2026-09-11 00:05:11', 1, '5.00', '2026-09-11 00:05:11');
INSERT INTO `m_categories` (`id`, `name`, `description`, `created_at`, `is_active`, `sequence`, `updated_at`) VALUES ('360f7029-e6e9-4870-9c6d-258301752ebe', 'Pujian', 'Pelayanan tim pujian dan singer ibadah', '2026-09-11 00:05:11', 1, '1.00', '2026-09-11 00:05:11');
INSERT INTO `m_categories` (`id`, `name`, `description`, `created_at`, `is_active`, `sequence`, `updated_at`) VALUES ('98f98a7c-975f-48ab-8b0c-e080c5f701b7', 'Horong 3', 'Kelompok pelayanan Horong 3', '2026-09-11 00:05:11', 1, '4.00', '2026-09-11 00:05:11');
INSERT INTO `m_categories` (`id`, `name`, `description`, `created_at`, `is_active`, `sequence`, `updated_at`) VALUES ('99f331c2-e379-491a-bd76-99c3d1f357e0', 'Horong 2', 'Kelompok pelayanan Horong 2', '2026-09-11 00:05:11', 1, '3.00', '2026-09-11 00:05:11');
INSERT INTO `m_categories` (`id`, `name`, `description`, `created_at`, `is_active`, `sequence`, `updated_at`) VALUES ('f0dd83d6-29e8-43d2-b0d1-dc3a1a6fc4f0', 'Horong 1', 'Kelompok pelayanan Horong 1', '2026-09-11 00:05:11', 1, '2.00', '2026-09-11 00:05:11');

-- Data tabel: m_settings (8 baris)
INSERT INTO `m_settings` (`id`, `group`, `key`, `value1`, `value2`, `value3`, `value4`, `status`, `created_at`, `updated_at`) VALUES ('02b02704-dbaa-48db-88d2-6808af16c354', 'm_module', 'MODULE TES', 'MODULE TES', '', '', '', 1, '2026-09-11 02:11:44', '2026-09-11 02:11:58');
INSERT INTO `m_settings` (`id`, `group`, `key`, `value1`, `value2`, `value3`, `value4`, `status`, `created_at`, `updated_at`) VALUES ('20528589-b279-4eb4-b835-01f69b4110fc', 'm_module', 'KEUANGAN', 'Keuangan', '3', NULL, NULL, 1, '2026-09-10 01:36:15', '2026-09-10 01:36:15');
INSERT INTO `m_settings` (`id`, `group`, `key`, `value1`, `value2`, `value3`, `value4`, `status`, `created_at`, `updated_at`) VALUES ('67a2bdae-432d-4d4f-84db-612eb01c1c82', 'm_module', 'PENJADWALAN', 'Penjadwalan', '2', NULL, NULL, 1, '2026-09-10 01:36:15', '2026-09-10 01:36:15');
INSERT INTO `m_settings` (`id`, `group`, `key`, `value1`, `value2`, `value3`, `value4`, `status`, `created_at`, `updated_at`) VALUES ('8588e133-d826-4373-8ec9-c865698cca4c', 'm_module', 'SETUP', 'Setup', '1', NULL, NULL, 1, '2026-09-10 01:36:15', '2026-09-10 01:36:15');
INSERT INTO `m_settings` (`id`, `group`, `key`, `value1`, `value2`, `value3`, `value4`, `status`, `created_at`, `updated_at`) VALUES ('97610cf3-efd9-40a7-be7b-c9faa23f219d', 'm_submodule', 'JADWAL_PELAYANAN', 'Jadwal Pelayanan', '1', NULL, NULL, 1, '2026-09-10 01:36:15', '2026-09-10 01:36:15');
INSERT INTO `m_settings` (`id`, `group`, `key`, `value1`, `value2`, `value3`, `value4`, `status`, `created_at`, `updated_at`) VALUES ('9b8c2e1d-cb54-4724-92db-887d4745d959', 'm_module', 'DASHBOARD', 'Dashboard', '0', NULL, NULL, 1, '2026-09-10 01:36:15', '2026-09-10 01:36:15');
INSERT INTO `m_settings` (`id`, `group`, `key`, `value1`, `value2`, `value3`, `value4`, `status`, `created_at`, `updated_at`) VALUES ('a2adc99a-0b0d-4e0f-9d4e-040666e34dbf', 'm_submodule', 'KAS_KEUANGAN', 'Kas Keuangan', '1', NULL, NULL, 1, '2026-09-10 01:36:15', '2026-09-10 01:36:15');
INSERT INTO `m_settings` (`id`, `group`, `key`, `value1`, `value2`, `value3`, `value4`, `status`, `created_at`, `updated_at`) VALUES ('b9dc6a8a-c97f-4121-81f2-0b3918156edc', 'm_module', 'ABSENSI', 'Absensi', '4', NULL, NULL, 1, '2026-09-10 01:36:15', '2026-09-10 01:36:15');

-- Data tabel: users (3 baris)
INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `is_active`, `created_at`, `updated_at`, `deleted_at`) VALUES ('634e7c62-3df0-49e7-8d9d-98bd3e0712ba', 'Plorida', 'plorida@gsm.com', '$2b$10$DyZ1.pD0J/q6J5dTsiWeKus7GREYgHMtwry.TmtQiTJkVkpVxpTL.', 1, '2026-09-11 01:28:31', '2026-09-11 01:28:31', NULL);
INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `is_active`, `created_at`, `updated_at`, `deleted_at`) VALUES ('9e92cef5-c804-4e10-bead-0af14ee0cb84', 'Pendeta / Admin Gereja', 'admin@gereja.com', '$2b$10$B3hpmZJynsyy1HHBaID.G.qCUzQ78s3pesOrHpliOtu/x/3a1iwz6', 1, '2026-09-07 03:56:49', '2026-09-07 03:56:49', NULL);
INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `is_active`, `created_at`, `updated_at`, `deleted_at`) VALUES ('c3892233-26cb-405c-8b9b-f1c9496ff22b', 'Natalia', 'natalia@gsm.com', '$2b$10$Urjegg3ckmef1MS53iOjZu7LL90HpiAzlG/Jnm7eJHWGnsibacCoC', 1, '2026-09-11 01:28:09', '2026-09-11 01:28:09', NULL);

-- Data tabel: user_roles (3 baris)
INSERT INTO `user_roles` (`id`, `user_id`, `role_id`, `created_at`) VALUES ('008c8270-ad33-4b2c-9bf0-e2aae3325a16', '9e92cef5-c804-4e10-bead-0af14ee0cb84', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', '2026-09-07 03:56:49');
INSERT INTO `user_roles` (`id`, `user_id`, `role_id`, `created_at`) VALUES ('55296eaa-e4d6-4d09-8b0d-14098cb6edf4', 'c3892233-26cb-405c-8b9b-f1c9496ff22b', 'ff761fbd-9dc3-48ff-a27c-d8520dbd3ebc', '2026-09-11 01:28:09');
INSERT INTO `user_roles` (`id`, `user_id`, `role_id`, `created_at`) VALUES ('e90073fd-4c2b-4830-9005-1640309b607f', '634e7c62-3df0-49e7-8d9d-98bd3e0712ba', 'ff761fbd-9dc3-48ff-a27c-d8520dbd3ebc', '2026-09-11 01:28:31');

-- Data tabel: role_menus (14 baris)
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('04a6ba4e-78d2-49d7-8512-ce51820e0fbc', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', 'dece3766-f52f-46e8-be74-e3d5fea5c401', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('1745e8c0-a8ba-42e3-9bb3-8e0dbb0cb681', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', '29c9f8a2-89f4-4872-8388-1ffad0a45f92', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('27874f95-2486-4ced-bae4-5e15bdab5f76', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', 'd5afe3a7-7e30-486e-9f73-d0927845721c', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('480b9331-c4d0-461c-86c9-f2670462868d', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', 'f111d350-f7e3-4b40-b02b-6a4741de3795', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('4e599ed9-7eb9-469e-8f24-ecdd6897eb4f', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', '7ec4163a-04a8-4776-8927-9937022d2848', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('5be6160d-fdab-4073-8311-d15e1e50b083', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', '7a9c75fc-9ae2-4b49-84a8-63e8badf0fa9', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('6e93a029-f0d7-4871-bb8a-ada682bd628f', 'ff761fbd-9dc3-48ff-a27c-d8520dbd3ebc', '7a9c75fc-9ae2-4b49-84a8-63e8badf0fa9', 1, 1, 0, 0, 0, 0);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('87fc36ce-731e-4b41-983a-c3a164171bca', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', '2a3ff6c7-c574-420b-937f-1353d8655304', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('9d083d7d-3b32-41b9-b779-94d6f9afbfda', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', 'efd2d49b-104b-47bb-b0eb-9cc487fbb753', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('aa357507-d387-4ef2-92f8-c95ccd7cbf45', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', '5e38b7aa-b687-4b51-9b88-b0688eec47dc', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('cb23aaac-909d-4899-a728-c218f2e1e123', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', 'd08d9a6c-4339-40cf-98a4-8466cc6f739f', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('ce7f1c15-dcf3-4468-a2a8-3afe326a1f4a', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', '0748a68b-3a36-46a6-9393-ddd05c8a38ec', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('ceaed128-e44e-44d3-a121-eecead50dce2', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', '330e220e-a78f-4cfc-a1f4-b2d92dba2d80', 1, 1, 1, 1, 1, 1);
INSERT INTO `role_menus` (`id`, `role_id`, `menu_id`, `can_show`, `can_read`, `can_create`, `can_update`, `can_delete`, `can_print`) VALUES ('d7134b00-a62f-4e61-9567-7fab4f193726', 'de7c8b3e-ce36-4bf2-9034-4ff3e10c71e4', '673de218-4cd5-4ca0-8a3e-9d443d8313cc', 1, 1, 1, 1, 1, 1);

SET FOREIGN_KEY_CHECKS = 1;
