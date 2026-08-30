/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GRAPHQL_URL: string | undefined;
  readonly VITE_GRAPHQL_REALTIME_URL: string | undefined;
  readonly VITE_GRAPHQL_API_KEY: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
