import * as React from "react";
import { Trash2 } from "lucide-react";

import type { Trigger } from "@oddjob/core";

import { useCronPreview } from "../../api/queries.ts";
import { Button } from "../ui/button.tsx";
import { Field } from "../ui/form.tsx";
import { Input } from "../ui/input.tsx";
import { Select } from "../ui/select.tsx";

interface TriggerRowProps {
  value: Trigger;
  onChange: (next: Trigger) => void;
  onRemove?: () => void;
}

export function TriggerRow({ value, onChange, onRemove }: TriggerRowProps): React.JSX.Element {
  return (
    <div className="rounded-md border bg-background p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Select
          className="w-32"
          value={value.type}
          onChange={(e) => onChange(blankTrigger(e.target.value as Trigger["type"]))}
        >
          <option value="manual">Manual</option>
          <option value="cron">Cron</option>
          <option value="webhook">Webhook</option>
        </Select>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="Remove trigger"
            className="ml-auto"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      {value.type === "cron" && <CronFields value={value} onChange={(t) => onChange(t)} />}
      {value.type === "webhook" && <WebhookFields value={value} onChange={(t) => onChange(t)} />}
      {value.type === "manual" && (
        <p className="text-xs text-muted-foreground">Trigger via the dashboard or CLI.</p>
      )}
    </div>
  );
}

function CronFields({
  value,
  onChange,
}: {
  value: Trigger & { type: "cron" };
  onChange: (next: Trigger) => void;
}): React.JSX.Element {
  const preview = useCronPreview();
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const runPreview = async () => {
    setPreviewError(null);
    try {
      await preview.mutateAsync({
        schedule: value.schedule,
        timezone: value.timezone,
        count: 5,
      });
    } catch (err) {
      setPreviewError((err as Error).message);
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Schedule" required helper="cron expression — e.g. '0 8 * * *'">
        <Input
          value={value.schedule}
          onChange={(e) => onChange({ ...value, schedule: e.target.value })}
          placeholder="0 8 * * *"
        />
      </Field>
      <Field label="Timezone" helper="IANA — e.g. 'Australia/Sydney'">
        <Input
          value={value.timezone ?? ""}
          onChange={(e) => onChange({ ...value, timezone: e.target.value || undefined })}
          placeholder="UTC"
        />
      </Field>
      <div className="sm:col-span-2 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runPreview}
          disabled={!value.schedule}
        >
          {preview.isPending ? "…" : "Preview next 5"}
        </Button>
        {preview.data && (
          <ul className="text-xs text-muted-foreground space-x-2">
            {preview.data.nextRuns.slice(0, 5).map((t) => (
              <li key={t} className="inline">
                {new Date(t).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
        {previewError && <span className="text-xs text-destructive">{previewError}</span>}
      </div>
    </div>
  );
}

function WebhookFields({
  value,
  onChange,
}: {
  value: Trigger & { type: "webhook" };
  onChange: (next: Trigger) => void;
}): React.JSX.Element {
  const authKind = value.auth.kind;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Path" helper="defaults to /webhooks/<deployment-name>">
        <Input
          value={value.path ?? ""}
          onChange={(e) => onChange({ ...value, path: e.target.value || undefined })}
          placeholder="/my-deployment"
        />
      </Field>
      <Field label="Auth">
        <Select
          value={authKind}
          onChange={(e) => {
            const t = e.target.value;
            if (t === "none") onChange({ ...value, auth: { kind: "none" } });
            else if (t === "bearer")
              onChange({ ...value, auth: { kind: "bearer", secretRef: "" } });
            else if (t === "hmac")
              onChange({
                ...value,
                auth: {
                  kind: "hmac",
                  algorithm: "sha256",
                  secretRef: "",
                  header: "x-hub-signature-256",
                },
              });
          }}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer</option>
          <option value="hmac">HMAC SHA-256</option>
        </Select>
      </Field>
      {authKind !== "none" && (
        <Field
          label="Secret name"
          required
          helper="name of the secret holding the token"
          className="sm:col-span-2"
        >
          <Input
            value={"secretRef" in value.auth ? value.auth.secretRef : ""}
            onChange={(e) => {
              if (authKind === "bearer") {
                onChange({ ...value, auth: { kind: "bearer", secretRef: e.target.value } });
              } else if (authKind === "hmac") {
                onChange({
                  ...value,
                  auth: {
                    kind: "hmac",
                    algorithm: "sha256",
                    secretRef: e.target.value,
                    header: value.auth.kind === "hmac" ? value.auth.header : "x-hub-signature-256",
                  },
                });
              }
            }}
          />
        </Field>
      )}
    </div>
  );
}

function blankTrigger(type: Trigger["type"]): Trigger {
  if (type === "cron") return { type: "cron", schedule: "0 * * * *" };
  if (type === "webhook") return { type: "webhook", auth: { kind: "none" } };
  if (type === "event") return { type: "event", source: "" };
  return { type: "manual" };
}
