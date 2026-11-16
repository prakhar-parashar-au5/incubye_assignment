-- Runs once, as root, when the local MySQL container starts with an empty
-- data directory (docker-entrypoint-initdb.d). The entrypoint has already
-- created acme_test (MYSQL_DATABASE) and the user acme (MYSQL_USER) with
-- access to it.
--
-- acme_dev:  local frontend/backend preview. Never reset by tests.
-- acme_test: destructive integration tests (guarded: name must end in _test).
--
-- Schema and data are not created here: run the migration and seed commands
-- explicitly against each database (see express-backend/README.md).
CREATE DATABASE IF NOT EXISTS `acme_dev` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
-- In a GRANT database name "_" is a wildcard; "\_" limits the grant to acme_dev
-- exactly, the same way the entrypoint grants acme\_test.
GRANT ALL PRIVILEGES ON `acme\_dev`.* TO 'acme'@'%';
