<?php
/**
 * Plugin Name: Notice Board
 * Description: A "Notice" content type (title, body, class, publish date) with roles: an Editor can write and publish notices, a Subscriber can only read them. Notices are public through the REST API at /wp-json/wp/v2/notices.
 * Version:     1.0.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * License:     GPL-2.0-or-later
 * Text Domain: notice-board
 */

defined( 'ABSPATH' ) || exit; // never run this file directly

const NOTICE_BOARD_TYPE       = 'notice';
const NOTICE_BOARD_CLASS_META = 'notice_class';
const NOTICE_BOARD_CLASS_MAX  = 40;

/**
 * The capabilities of the Notice type. WordPress builds these names from capability_type:
 * ['notice', 'notices'] gives edit_notices, publish_notices, edit_others_notices and so on.
 * "read" stays the ordinary core capability, which every logged-in role (even Subscriber) already has.
 */
function notice_board_caps(): array {
	return array(
		'edit_notices',
		'edit_others_notices',
		'edit_published_notices',
		'edit_private_notices',
		'publish_notices',
		'read_private_notices',
		'delete_notices',
		'delete_others_notices',
		'delete_published_notices',
		'delete_private_notices',
	);
}

/** Roles that may manage notices. Subscriber is NOT here on purpose. No role gets install_plugins from this plugin. */
function notice_board_roles(): array {
	return array( 'administrator', 'editor' );
}

/* ---------------------------------------------------------------------------------------------------------
 * 1. The content type and its "class" field
 * ------------------------------------------------------------------------------------------------------ */

add_action( 'init', 'notice_board_register' );

function notice_board_register(): void {
	register_post_type(
		NOTICE_BOARD_TYPE,
		array(
			'labels'          => array(
				'name'          => __( 'Notices', 'notice-board' ),
				'singular_name' => __( 'Notice', 'notice-board' ),
				'add_new_item'  => __( 'Add new notice', 'notice-board' ),
				'edit_item'     => __( 'Edit notice', 'notice-board' ),
			),
			'public'          => true,
			'show_in_rest'    => true,       // needed for the block editor AND for /wp-json/wp/v2/notices
			'rest_base'       => 'notices',
			'menu_icon'       => 'dashicons-megaphone',
			'has_archive'     => false,
			// "custom-fields" lets the REST API read and write the registered meta below.
			'supports'        => array( 'title', 'editor', 'excerpt', 'custom-fields' ),
			'capability_type' => array( 'notice', 'notices' ),
			'map_meta_cap'    => true,       // turns edit_post / delete_post checks into the capabilities above
			'register_meta_box_cb' => 'notice_board_add_meta_box',
		)
	);

	// The "class" of a notice, e.g. "Class 8A". Stored as post meta, shown in REST under "meta".
	register_post_meta(
		NOTICE_BOARD_TYPE,
		NOTICE_BOARD_CLASS_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => array(
				'schema' => array(
					'type'      => 'string',
					'maxLength' => NOTICE_BOARD_CLASS_MAX, // a longer value is refused with a 400
				),
			),
			'sanitize_callback' => 'notice_board_sanitize_class', // tags and extra spaces are removed before saving
			'auth_callback'     => static function ( $allowed, $meta_key, $post_id ) {
				return current_user_can( 'edit_post', $post_id );
			},
		)
	);
}

function notice_board_sanitize_class( $value ): string {
	$value = sanitize_text_field( (string) $value ); // strips tags, collapses spaces, removes line breaks
	return mb_substr( $value, 0, NOTICE_BOARD_CLASS_MAX );
}

/* ---------------------------------------------------------------------------------------------------------
 * 2. Who may do what. Capabilities are stored in the database, so they are added once, on activation.
 * ------------------------------------------------------------------------------------------------------ */

register_activation_hook( __FILE__, 'notice_board_activate' );

function notice_board_activate(): void {
	foreach ( notice_board_roles() as $role_name ) {
		$role = get_role( $role_name );
		if ( ! $role ) {
			continue;
		}
		foreach ( notice_board_caps() as $cap ) {
			$role->add_cap( $cap );
		}
	}
}

