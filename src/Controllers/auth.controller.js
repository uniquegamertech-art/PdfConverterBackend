import { User } from "../Models/user.model.js";
import { codeSchema, forgotPasswordSchema, loginSchema, loginSchema1, resetPasswordSchema, resetPasswordSchema1, signupSchema, updateUserSchema, changePasswordSchema, resendVerificationCodeSchema } from "../Schemas/authSchema.js";
import { VerificationCodeModel } from "../Models/verificationCode.model.js";
import verificationCodeType from "../Constants/verificationCodeType.js";
import { oneHourFromNow } from "../Utils/date.js";
import { signAccessToken, signRefreshToken } from "../Utils/generateTokens.js";
import { setCookies,cookieDefaults } from "../Utils/setCookie.js";
import { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail, sendResetSuccessEmail } from "../mailtrap/emails.js";
import { ResetCode } from "../Models/resetCode.model.js";
import { verifyRefreshToken } from "../Utils/verifyTokens.js";
import redisClient from "../Utils/redisClient.js";
import jwt from "jsonwebtoken";

export const signup = async (request, reply) => {
  // Log initial session state
  console.log("Initial session:", request.session);

  // Touch session to initialize it
  await request.session.touch();

  // Set a dummy property to force session initialization
  request.session.initialized = true;

  // Get unencrypted session ID
  const symbolSessionId = Object.getOwnPropertySymbols(request.session).find(
    (sym) => sym.toString() === 'Symbol(sessionId)'
  );
  const sessionId = symbolSessionId ? request.session[symbolSessionId] : undefined;
  console.log("Unencrypted session ID:", sessionId);

  // If no sessionId, throw an error
  if (!sessionId) {
    console.error("Failed to obtain unencrypted session ID");
    return reply.code(500).send({
      success: false,
      message: "Internal server error: Could not initialize session",
    });
  }

  const data = signupSchema.parse({
    ...request.body,
  });
  const { userName, email, password, phoneNumber } = data;
  const existingUser = await User.findOne({
    $or: [{ email }, { userName }, { phoneNumber }],
  });

  if (existingUser) {
    if (existingUser.email === email) {
      return reply.code(400).send({
        success: false,
        message: "Email already exists.",
      });
    } else if (existingUser.userName === userName) {
      return reply.code(400).send({
        success: false,
        message: "Username already exists.",
      });
    } else if (existingUser.phoneNumber === phoneNumber) {
      return reply.code(400).send({
        success: false,
        message: "Phone number already exists.",
      });
    }
  }

  const user = await User.create({
    userName,
    email,
    password,
    phoneNumber,
  });

  const verificationCode = await VerificationCodeModel.create({
    userId: user._id,
    type: verificationCodeType.EmailVerification,
    expiresAt: oneHourFromNow(),
  });

  // Set session properties
  request.session.userId = user._id.toString();

  // Log session ID before signing tokens
  console.log("Session ID before signing tokens:", sessionId);

  const accessToken = await signAccessToken({
    userId: user._id.toString(),
    sessionId,
  });
  const refreshToken = await signRefreshToken({
    userId: user._id.toString(),
    sessionId,
  });

  // Set token after signing
  request.session.token = accessToken;

  // Explicitly save session
  await new Promise((resolve, reject) => {
    request.session.save((err) => {
      if (err) {
        console.error("Session save error in signup:", err);
        reject(err);
      } else {
        console.log("Session saved successfully in signup");
        // Debug: Verify session in MongoDB
        request.sessionStore.get(sessionId, (err, session) => {
          if (err) console.error("Session lookup error after save:", err);
          console.log("Saved session in MongoDB:", session);
          resolve();
        });
      }
    });
  });

  await redisClient.set(
    `rt:${user._id}:${sessionId}`,
    refreshToken,
    "EX",
    60 * 60 * 24 * 30 // 30 days
  );

  setCookies(reply, accessToken, "AccessToken");
  setCookies(reply, refreshToken, "RefreshToken");

  /* await sendVerificationEmail(user.email, verificationCode.code); */
  console.log(user);
  return reply.code(200).send({
    success: true,
    user: user.pomitPassword(),
    message: "User Created Successfully",
    session: request.session,
  });
};

