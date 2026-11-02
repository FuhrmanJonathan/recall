// Only navigate to an internal application path after authentication.
export function safeDestination(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return "/dashboard";
  return value;
}
