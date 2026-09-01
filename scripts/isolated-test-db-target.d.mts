export function resolveIsolatedTestDatabaseUrl(
  env?: NodeJS.ProcessEnv,
  options?: {
    requireExplicitTest?: boolean;
    expectedProjectRef?: string;
  },
): string;