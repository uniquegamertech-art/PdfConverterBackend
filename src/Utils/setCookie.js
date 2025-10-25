// In Utils/setCookie.js (or wherever it is)
import { oneHourFromNow, thirtyDaysFromNow } from "./date.js";

const defaults = {
  sameSite: 'none',
  httpOnly: true,
  secure: true,
  path: '/',  // Add this here to override browser default
};

const getAccessTokenCookieOptions = () => ({
  ...defaults,
  expires: oneHourFromNow(),
});

const getRefreshTokenCookieOptions = () => ({
  ...defaults,
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