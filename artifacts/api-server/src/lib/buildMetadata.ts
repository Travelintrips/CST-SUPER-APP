const BUILD_REVISION = "__API_BUILD_REVISION__";
const SAFE_REVISION = /^[A-Za-z0-9._-]{1,200}$/;

const REVISION_ENV_KEYS = [
  "REPLIT_DEPLOYMENT_REVISION",
  "REPLIT_GIT_COMMIT_SHA",
  "GIT_COMMIT_SHA",
  "BUILD_SHA",
  "SOURCE_VERSION",
] as const;

export function getApiRevision(env: NodeJS.ProcessEnv = process.env): string {
  for (const key of REVISION_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value && SAFE_REVISION.test(value)) return value;
  }

  return BUILD_REVISION !== "__API_BUILD_REVISION__" &&
    SAFE_REVISION.test(BUILD_REVISION)
    ? BUILD_REVISION
    : "unknown";
}