// ... rest of the file remains the same ...

export const verifyEmail = async (request, reply) => {
  const verificationCode = codeSchema.parse(request.body.code);
  const validCode = await VerificationCodeModel.findOne({
    code: verificationCode,
    type: verificationCodeType.EmailVerification,
    expiresAt: { $gt: Date.now() },
  });
  if (!validCode) {
    return reply.code(400).send({
      success: false,
      message: "Invalid or Expired Code.",
    });
  }
  const updatedUser = await User.findByIdAndUpdate(
    validCode.userId,
    { isVerified: true },
    { new: true }
  );
  if (!updatedUser) {
    return reply.code(400).send({
      success: false,
      message: "Failed to verify email.",
    });
  }
  await validCode.deleteOne();
  /* await sendWelcomeEmail(updatedUser.email, updatedUser.name) */
  return reply.code(200).send({
    success: true,
    user: updatedUser.pomitPassword(),
    message: "Email verified Successfully",
    session: request.session,
  });
};

export const login = async (request, reply) => {
  console.log(request.session);

  // 1) initial lightweight parse (ensures fields exist)
  const { emailOrUsername, password: rawPassword } = loginSchema1.parse({
    ...request.body,
  });
  console.log(emailOrUsername, rawPassword);

  // 2) determine whether it's an email or username and fully validate
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let parsedData;
  if (emailRegex.test(emailOrUsername)) {
    parsedData = loginSchema.parse({
      email: emailOrUsername.toLowerCase(),
      password: rawPassword,
    });
  } else {
    parsedData = loginSchema.parse({
      userName: emailOrUsername,
      password: rawPassword,
    });
  }

  // parsedData will contain either `email` or `userName` and `password`
  const { email: mail, userName: username, password } = parsedData;
  console.log(mail, username, password);

  // 3) quick anti-automation/hack check (keeps your original logic)
  if (request.body.email || request.body.phoneNumber) {
    console.log("hackr");
    return reply.code(403).send({
      success: false,
      message: "Something is wrong.",
    });
  }

  // 4) find user (make sure to select password if schema hides it)
  const user = await User.findOne({
    $or: [{ email: mail }, { userName: username }],
  }).select("+password");

  if (!user) {
    return reply.code(400).send({
      success: false,
      message: "Invalid credentials.",
    });
  }

  // 5) compare password (uses your model method)
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return reply.code(400).send({
      success: false,
      message: "Invalid credentials.",
    });
  }

  // 6) check verification
  if (!user.isVerified) {
    return reply.code(403).send({
      success: false,
      message: "Please verify your email before logging in",
    });
  }

  // 7) regenerate session to prevent fixation attacks
  await new Promise((resolve) => {  // Promisify to await the entire regenerate process
    request.session.regenerate((err) => {
      if (err) {
        console.error("Session regeneration failed:", err);
        reply.code(500).send({
          success: false,
          message: "Internal server error",
        });
        resolve();
        return;
      }

      // Use an async IIFE to keep awaits inside the regenerate callback
      (async () => {
        try {
          request.session.userId = user._id.toString();
          // generate tokens (sessionId is the regenerated request.session.id)
          const accessToken = await signAccessToken({
            userId: user._id.toString(),
            sessionId: request.session.id,  // Changed to .id
          });
          const refreshToken = await signRefreshToken({
            userId: user._id.toString(),
            sessionId: request.session.id,  // Changed to .id
          });
          request.session.token = accessToken;
          // Explicitly save session
          await new Promise((innerResolve, innerReject) => {
            request.session.save((err) => {
              if (err) {
                console.error("Session save error in login:", err);
                innerReject(err);
              } else {
                console.log("Session saved successfully in login");
                innerResolve();
              }
            });
          });
          const key = `rt:${user._id}:${request.session.id}`;  // Changed to .id
          await redisClient.setex(key, 60 * 60 * 24 * 30, refreshToken);

          const stored = await redisClient.get(key);
          const ttl = await redisClient.ttl(key); // returns seconds remaining, -2 = missing, -1 = no TTL

          console.log("redis stored:", !!stored, "ttl:", ttl, "valueSample:", stored?.slice(0, 10));
          // store session values
       
        

          // set cookies (your helper)
          setCookies(reply, accessToken, "AccessToken");
          setCookies(reply, refreshToken, "RefreshToken");

          // update last login and save
          user.lastLogin = new Date();
          await user.save({ validateBeforeSave: false });

          // final response (inside regenerate callback)
          reply.code(200).send({
            success: true,
            user: user.pomitPassword(), // preserved your method name
            message: "Login successful",
            session: request.session,
          });
          resolve();
        } catch (e) {
          console.error("Error during post-regenerate login steps:", e);
          reply.code(500).send({
            success: false,
            message: "Internal server error",
          });
          resolve();
        }
      })();
    });
  });
};

