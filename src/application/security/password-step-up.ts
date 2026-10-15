import { auth } from "@/infrastructure/auth/auth";

export class StepUpRequiredError extends Error {
  constructor() {
    super("security.step_up_required");
  }
}

export interface StepUpProof {
  readonly userId: string;
  readonly verifiedAt: Date;
}

export async function verifyPasswordStepUp(
  requestHeaders: Headers,
  password: string,
): Promise<StepUpProof> {
  const normalized = password.trim();
  if (!normalized || normalized.length > 128) {
    throw new StepUpRequiredError();
  }

  const current = await auth.api.getSession({ headers: requestHeaders });
  if (!current?.user?.id || !current.user.email) {
    throw new StepUpRequiredError();
  }

  let result:
    | Awaited<ReturnType<typeof auth.api.signInEmail>>
    | undefined;
  let responseHeaders: Headers | undefined;
  try {
    const verified = await auth.api.signInEmail({
      returnHeaders: true,
      headers: requestHeaders,
      body: {
        email: current.user.email,
        password: normalized,
        rememberMe: false,
      },
    });
    responseHeaders = verified.headers;
    result = verified.response;
  } catch {
    throw new StepUpRequiredError();
  }

  if (
    !result ||
    ("twoFactorRedirect" in result && result.twoFactorRedirect === true) ||
    !("user" in result) ||
    !result.user ||
    result.user.id !== current.user.id
  ) {
    throw new StepUpRequiredError();
  }

  // The credential check can create an auxiliary short-lived session. Destroy
  // that temporary session immediately; the caller keeps its original session.
  try {
    const cookies = responseHeaders
      ?.getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .filter(Boolean)
      .join("; ");
    if (cookies) {
      await auth.api.signOut({ headers: new Headers({ cookie: cookies }) });
    }
  } catch {
    // Reauthentication already succeeded. Cleanup failure must not expose a
    // token or change authorization; session expiry remains short-lived.
  }

  return { userId: current.user.id, verifiedAt: new Date() };
}
