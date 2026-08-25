// Type-resolution stub ONLY (tsc never checks the Deno-targeted source).
// At RUNTIME vitest imports the real ../../../supabase/functions/auth-sign-in/index
// file - the byte-equality proof always executes the live Edge Function code.
export interface AuthSignInDeps {
  env?: Record<string, string | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createServiceClient?: (url: string, serviceKey: string) => any;
  gotrueFetch?: typeof fetch;
}
export declare function handleAuthSignIn(
  req: Request,
  deps?: AuthSignInDeps,
): Promise<Response>;