export const logout = async (request, reply) => {
  const sessionId = request.session.id;  // Changed to .id
  const refreshToken = request.cookies.RefreshToken;
  await new Promise((resolve) => {  // Promisify to await the entire destroy process
    request.session.destroy((err) => {  // Removed 'async' from callback; handle awaits inside try/catch
      if (err) {
        console.error("❌ Failed to destroy session:", err);
        reply.code(500).send({
          success: false,
          message: "Internal server error during logout",
        });
        resolve();
        return;
      }
      (async () => {
        try {
          if (refreshToken) {
            // store it in Redis with same expiry (30d)
            const decoded = jwt.decode(refreshToken);
            const expiresInSec = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 60 * 60 * 24 * 30;
            await redisClient.setex(`bl_rt:${refreshToken}`, expiresInSec, "blacklisted");
          }
          const clearOpts = {
            ...cookieDefaults,
          };
          reply.clearCookie("AccessToken", clearOpts);

          reply.clearCookie("RefreshToken", clearOpts);
          reply.clearCookie("sessionId", clearOpts); // if you set this cookie
          reply.code(200).send({
            success: true,
            message: "Logout successful",
          });
          resolve();
        } catch (e) {
          console.error("Error during logout:", e);
          reply.code(500).send({
            success: false,
            message: "Internal server error during logout",
          });
          resolve();
        }
      })();
    });
  });
};

export const forgotPassword = async (request, reply) => {
  const { email } = forgotPasswordSchema.strict().parse({
    ...request.body,
  });

  const user = await User.findOne({ email });

  if (!user) {
    return reply.code(400).send({
      success: false,
      message: "Invalid credentials.",
    });
  }

  if (!user.isVerified) {
    return reply.code(403).send({
      success: false,
      message: "Please verify your email before logging in",
    });
  }
  // Generate reset token

  const resetCode = await ResetCode.create({
    userId: user._id,
    type: verificationCodeType.PasswordReset,
    expiresAt: oneHourFromNow(),
  });

  // send email
  /* await sendPasswordResetEmail(user.email, `${process.env.CLIENT_URL}/reset-password/${resetCode.code}`); */

  return reply.code(200).send({ success: true, message: "Password reset link sent to your email" });
};

export const resetPassword = async (request, reply) => {
  const { token } = request.params;
  console.log(token);
  const { code } = resetPasswordSchema1.strict().parse({
    code: token,
  });

  const resetCode = await ResetCode.findOne({
    code: code,
    expiresAt: { $gt: Date.now() },
  });
  if (!resetCode) {
    return reply.code(400).send({ success: false, message: "Invalid or expired reset token" });
  }
  const { password } = resetPasswordSchema.strict().parse({
    ...request.body,
  });

  const user = await User.findOne({ _id: resetCode.userId });
  if (!user.isVerified) {
    return reply.code(403).send({
      success: false,
      message: "Please verify your email before logging in",
    });
  }
  // update password

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { password: password },
    { new: true }
  );
  console.log(updatedUser);
  await ResetCode.deleteOne({ _id: resetCode._id });
  /* await sendResetSuccessEmail(updatedUser.email); */

  return reply.code(200).send({ success: true, message: "Password reset successful" });
};

