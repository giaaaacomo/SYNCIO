export interface SetupAuthorizationFailure {
  ok: false;
  status: 401 | 503;
  error: string;
}

export async function authorizeSetup(
  request: Request,
  configuredToken: string | undefined
): Promise<{ ok: true } | SetupAuthorizationFailure> {
  if (!configuredToken) {
    return { ok: false, status: 503, error: "SYNCIO_SETUP_TOKEN is not configured." };
  }

  const authorization = request.headers.get("authorization");
  const providedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!providedToken || !(await sameSecret(providedToken, configuredToken))) {
    return { ok: false, status: 401, error: "Setup authorization required." };
  }
  return { ok: true };
}

async function sameSecret(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= (leftDigest[index] ?? 0) ^ (rightDigest[index] ?? 0);
  }
  return difference === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
