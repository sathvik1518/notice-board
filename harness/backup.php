<?php
/**
 * Makes a consistent copy of the SQLite database (the test site's equivalent of `mysqldump`).
 *   php harness/backup.php <source .sqlite file> <backup file>
 * VACUUM INTO writes a clean, complete copy even if the site is running.
 */
[ , $source, $target ] = $argv;
if ( file_exists( $target ) ) {
	unlink( $target );
}
$pdo = new PDO( 'sqlite:' . $source );
$pdo->exec( "VACUUM INTO '" . str_replace( "'", "''", $target ) . "'" );
echo "backup written: " . filesize( $target ) . " bytes\n";