/* ---------------------------------------------------------------------------------------------------------
 * 3. REST: a class filter on the list, and a list of the classes in use
 * ------------------------------------------------------------------------------------------------------ */

// GET /wp-json/wp/v2/notices?notice_class=Class 8A
add_filter( 'rest_notice_collection_params', static function ( array $params ): array {
	$params['notice_class'] = array(
		'description'       => __( 'Only notices for this class.', 'notice-board' ),
		'type'              => 'string',
		'maxLength'         => NOTICE_BOARD_CLASS_MAX,
		'sanitize_callback' => 'notice_board_sanitize_class',
		'validate_callback' => 'rest_validate_request_arg',
	);
	return $params;
} );

add_filter( 'rest_notice_query', static function ( array $args, WP_REST_Request $request ): array {
	$class = $request->get_param( 'notice_class' );
	if ( is_string( $class ) && '' !== $class ) {
		// WP_Query builds this with prepared statements, so a quote in the value cannot break out of the query.
		$args['meta_query'][] = array(
			'key'     => NOTICE_BOARD_CLASS_META,
			'value'   => $class,
			'compare' => '=',
		);
	}
	return $args;
}, 10, 2 );

// GET /wp-json/notice-board/v1/classes  ->  ["Class 10C", "Class 8A", ...]  (only classes of PUBLISHED notices)
add_action( 'rest_api_init', static function (): void {
	register_rest_route(
		'notice-board/v1',
		'/classes',
		array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true', // public: it lists only what a visitor could already see
			'callback'            => 'notice_board_list_classes',
		)
	);
} );

function notice_board_list_classes(): WP_REST_Response {
	global $wpdb;
	$values = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT DISTINCT pm.meta_value
			   FROM {$wpdb->postmeta} pm
			   JOIN {$wpdb->posts} p ON p.ID = pm.post_id
			  WHERE pm.meta_key = %s AND pm.meta_value <> '' AND p.post_type = %s AND p.post_status = 'publish'
			  ORDER BY pm.meta_value ASC",
			NOTICE_BOARD_CLASS_META,
			NOTICE_BOARD_TYPE
		)
	);
	return rest_ensure_response( array_values( array_map( 'strval', $values ) ) );
}

/* ---------------------------------------------------------------------------------------------------------
 * 4. The "Class" box on the edit screen
 * ------------------------------------------------------------------------------------------------------ */

function notice_board_add_meta_box(): void {
	add_meta_box( 'notice_board_class', __( 'Class', 'notice-board' ), 'notice_board_render_meta_box', NOTICE_BOARD_TYPE, 'side', 'high' );
}

function notice_board_render_meta_box( WP_Post $post ): void {
	wp_nonce_field( 'notice_board_save_class', 'notice_board_nonce' );
	printf(
		'<label for="notice_board_class_field" class="screen-reader-text">%1$s</label><input type="text" id="notice_board_class_field" name="notice_board_class_field" value="%2$s" maxlength="%3$d" class="widefat" placeholder="%4$s">',
		esc_html__( 'Class', 'notice-board' ),
		esc_attr( (string) get_post_meta( $post->ID, NOTICE_BOARD_CLASS_META, true ) ),
		NOTICE_BOARD_CLASS_MAX,
		esc_attr__( 'e.g. Class 8A', 'notice-board' )
	);
}

add_action( 'save_post_' . NOTICE_BOARD_TYPE, static function ( int $post_id ): void {
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! isset( $_POST['notice_board_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['notice_board_nonce'] ) ), 'notice_board_save_class' ) ) {
		return; // not our form (or a forged one)
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}
	$value = isset( $_POST['notice_board_class_field'] ) ? wp_unslash( $_POST['notice_board_class_field'] ) : '';
	update_post_meta( $post_id, NOTICE_BOARD_CLASS_META, notice_board_sanitize_class( $value ) );
} );
