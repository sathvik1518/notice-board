<?php
// The test site's settings. Written next to WordPress by harness/wp.mjs.
// The database is a SQLite file (the "SQLite Database Integration" plugin makes WordPress use it instead of MySQL).
$port = getenv( 'WP_PORT' ) ?: '8080';
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', 'unused' );
define( 'DB_PASSWORD', 'unused' );
define( 'DB_HOST', 'localhost' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );
define( 'DB_DIR', getenv( 'WP_DB_DIR' ) ?: __DIR__ . '/wp-content/database/' );
define( 'DB_FILE', getenv( 'WP_DB_FILE' ) ?: '.ht.sqlite' ); // a different file here is a different database
define( 'WP_ENVIRONMENT_TYPE', 'local' ); // also lets Application Passwords work over plain http
define( 'WP_HOME', 'http://localhost:' . $port );
define( 'WP_SITEURL', 'http://localhost:' . $port );
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_DISPLAY', false );
define( 'WP_DEBUG_LOG', true );
define( 'AUTH_KEY', 'test-only-key-1' );
define( 'SECURE_AUTH_KEY', 'test-only-key-2' );
define( 'LOGGED_IN_KEY', 'test-only-key-3' );
define( 'NONCE_KEY', 'test-only-key-4' );
define( 'AUTH_SALT', 'test-only-salt-1' );
define( 'SECURE_AUTH_SALT', 'test-only-salt-2' );
define( 'LOGGED_IN_SALT', 'test-only-salt-3' );
define( 'NONCE_SALT', 'test-only-salt-4' );
$table_prefix = 'wp_';
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
