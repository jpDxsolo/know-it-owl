/**
 * Where the API lives, and the key that gets us in.
 *
 * sst.config.ts builds the site with these three set from the stack's own
 * outputs, so a deploy can never point the bundle at the wrong stage. The API
 * key is not a secret — it ships inside this bundle to every browser. The GM
 * token, handed out once by `createGame`, is what actually authorises anything.
 */
export interface ApiConfig {
  url: string;
  realtimeUrl: string;
  apiKey: string;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. The site is built with it by sst.config.ts; for a local ` +
        `dev server put it in packages/frontend/.env.local.`,
    );
  }
  return value;
}

let override: ApiConfig | undefined;

/** Point the client somewhere else. Tests use this; nothing else should. */
export function setApiConfig(config: ApiConfig | undefined): void {
  override = config;
}

export function apiConfig(): ApiConfig {
  if (override) return override;
  const env = import.meta.env;
  const url = required("VITE_GRAPHQL_URL", env.VITE_GRAPHQL_URL);
  return {
    url,
    // Derivable from the API URL, but the stack outputs it explicitly, so
    // prefer that and fall back only for a hand-written .env.local.
    realtimeUrl:
      env.VITE_GRAPHQL_REALTIME_URL ??
      url.replace("appsync-api", "appsync-realtime-api").replace(/^http/, "ws"),
    apiKey: required("VITE_GRAPHQL_API_KEY", env.VITE_GRAPHQL_API_KEY),
  };
}
