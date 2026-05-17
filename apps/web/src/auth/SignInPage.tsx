import { useAuth } from "./AuthContext";

const ERROR_MESSAGES: Record<string, string> = {
  not_in_org:
    "Your GitHub account is not a member of the required organization. Ask an admin to invite you.",
  bad_oauth_state: "The sign-in link expired or was tampered with. Please try again.",
  account_disabled: "Your account has been disabled. Contact an admin.",
};

export function SignInPage() {
  const { signIn } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again.")
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg px-4">
      <div className="w-full max-w-md rounded-lg border border-app-border bg-app-surface p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-app-text mb-1">Vexana</h1>
        <p className="text-sm text-app-text-muted mb-6">
          Internal tooling for our engineering org. Sign in with GitHub to continue.
        </p>

        {errorMessage && (
          <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
            {errorMessage}
          </div>
        )}

        <button
          type="button"
          onClick={signIn}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-app-text px-4 py-2.5 text-sm font-medium text-app-bg hover:opacity-90 transition-opacity"
        >
          <GithubIcon />
          Sign in with GitHub
        </button>

        <p className="mt-4 text-xs text-app-text-muted">
          You must be a member of our GitHub organization to access the platform.
        </p>
      </div>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.63 22.41c.57.1.79-.25.79-.55v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.28 1.19-3.08-.12-.3-.52-1.5.11-3.12 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.18-1.18 3.18-1.18.63 1.62.23 2.83.11 3.12.74.8 1.19 1.82 1.19 3.08 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .3.21.66.8.55A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}
