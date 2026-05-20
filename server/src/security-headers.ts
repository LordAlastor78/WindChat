export function getSecurityHeaders(contentType: string): Record<string, string> {
    const isProd = process.env.NODE_ENV === "production";

    // Base CSP directives
    const cspDirectives = [
        "default-src 'self'",
        // Allow inline scripts/styles in non-production for dev HMR; remove in production
        isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-inline'",
        isProd
            ? "style-src 'self' https://fonts.googleapis.com"
            : "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        "connect-src 'self' ws: wss:", // WebSocket connections
        "worker-src 'self' blob:", // Service workers y web workers
        "manifest-src 'self'", // PWA manifest
        "frame-ancestors 'none'", // No permitir iframes
        "base-uri 'self'",
        "form-action 'self'",
    ];

    const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Content-Security-Policy": cspDirectives.join("; "),
        // Prevenir MIME type sniffing
        "X-Content-Type-Options": "nosniff",
        // Prevenir clickjacking (redundante con frame-ancestors pero compatible con navegadores viejos)
        "X-Frame-Options": "DENY",
        // Configurar el header Referrer para privacidad
        "Referrer-Policy": "strict-origin-when-cross-origin",
        // Permissions Policy - Deshabilitar APIs innecesarias
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    };

    // Incluir HSTS solo en producción (evitar romper local/dev)
    if (isProd) {
        headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
    }

    // Additional helmet-like headers in production
    if (isProd) {
        headers["X-DNS-Prefetch-Control"] = "off";
        headers["X-Download-Options"] = "noopen";
        headers["X-Permitted-Cross-Domain-Policies"] = "none";
    }

    return headers;
}

export default getSecurityHeaders;
