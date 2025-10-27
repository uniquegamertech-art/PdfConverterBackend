// Utils/setCookie.js
import { oneHourFromNow, thirtyDaysFromNow } from "./date.js";

const isProd = process.env.NODE_ENV === "production";

export const cookieDefaults = {
  sameSite: "none",        // MUST be 'none' for cross-site cookies
  httpOnly: true,
  secure: true,          // true in production (HTTPS); false in dev (localhost)
  path: "/",               // ensure same path when clearing
  // domain: process.env.COOKIE_DOMAIN || undefined, // optionally set if you need it for subdomains
};

const getAccessTokenCookieOptions = () => ({
  ...cookieDefaults,
  expires: oneHourFromNow(),
});

const getRefreshTokenCookieOptions = () => ({
  ...cookieDefaults,
  expires: thirtyDaysFromNow(),
});

export const setCookies = (reply, token, name) => {
  let options;
  if (name === "AccessToken") {
    options = getAccessTokenCookieOptions();
  } else if (name === "RefreshToken") {
    options = getRefreshTokenCookieOptions();
  }

  reply.setCookie(name, token, options);
};
