import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";

import { api } from "../api/client.ts";
import { useSecrets } from "../api/queries.ts";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Section } from "../components/ui/section.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/secrets",
  component: SecretsPage,
});

export function SecretsPage(): React.JSX.Element {
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
    <div className="space-y-8">
      <Section
        title="Add secret"
        description="Encrypted values referenced by blueprints. Names only — values never leave the server."
      >
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
            className="max-w-xs font-mono"
          />
          <Input
            placeholder="value"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={!name || !value} loading={setSecret.isPending}>
            Save
          </Button>
        </form>
      </Section>

      <Section title="Stored secrets">
        {data?.secrets.length === 0 ? (
          <div className="text-sm text-(--text-muted)">No secrets stored yet.</div>
        ) : (
          <ul className="divide-y divide-(--border-subtle) rounded-md border border-(--border-subtle) bg-(--surface-1)">
            {data?.secrets.map((n) => (
              <li key={n} className="flex items-center justify-between px-3 py-2">
                <span className="font-mono text-sm">{n}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSecret.mutate(n)}
                  loading={removeSecret.isPending}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
