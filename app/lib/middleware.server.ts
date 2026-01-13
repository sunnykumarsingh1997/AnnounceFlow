/**
 * API Middleware for Session Token Verification
 * Protects /api/* routes with Shopify session token authentication
 */

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import type { AuthContext, AuthErrorCode } from "./auth.server";
import { AuthError } from "./auth.server";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of authentication - either success with context or error
 */
export type AuthResult =
    | { success: true; context: AuthContext }
    | { success: false; error: AuthError };

/**
 * Standard error response format for API routes
 */
export interface ApiErrorResponse {
    success: false;
    error: string;
    code: AuthErrorCode;
    requireReauth?: boolean;
}

// ============================================================================
// Middleware Functions
// ============================================================================

/**
 * Require authentication for API routes
 *
 * This function wraps Shopify's built-in authenticate.admin() and provides:
 * - Session token extraction from Authorization header
 * - JWT verification via Shopify's library
 * - Shop domain and user info extraction
 * - Proper error handling with typed responses
 *
 * @param request - The incoming request
 * @returns AuthContext with shop info and access token
 * @throws AuthError if authentication fails
 *
 * @example
 * ```ts
 * export const loader = async ({ request }: LoaderFunctionArgs) => {
 *   const auth = await requireAuth(request);
 *   // auth.shop, auth.accessToken are available
 *   return json({ shop: auth.shop });
 * };
 * ```
 */
export async function requireAuth(request: Request): Promise<AuthContext> {
    try {
        // Use Shopify's built-in authentication
        // This handles:
        // - Session token extraction from Authorization header (Bearer token)
        // - JWT verification using the app's secret
        // - Session lookup in the database
        const { session } = await authenticate.admin(request);

        if (!session) {
            throw new AuthError(
                "SESSION_NOT_FOUND",
                "No valid session found. Please reinstall the app.",
                true
            );
        }

        if (!session.accessToken) {
            throw new AuthError(
                "ACCESS_TOKEN_MISSING",
                "Session exists but access token is missing. Please reinstall the app.",
                true
            );
        }

        // Build the auth context
        const context: AuthContext = {
            shop: session.shop,
            accessToken: session.accessToken,
            sessionId: session.id,
            isOnline: session.isOnline ?? false,
        };

        // Add user info for online sessions
        if (session.isOnline && session.onlineAccessInfo) {
            const userInfo = session.onlineAccessInfo.associated_user;
            context.user = {
                id: String(userInfo.id),
                firstName: userInfo.first_name,
                lastName: userInfo.last_name,
                email: userInfo.email,
                accountOwner: userInfo.account_owner,
                locale: userInfo.locale,
            };
        }

        return context;
    } catch (error) {
        // Re-throw AuthErrors as-is
        if (error instanceof AuthError) {
            throw error;
        }

        // Handle Shopify authentication errors
        if (error instanceof Response) {
            // Shopify throws Response objects for auth failures
            const status = error.status;

            if (status === 401) {
                throw new AuthError(
                    "UNAUTHORIZED",
                    "Authentication required. Please log in.",
                    true
                );
            }

            if (status === 403) {
                throw new AuthError(
                    "INVALID_TOKEN",
                    "Invalid or expired session token.",
                    true
                );
            }
        }

        // Handle other errors
        console.error("Authentication error:", error);
        throw new AuthError(
            "UNAUTHORIZED",
            "Authentication failed. Please try again.",
            true
        );
    }
}

/**
 * Convert AuthError to JSON Response for API routes
 *
 * @param error - The authentication error
 * @returns JSON response with proper status code
 *
 * @example
 * ```ts
 * try {
 *   const auth = await requireAuth(request);
 * } catch (error) {
 *   if (error instanceof AuthError) {
 *     return handleAuthError(error);
 *   }
 *   throw error;
 * }
 * ```
 */
export function handleAuthError(error: AuthError): Response {
    const response: ApiErrorResponse = {
        success: false,
        error: error.message,
        code: error.code,
    };

    if (error.requireReauth) {
        response.requireReauth = true;
    }

    // All auth errors return 401
    return json(response, {
        status: 401,
        headers: {
            "X-Shopify-Reauth": error.requireReauth ? "true" : "false",
        },
    });
}

/**
 * Wrapper for protected API route handlers
 * Provides consistent error handling and authentication
 *
 * @param request - The incoming request
 * @param handler - The route handler function
 * @returns The handler result or error response
 *
 * @example
 * ```ts
 * export const loader = async ({ request }: LoaderFunctionArgs) => {
 *   return withAuth(request, async (auth) => {
 *     const data = await fetchData(auth.shop);
 *     return json({ success: true, data });
 *   });
 * };
 * ```
 */
export async function withAuth<T>(
    request: Request,
    handler: (auth: AuthContext) => Promise<T>
): Promise<T | Response> {
    try {
        const auth = await requireAuth(request);
        return await handler(auth);
    } catch (error) {
        if (error instanceof AuthError) {
            return handleAuthError(error);
        }

        // Re-throw Response objects (Remix/Shopify redirects)
        if (error instanceof Response) {
            throw error;
        }

        // Log unexpected errors
        console.error("Unexpected error in protected route:", error);

        return json(
            {
                success: false,
                error: "Internal server error",
                code: "UNAUTHORIZED",
            } as ApiErrorResponse,
            { status: 500 }
        );
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract Bearer token from Authorization header
 * Useful for custom token handling if needed
 *
 * @param request - The incoming request
 * @returns The token or null
 */
export function extractBearerToken(request: Request): string | null {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
        return null;
    }

    const parts = authHeader.split(" ");

    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
        return null;
    }

    return parts[1];
}

/**
 * Check if a request has a Bearer token
 */
export function hasAuthorizationHeader(request: Request): boolean {
    return extractBearerToken(request) !== null;
}
