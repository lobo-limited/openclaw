import { verifyAccessJwt } from "$lib/auth/access";
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  // Dev bypass: skip auth unless explicitly enforced
  if (process.env.NODE_ENV !== "production" && process.env.FORCE_AUTH !== "1") {
    event.locals.userEmail = "dev@local";
    return resolve(event);
  }
  const jwt = event.request.headers.get("cf-access-jwt-assertion");
  if (!jwt) return new Response("Forbidden: no CF Access JWT", { status: 403 });

  try {
    const claims = await verifyAccessJwt(jwt);
    const email = typeof claims.email === "string" ? claims.email : "";
    if (!email) return new Response("Forbidden: no email claim", { status: 403 });
    event.locals.userEmail = email;
  } catch (e) {
    return new Response(`Forbidden: ${(e as Error).message}`, { status: 403 });
  }
  return resolve(event);
};
