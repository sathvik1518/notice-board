/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Empty = same address (Vite proxy). Or a full WordPress address, e.g. http://localhost:8080 */
  readonly VITE_WP_BASE?: string;
}
