<?php
/**
 * Runs when the plugin is DELETED from the Plugins screen (not when it is only deactivated).
 * Removes the capabilities this plugin added. The notices themselves are left in the database on purpose:
 * deleting someone's content because a plugin was removed would be a nasty surprise.
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

foreach ( array( 'administrator', 'editor' ) as $role_name ) {
	$role = get_role( $role_name );
	if ( ! $role ) {
		continue;
	}
	foreach ( array(
		'edit_notices', 'edit_others_notices', 'edit_published_notices', 'edit_private_notices', 'publish_notices',
		'read_private_notices', 'delete_notices', 'delete_others_notices', 'delete_published_notices', 'delete_private_notices',
	) as $cap ) {
		$role->remove_cap( $cap );
	}
}
