<?php
/**
 * Installs WordPress into a fresh database, turns on the Notice Board plugin, makes test users and test notices,
 * and writes the logins to a JSON file for the tests.
 *   php harness/install.php <site folder> <credentials json file>
 */
[ , $root, $creds_file ] = $argv;
define( 'WP_INSTALLING', true );
require $root . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';

wp_install( 'Test School', 'admin', 'admin@example.com', true, '', 'admin-pass-123' );
update_option( 'permalink_structure', '/%postname%/' );

$activated = activate_plugin( 'notice-board/notice-board.php' );
if ( is_wp_error( $activated ) ) {
	fwrite( STDERR, 'Could not activate: ' . $activated->get_error_message() . "\n" );
	exit( 1 );
}
// The post type is registered on "init", which already ran before the plugin was active in this process.
// Registering again and flushing makes /wp-json/wp/v2/notices and the permalinks exist from the first request.
notice_board_register();
flush_rewrite_rules();

$creds = array();
foreach ( array(
	'admin'       => array( 1, 'admin-pass-123' ),
	'editor1'     => array( wp_create_user( 'editor1', 'editor-pass-123', 'editor1@example.com' ), 'editor-pass-123' ),
	'subscriber1' => array( wp_create_user( 'subscriber1', 'subscriber-pass-123', 'subscriber1@example.com' ), 'subscriber-pass-123' ),
) as $login => [ $id, $password ] ) {
	if ( 'editor1' === $login ) {
		( new WP_User( $id ) )->set_role( 'editor' );
	}
	if ( 'subscriber1' === $login ) {
		( new WP_User( $id ) )->set_role( 'subscriber' );
	}
	[ $app_password ] = WP_Application_Passwords::create_new_application_password( $id, array( 'name' => 'harness' ) );
	$creds[ $login ]  = array( 'id' => $id, 'login' => $login, 'password' => $password, 'appPassword' => $app_password );
}
wp_delete_post( 1, true ); // "Hello world"
wp_delete_post( 2, true ); // "Sample Page"

// ---- the notices ----------------------------------------------------------------------------------------------
$day = static fn( int $days_ago ): string => gmdate( 'Y-m-d H:i:s', time() - $days_ago * DAY_IN_SECONDS );
$published = array(
	array( 'Annual Day rehearsal schedule', 'Class 8A', 1 ),
	array( 'Q&A with the Principal', 'Class 10C', 2 ),
	array( "Teacher's Day programme", 'Class 9B', 3 ),
	array( 'Science fair: bring your models', 'Class 8A', 4 ),
	array( 'Library books due Friday', 'Class 9B', 5 ),
	array( 'Sports day: house colours', 'Class 8A', 6 ),
	array( 'Fee payment reminder', 'Class 10C', 7 ),
	array( 'Holiday on Monday', 'Class 9B', 8 ),
	array( 'Parent-teacher meeting on Saturday', 'Class 8A', 9 ),
	array( 'Bus route change', 'Class 9B', 10 ),
	array( 'Exam timetable (Class 10)', 'Class 10C', 11 ),
	array( 'Welcome back to school', '', 12 ),
);
$long = str_repeat( 'This notice has a long body so that the excerpt has to be cut short. ', 12 );
foreach ( $published as [ $title, $class, $ago ] ) {
	wp_insert_post( array(
		'post_type'    => 'notice',
		'post_status'  => 'publish',
		'post_title'   => $title,
		'post_content' => "<!-- wp:paragraph -->\n<p>Details for: {$title}. {$long}</p>\n<!-- /wp:paragraph -->",
		'post_date'    => get_date_from_gmt( $day( $ago ) ),
		'post_date_gmt' => $day( $ago ),
		'meta_input'   => array( 'notice_class' => $class ),
	) );
}
// Three notices that must NEVER show to a visitor: a draft, a scheduled one, a private one.
foreach ( array(
	array( 'draft', 'DRAFT: secret exam paper', 'Class 12D', 0 ),
	array( 'future', 'Scheduled: next term notice', 'Class 7F', -30 ),
	array( 'private', 'Staff only: salary dates', 'Class 6S', 1 ),
) as [ $status, $title, $class, $ago ] ) {
	wp_insert_post( array(
		'post_type'     => 'notice',
		'post_status'   => $status,
		'post_title'    => $title,
		'post_content'  => 'Not for visitors.',
		'post_date'     => get_date_from_gmt( $day( $ago ) ),
		'post_date_gmt' => $day( $ago ),
		'meta_input'    => array( 'notice_class' => $class ),
	) );
}
file_put_contents( $creds_file, json_encode( $creds, JSON_PRETTY_PRINT ) );
echo "installed: " . count( $published ) . " published notices, 3 hidden ones, " . count( $creds ) . " users\n";
