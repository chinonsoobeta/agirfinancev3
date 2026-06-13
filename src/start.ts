import { createStart, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

function wantsHtmlDocument(request?: Request | null) {
  const accept = request?.headers.get("accept") ?? "";
  const destination = request?.headers.get("sec-fetch-dest") ?? "";
  const mode = request?.headers.get("sec-fetch-mode") ?? "";
  return accept.includes("text/html") && (destination === "document" || mode === "navigate");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function errorStatus(message: string) {
  return message.startsWith("Unauthorized:") ? 401 : 500;
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    const request = getRequest();
    const message = errorMessage(error);
    const status = errorStatus(message);
    if (!wantsHtmlDocument(request)) {
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    return new Response(renderErrorPage(), {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
