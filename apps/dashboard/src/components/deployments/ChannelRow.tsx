import * as React from "react";
import { Send, Trash2 } from "lucide-react";

import type { ChannelConfig } from "@oddjob/core";
import type { ChannelTypeDescriptor } from "@oddjob/api-client";

import { useTestChannel } from "../../api/queries.ts";
import { Button } from "../ui/button.tsx";
import { Field } from "../ui/form.tsx";
import { Input } from "../ui/input.tsx";
import { Select } from "../ui/select.tsx";
import { useToast } from "../ui/toast.tsx";

interface ChannelRowProps {
  value: ChannelConfig;
  onChange: (next: ChannelConfig) => void;
  onRemove?: () => void;
  types: ChannelTypeDescriptor[];
}

export function ChannelRow({
  value,
  onChange,
  onRemove,
  types,
}: ChannelRowProps): React.JSX.Element {
  const desc = types.find((t) => t.type === value.type);
  const test = useTestChannel();
  const toast = useToast();

  const onTest = async () => {
    try {
      await test.mutateAsync({ config: value });
      toast.push("success", `Test message sent via ${value.type}`);
    } catch (e) {
      toast.push("error", `Test failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="rounded-md border bg-background p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Select
          className="w-32"
          value={value.type}
          onChange={(e) => onChange(blankChannel(e.target.value))}
        >
          {types.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onTest}
          disabled={test.isPending}
        >
          <Send className="size-3.5" /> {test.isPending ? "Sending…" : "Test"}
        </Button>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={onRemove}
            aria-label="Remove channel"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      {desc && desc.fields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {desc.fields.map((f) => (
            <Field
              key={f.name}
              label={f.label}
              required={f.required}
              helper={f.helper}
              className={f.kind === "headers" ? "sm:col-span-2" : undefined}
            >
              <FieldInput
                kind={f.kind}
                value={(value as unknown as Record<string, unknown>)[f.name]}
                onChange={(next) =>
                  onChange({ ...value, [f.name]: next } as ChannelConfig)
                }
              />
            </Field>
          ))}
        </div>
      )}
      {desc && desc.fields.length === 0 && (
        <p className="text-xs text-muted-foreground">{desc.description}</p>
      )}
    </div>
  );
}

function FieldInput({
  kind,
  value,
  onChange,
}: {
  kind: string;
  value: unknown;
  onChange: (next: unknown) => void;
}): React.JSX.Element {
  if (kind === "headers") {
    const map = (value as Record<string, string> | undefined) ?? {};
    return (
      <textarea
        className="w-full min-h-[80px] rounded-md border bg-background p-2 font-mono text-xs"
        placeholder="Header-Name: value (one per line)"
        value={Object.entries(map)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")}
        onChange={(e) => {
          const out: Record<string, string> = {};
          for (const line of e.target.value.split("\n")) {
            const idx = line.indexOf(":");
            if (idx === -1) continue;
            const k = line.slice(0, idx).trim();
            const v = line.slice(idx + 1).trim();
            if (k) out[k] = v;
          }
          onChange(Object.keys(out).length ? out : undefined);
        }}
      />
    );
  }
  return (
    <Input
      value={value === undefined || value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
    />
  );
}

function blankChannel(type: string): ChannelConfig {
  if (type === "console") return { type: "console" };
  if (type === "slack") return { type: "slack", target: "" };
  if (type === "email") return { type: "email", to: "" };
  if (type === "webhook") return { type: "webhook", url: "" };
  return { type: "console" };
}
