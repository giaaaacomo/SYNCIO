import {
  getStremioUser,
  resolveStremioAuthKey,
  stremioApiRequest,
  summarizeStremioUser
} from "./lib/stremio.js";
import { env, printShape, ProbeAbort, runProbe } from "./lib/probe.js";

await runProbe("stremio-auth", async () => {
  const hadAuthKey = Boolean(env("STREMIO_AUTH_KEY"));
  let authKey: string;

  if (hadAuthKey) {
    authKey = await resolveStremioAuthKey();
  } else {
    const email = env("STREMIO_EMAIL");
    const password = env("STREMIO_PASSWORD");
    if (!email || !password) {
      throw new ProbeAbort(
        "FAIL",
        "Set STREMIO_AUTH_KEY or both STREMIO_EMAIL and STREMIO_PASSWORD."
      );
    }
    const login = await stremioApiRequest("login", { email, password });
    printShape("Stremio login response shape", login.result);
    const loginRecord = login.result as Record<string, unknown>;
    if (typeof loginRecord.authKey !== "string") {
      throw new ProbeAbort("FAIL", "Stremio login did not return authKey.");
    }
    authKey = loginRecord.authKey;
  }

  const user = await getStremioUser(authKey);

  printShape("Stremio user response shape", user);

  return {
    status: "PASS",
    message: hadAuthKey
      ? "Stremio auth key is valid for getUser."
      : "Stremio login acquired an auth key and getUser succeeded.",
    details: {
      authMode: hadAuthKey ? "auth-key" : "email-password-login",
      account: summarizeStremioUser(user)
    }
  };
});
