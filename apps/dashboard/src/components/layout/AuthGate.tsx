import * as React from "react";
import { Lock } from "lucide-react";

import {
  fetchAuthRequirement,
  getBearerToken,
  rebuildApi,
  setBearerToken,
  verifyBearer,
} from "../../api/client.ts";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { Field } from "../ui/form.tsx";
import { Input } from "../ui/input.tsx";

type Phase = "loading" | "ok" | "needs-token";

export function AuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const req = await fetchAuthRequirement();
        if (cancelled) return;
        if (!req.tokenRequired) {
          setPhase("ok");
          return;
        }
        const existing = getBearerToken();
        if (existing && (await verifyBearer(existing))) {
          setPhase("ok");
          return;
        }
        setPhase("needs-token");
      } catch (e) {
        if (!cancelled) {
          // If we can't even reach /_oddjob/auth, fall through and show the app —
          // the user will see specific request failures instead of a blank gate.
          setPhase("ok");
          console.warn("[oddjob] could not check auth requirement:", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = inputRef.current?.value.trim();
    if (!value) return setError("token is required");
    setPending(true);
    setError(null);
    try {
      if (await verifyBearer(value)) {
        setBearerToken(value);
        rebuildApi();
        setPhase("ok");
      } else {
        setError("token rejected");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  if (phase === "loading") {
    return <div className="p-8 text-sm text-muted-foreground">Checking auth…</div>;
  }
  if (phase === "needs-token") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="size-5" /> Sign in to Oddjob
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <Field
                label="Bearer token"
                helper="set in ~/.oddjob/config.toml [server] bearer_token"
              >
                <Input
                  ref={inputRef}
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  placeholder="paste token"
                />
              </Field>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Verifying…" : "Continue"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
