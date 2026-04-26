import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";

import { api } from "../api/client.ts";
import { useSecrets } from "../api/queries.ts";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/secrets",
  component: Secrets,
});

function Secrets(): React.JSX.Element {
  const { data } = useSecrets();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const setSecret = useMutation({
    mutationFn: () => api.secrets.set(name, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["secrets"] });
      setName("");
      setValue("");
    },
  });

  const removeSecret = useMutation({
    mutationFn: (n: string) => api.secrets.remove(n),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["secrets"] }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Secrets</h1>
        <p className="text-sm text-muted-foreground">
          Encrypted values referenced by blueprints. Names only — values never leave the server.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Add</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name && value) setSecret.mutate();
            }}
          >
            <Input
              placeholder="NAME (SCREAMING_SNAKE_CASE)"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              className="font-mono max-w-xs"
            />
            <Input
              placeholder="value"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={!name || !value || setSecret.isPending}>
              {setSecret.isPending ? "…" : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stored secrets</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.secrets.length === 0 ? (
            <div className="text-sm text-muted-foreground">No secrets stored yet.</div>
          ) : (
            <ul className="space-y-2">
              {data?.secrets.map((n) => (
                <li
                  key={n}
                  className="flex items-center justify-between border-b last:border-b-0 pb-2"
                >
                  <span className="font-mono text-sm">{n}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSecret.mutate(n)}
                    disabled={removeSecret.isPending}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
