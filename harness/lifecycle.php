<?php
/**
 * Runs the plugin's deactivate and uninstall steps against the test site and prints the Editor's notice capabilities after each.
 *   php harness/lifecycle.php <site folder>
 */
[ , $root ] = $argv;
require $root . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';

$editor_can = static fn() => json_encode( array(
	'publish_notices' => get_role( 'editor' )->has_cap( 'publish_notices' ),
	'install_plugins' => get_role( 'editor' )->has_cap( 'install_plugins' ),
) );
$out = array( 'afterInstall' => json_decode( $editor_can(), true ) );

activate_plugin( 'notice-board/notice-board.php' ); // already active: must change nothing and not fail
$out['afterSecondActivate'] = json_decode( $editor_can(), true );

deactivate_plugins( 'notice-board/notice-board.php' );
$out['afterDeactivate'] = json_decode( $editor_can(), true ); // deactivating keeps the capabilities (they are data)

define( 'WP_UNINSTALL_PLUGIN', 'notice-board/notice-board.php' );
include WP_PLUGIN_DIR . '/notice-board/uninstall.php';
wp_cache_flush();
$out['afterUninstall'] = json_decode( $editor_can(), true );
$out['noticesLeftInDatabase'] = (int) $GLOBALS['wpdb']->get_var( "SELECT COUNT(*) FROM {$GLOBALS['wpdb']->posts} WHERE post_type = 'notice'" );

activate_plugin( 'notice-board/notice-board.php' ); // put it back for the other tests
$out['afterReactivate'] = json_decode( $editor_can(), true );
echo json_encode( $out );