export const refresh = async (request, reply) => {
  console.log("Refresh token request received");
  const refreshToken = request.cookies?.RefreshToken;
  console.log("RefreshToken:", refreshToken);

  if (!refreshToken) {
    console.log("No RefreshToken provided in cookies");
    return reply.code(401).send({ success: false, message: "No refresh token provided" });
  }

  const result = await verifyRefreshToken(refreshToken);
  console.log("VerifyRefreshToken result:", result);

  if (!result.valid) {
    return reply.code(result.status).send({ success: false, message: result.message });
  }

  const stored = await redisClient.get(`rt:${result.userId}:${result.sessionId}`);
  console.log("Stored token in Redis:", stored);
  if (!stored || stored !== refreshToken) {
    return reply.code(401).send({ success: false, message: "Invalid refresh token" });
  }

  const blacklisted = await redisClient.get(`bl_rt:${refreshToken}`);
  console.log("Blacklisted check:", blacklisted);
  if (blacklisted) {
    return reply.code(401).send({ success: false, message: "Refresh token is revoked" });
  }

  // Check session validity using unencrypted sessionId
  const session = await new Promise((resolve, reject) => {
    request.sessionStore.get(result.sessionId, (err, session) => {
      if (err) {
        console.error("Session store error:", err);
        return reject(err);
      }
      console.log("Session lookup for ID:", result.sessionId, "Result:", session);
      resolve(session);
    });
  });

  if (!session) {
    // Debug: Try direct MongoDB lookup
    const mongoClient = request.sessionStore.client;
    const sessionDoc = await mongoClient.db().collection('sessions').findOne({ _id: result.sessionId });
    console.log("Direct MongoDB session lookup:", sessionDoc);
    return reply.code(401).send({ success: false, message: "Session expired or invalid" });
  }

  // Touch current session
  await request.session.touch();
  console.log("Session touched");

  // Get current unencrypted session ID
  const symbolSessionId = Object.getOwnPropertySymbols(request.session).find(
    (sym) => sym.toString() === 'Symbol(sessionId)'
  );
  const currentSessionId = symbolSessionId ? request.session[symbolSessionId] : undefined;
  console.log("Current unencrypted session ID:", currentSessionId);

  // If no currentSessionId, throw an error
  if (!currentSessionId) {
    console.error("Failed to obtain current unencrypted session ID");
    return reply.code(500).send({
      success: false,
      message: "Internal server error: Could not initialize session",
    });
  }

  // Issue new tokens
  const newAccessToken = await signAccessToken({
    userId: result.userId.toString(),
    sessionId: currentSessionId,
  });
  const newRefreshToken = await signRefreshToken({
    userId: result.userId.toString(),
    sessionId: currentSessionId,
  });
  console.log("New tokens generated");

  await redisClient.set(
    `rt:${result.userId}:${currentSessionId}`,
    newRefreshToken,
    "EX",
    60 * 60 * 24 * 30 // 30 days
  );
  console.log("New refresh token stored in Redis");

  // Blacklist old refresh token
  const oldToken = refreshToken;
  if (oldToken) {
    const decoded = jwt.decode(oldToken);
    const expiresInSec = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 60 * 60 * 24 * 30;
    await redisClient.setex(`bl_rt:${oldToken}`, expiresInSec, "rotated");
    console.log("Old refresh token blacklisted");
  }

  setCookies(reply, newAccessToken, "AccessToken");
  setCookies(reply, newRefreshToken, "RefreshToken");
  console.log("Cookies set");

  return reply.code(200).send({ success: true, message: "Tokens refreshed successfully" });
};

