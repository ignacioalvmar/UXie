/**
 * Security headers (NFR-9; ADR-029). The Content-Security-Policy carries a per-request nonce, so it
 * is set by proxy.ts on page requests; the static headers apply to every response (next.config).
 */

export interface CspOptions {
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL: the browser fetches signed PDF URLs and uploads PDFs there. */
  supabaseUrl?: string;
  /** `next dev` needs eval for React's debugging aids; production never gets it. */
  dev: boolean;
  /** Served over HTTPS (production, previews): upgrade any stray http:// subresource. */
  https?: boolean;
}

export function contentSecurityPolicy({ nonce, supabaseUrl, dev, https }: CspOptions): string {
  let supabase = "";
  try {
    if (supabaseUrl) supabase = new URL(supabaseUrl).origin;
  } catch {
    // An invalid URL fails env validation elsewhere; never put it in the header.
  }
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // 'strict-dynamic': scripts loaded by the nonce'd Next.js runtime are trusted; no unsafe-eval.
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // React style attributes and next/font need inline styles; scripts are what matters for XSS.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...(supabase ? [supabase] : [])],
    // pdf.js runs in a module worker served from /_next/static.
    ["worker-src", "'self'", "blob:"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ...(https ? [["upgrade-insecure-requests"] as [string]] : []),
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}

/** Headers for every response, pages and assets alike. HSTS only in production (HTTPS). */
export function staticSecurityHeaders(production: boolean): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(production
      ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
      : []),
  ];
}

/** 128 random bits, base64 (CSP nonce). Web Crypto: works in the proxy and in Node. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
