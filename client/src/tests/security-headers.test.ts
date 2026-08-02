import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Import the server helper to inspect generated headers
import { getSecurityHeaders } from '../../../server/src/security-headers';

describe('Security headers generation', () => {
    let origEnv: any;

    beforeEach(() => {
        origEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = origEnv;
    });

    it('includes Strict-Transport-Security and removes unsafe-inline in production', () => {
        process.env.NODE_ENV = 'production';
        const headers = getSecurityHeaders('text/html');
        expect(headers['Strict-Transport-Security']).toBeDefined();
        expect(headers['Content-Security-Policy']).toBeDefined();
        expect(headers['Content-Security-Policy']).not.toMatch(/unsafe-inline/);
    });

    it('allows unsafe-inline in non-production (dev)', () => {
        process.env.NODE_ENV = 'development';
        const headers = getSecurityHeaders('text/html');
        expect(headers['Strict-Transport-Security']).toBeUndefined();
        expect(headers['Content-Security-Policy']).toBeDefined();
        expect(headers['Content-Security-Policy']).toMatch(/unsafe-inline/);
    });
});
