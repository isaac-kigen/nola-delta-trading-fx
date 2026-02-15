export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function readSymbol(candidate: string | null | undefined): string {
  return (candidate ?? "").trim().toUpperCase();
}
