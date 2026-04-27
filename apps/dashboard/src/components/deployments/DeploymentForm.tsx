import * as React from "react";
import { Plus } from "lucide-react";

import type {
  Blueprint,
  ChannelConfig,
  DeploymentInput,
  Limits,
  Trigger,
} from "@oddjob/core";

import {
  useBlueprints,
  useChannelTypes,
  useModels,
} from "../../api/queries.ts";
import { Button } from "../ui/button.tsx";
import { Combobox } from "../ui/combobox.tsx";
import { Field, Fieldset } from "../ui/form.tsx";
import { Input } from "../ui/input.tsx";
import { JsonSchemaForm } from "../forms/json-schema-form.tsx";
import { ChannelRow } from "./ChannelRow.tsx";
import { TriggerRow } from "./TriggerRow.tsx";

export interface DeploymentFormState {
  blueprintId: string;
  name: string;
  modelOverride: string;
  triggers: Trigger[];
  channels: ChannelConfig[];
  limits: Partial<Limits>;
  defaultInput: unknown;
}

export function emptyFormState(): DeploymentFormState {
  return {
    blueprintId: "",
    name: "",
    modelOverride: "",
    triggers: [{ type: "manual" }],
    channels: [{ type: "console" }],
    limits: { warnThresholdPct: 80 },
    defaultInput: undefined,
  };
}

interface Props {
  state: DeploymentFormState;
  onChange: (next: DeploymentFormState) => void;
  /** When set, locks the blueprint + name controls (edit mode). */
  lockIdentity?: boolean;
}

export function DeploymentForm({ state, onChange, lockIdentity }: Props): React.JSX.Element {
  const blueprints = useBlueprints();
  const models = useModels();
  const channelTypes = useChannelTypes();

  const bp = blueprints.data?.blueprints.find((b) => b.id === state.blueprintId);

  const set = <K extends keyof DeploymentFormState>(key: K, value: DeploymentFormState[K]) =>
    onChange({ ...state, [key]: value });

  return (
    <div className="space-y-6">
      <Fieldset legend="Identity">
        <Field
          label="Blueprint"
          required
          helper="Pushed blueprints (oddjob push) appear here."
        >
          <Combobox
            value={state.blueprintId}
            onChange={(v) => set("blueprintId", v)}
            options={(blueprints.data?.blueprints ?? []).map((b: Blueprint) => ({
              value: b.id,
              label: b.id,
              hint: b.version,
            }))}
            placeholder="Pick a blueprint"
            className={lockIdentity ? "opacity-60 pointer-events-none" : undefined}
          />
        </Field>
        <Field label="Name" required helper="Unique. Used in webhook paths.">
          <Input
            value={state.name}
            onChange={(e) => set("name", e.target.value.replace(/[^a-z0-9-]/gi, "-"))}
            placeholder="my-deployment"
            disabled={lockIdentity}
          />
        </Field>
      </Fieldset>

      <Fieldset legend="Runtime">
        <Field
          label="Model"
          helper={`Defaults to blueprint's "${bp?.model ?? "—"}". Override for this deployment.`}
        >
          <Combobox
            value={state.modelOverride}
            onChange={(v) => set("modelOverride", v)}
            options={(models.data?.models ?? []).map((m) => ({
              value: m.id,
              label: m.id,
              hint: m.available ? "available" : "secret missing",
              disabled: !m.available,
            }))}
            allowCustom
            placeholder={bp?.model ?? "Pick a model"}
          />
        </Field>
        <Field label="Budget (USD)" helper="Soft warning when exceeded. Leave blank for no cap.">
          <Input
            type="number"
            step="0.01"
            value={state.limits.budgetUsd ?? ""}
            onChange={(e) =>
              set("limits", {
                ...state.limits,
                budgetUsd: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            placeholder="0.50"
          />
        </Field>
        <details className="rounded-md border bg-muted/20 p-3 text-sm">
          <summary className="cursor-pointer text-sm font-medium">Other limits</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Duration (ms)" helper="max wall-clock per run">
              <Input
                type="number"
                value={state.limits.durationMs ?? ""}
                onChange={(e) =>
                  set("limits", {
                    ...state.limits,
                    durationMs: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                placeholder="300000"
              />
            </Field>
            <Field label="Tool calls" helper="max tool invocations per run">
              <Input
                type="number"
                value={state.limits.toolCalls ?? ""}
                onChange={(e) =>
                  set("limits", {
                    ...state.limits,
                    toolCalls: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                placeholder="50"
              />
            </Field>
            <Field label="Warn threshold %" helper="soft-warn at this fraction of any limit">
              <Input
                type="number"
                value={state.limits.warnThresholdPct ?? ""}
                onChange={(e) =>
                  set("limits", {
                    ...state.limits,
                    warnThresholdPct: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                placeholder="80"
              />
            </Field>
          </div>
        </details>
      </Fieldset>

      <Fieldset legend="Default input">
        {bp?.inputSchema?.schema ? (
          <JsonSchemaForm
            schema={bp.inputSchema.schema as never}
            value={state.defaultInput}
            onChange={(v) => set("defaultInput", v)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {bp
              ? "Blueprint defines no input schema — leave blank or paste JSON."
              : "Pick a blueprint above to see its input fields."}
          </p>
        )}
      </Fieldset>

      <Fieldset legend="Triggers">
        <div className="space-y-2">
          {state.triggers.map((t, i) => (
            <TriggerRow
              key={i}
              value={t}
              onChange={(next) =>
                set(
                  "triggers",
                  state.triggers.map((x, idx) => (idx === i ? next : x)),
                )
              }
              onRemove={
                state.triggers.length > 1
                  ? () => set("triggers", state.triggers.filter((_, idx) => idx !== i))
                  : undefined
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set("triggers", [...state.triggers, { type: "manual" }])}
          >
            <Plus className="size-4" /> Add trigger
          </Button>
        </div>
      </Fieldset>

      <Fieldset legend="Channels">
        <div className="space-y-2">
          {state.channels.map((c, i) => (
            <ChannelRow
              key={i}
              value={c}
              types={channelTypes.data?.types ?? []}
              onChange={(next) =>
                set(
                  "channels",
                  state.channels.map((x, idx) => (idx === i ? next : x)),
                )
              }
              onRemove={() =>
                set("channels", state.channels.filter((_, idx) => idx !== i))
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set("channels", [...state.channels, { type: "console" }])}
          >
            <Plus className="size-4" /> Add channel
          </Button>
        </div>
      </Fieldset>
    </div>
  );
}

export function formStateToInput(s: DeploymentFormState): DeploymentInput {
  return {
    name: s.name,
    blueprintId: s.blueprintId as `${string}/${string}`,
    triggers: s.triggers,
    channels: s.channels,
    limits: s.limits,
    modelOverride: s.modelOverride || undefined,
    defaultInput: s.defaultInput,
  };
}
