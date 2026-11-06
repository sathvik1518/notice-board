<?php
/**
 * Lets PHP's built-in web server behave like Apache with "pretty permalinks" (mod_rewrite):
 * real files are served as they are, everything else goes to WordPress's index.php.
 * Only for the test site. A real host does this itself.
 */
$path = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
$file = $_SERVER['DOCUMENT_ROOT'] . $path;

if ( '/' !== $path && is_file( $file ) ) {
	return false; // wp-login.php, images, css... served directly
}
if ( is_dir( $file ) && is_file( rtrim( $file, '/' ) . '/index.php' ) ) {
	chdir( $file ); // /wp-admin/
	require rtrim( $file, '/' ) . '/index.php';
	return true;
}
$_SERVER['SCRIPT_NAME']     = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = $_SERVER['DOCUMENT_ROOT'] . '/index.php';
chdir( $_SERVER['DOCUMENT_ROOT'] );
require $_SERVER['DOCUMENT_ROOT'] . '/index.php';