export const checkAuth = async (request, reply) => {
  // request.user is populated by requireAuth preHandler
  if (!request.user) {
    return reply.code(401).send({ success: false, message: "User not authenticated" });
  }

  // Return the user object, which now includes the role
  return reply.code(200).send({ success: true, user: request.user.pomitPassword() });
};

export const updateUserProfile = async (request, reply) => {
  const userId = request.userId; // From requireAuth preHandler
  const updates = updateUserSchema.parse(request.body);

  const user = await User.findById(userId);
  if (!user) {
    return reply.code(404).send({ success: false, message: "User not found." });
  }

  // Handle unique constraint checks for email, userName, phoneNumber
  if (updates.email && updates.email !== user.email) {
    const emailExists = await User.findOne({ email: updates.email });
    if (emailExists && !emailExists._id.equals(userId)) {
      return reply.code(400).send({ success: false, message: "Email already in use." });
    }
    user.email = updates.email;
    user.isVerified = false; // Mark as unverified if email changes
    // Optionally send new verification email here
    const verificationCode = await VerificationCodeModel.create({
      userId: user._id,
      type: verificationCodeType.EmailVerification,
      expiresAt: oneHourFromNow(),
    });
    /* await sendVerificationEmail(user.email, verificationCode.code); */
  }

  if (updates.userName && updates.userName !== user.userName) {
    const userNameExists = await User.findOne({ userName: updates.userName });
    if (userNameExists && !userNameExists._id.equals(userId)) {
      return reply.code(400).send({ success: false, message: "Username already in use." });
    }
    user.userName = updates.userName;
  }

  if (updates.phoneNumber && updates.phoneNumber !== user.phoneNumber) {
    const phoneNumberExists = await User.findOne({ phoneNumber: updates.phoneNumber });
    if (phoneNumberExists && !phoneNumberExists._id.equals(userId)) {
      return reply.code(400).send({ success: false, message: "Phone number already in use." });
    }
    user.phoneNumber = updates.phoneNumber;
  }

  await user.save({ validateBeforeSave: false }); // Skip password hashing pre-save hook

  return reply.code(200).send({
    success: true,
    message: "Profile updated successfully.",
    user: user.pomitPassword(),
  });
};

export const changePassword = async (request, reply) => {
  const userId = request.userId; // From requireAuth preHandler
  const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);

  const user = await User.findById(userId).select("+password"); // Select password to compare
  if (!user) {
    return reply.code(404).send({ success: false, message: "User not found." });
  }

  // Compare current password
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return reply.code(400).send({ success: false, message: "Incorrect current password." });
  }

  // Update password
  user.password = newPassword; // Pre-save hook will hash it
  await user.save();

  return reply.code(200).send({ success: true, message: "Password updated successfully." });
};

export const resendVerificationCode = async (request, reply) => {
  const { email } = resendVerificationCodeSchema.parse(request.body);

  const user = await User.findOne({ email });
  if (!user) {
    return reply.code(404).send({ success: false, message: "User not found." });
  }

  if (user.isVerified) {
    return reply.code(400).send({ success: false, message: "Email is already verified." });
  }

  // Delete any existing unexpired verification codes for this user
  await VerificationCodeModel.deleteMany({
    userId: user._id,
    type: verificationCodeType.EmailVerification,
    expiresAt: { $gt: Date.now() },
  });

  // Generate a new verification code
  const newVerificationCode = await VerificationCodeModel.create({
    userId: user._id,
    type: verificationCodeType.EmailVerification,
    expiresAt: oneHourFromNow(),
  });

  /* await sendVerificationEmail(user.email, newVerificationCode.code); */
  console.log(`New verification code for ${user.email}: ${newVerificationCode.code}`);

  return reply.code(200).send({ success: true, message: "New verification code sent. Please check your email." });
};