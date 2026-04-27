import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "../ui/button.tsx";
import { Field } from "../ui/form.tsx";
import { Input } from "../ui/input.tsx";
import { Select } from "../ui/select.tsx";

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  description?: string;
  title?: string;
  default?: unknown;
  examples?: unknown[];
}

interface JsonSchemaFormProps {
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Internal — current path for nested objects (e.g. "address.street"). */
  path?: string;
}

export function JsonSchemaForm({
  schema,
  value,
  onChange,
}: JsonSchemaFormProps): React.JSX.Element {
  if (!schema || typeof schema !== "object") {
    return <FallbackJsonEditor value={value} onChange={onChange} />;
  }

  const type = normalizeType(schema.type);

  if (type === "object") {
    return (
      <ObjectField schema={schema} value={value as Record<string, unknown>} onChange={onChange} />
    );
  }
  return <FallbackJsonEditor value={value} onChange={onChange} />;
}

function ObjectField({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown>) => void;
}): React.JSX.Element {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const v = value ?? {};

  const set = (key: string, next: unknown) => {
    const out = { ...v };
    if (next === undefined || next === "") delete out[key];
    else out[key] = next;
    onChange(out);
  };

  if (Object.keys(props).length === 0) {
    return (
      <FallbackJsonEditor value={v} onChange={(x) => onChange(x as Record<string, unknown>)} />
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(props).map(([key, sub]) => (
        <PropertyField
          key={key}
          name={key}
          schema={sub}
          required={required.has(key)}
          value={v[key]}
          onChange={(next) => set(key, next)}
        />
      ))}
    </div>
  );
}

function PropertyField({
  name,
  schema,
  required,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}): React.JSX.Element {
  const type = normalizeType(schema.type);
  const label = schema.title ?? name;

  if (schema.enum && schema.enum.length > 0) {
    return (
      <Field label={label} required={required} helper={schema.description}>
        <Select
          value={String(value ?? "")}
          onChange={(e) => onChange(coerce(e.target.value, type))}
        >
          <option value="">—</option>
          {schema.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (type === "boolean") {
    return (
      <Field label={label} required={required} helper={schema.description}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {schema.description ?? "Enabled"}
        </label>
      </Field>
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <Field label={label} required={required} helper={schema.description}>
        <Input
          type="number"
          step={type === "integer" ? 1 : "any"}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </Field>
    );
  }

  if (type === "array") {
    return (
      <Field label={label} required={required} helper={schema.description}>
        <ArrayField
          schema={schema}
          value={(value as unknown[] | undefined) ?? []}
          onChange={onChange}
        />
      </Field>
    );
  }

  if (type === "object") {
    return (
      <Field label={label} required={required} helper={schema.description}>
        <div className="rounded-md border bg-muted/20 p-3">
          <ObjectField
            schema={schema}
            value={value as Record<string, unknown> | undefined}
            onChange={(x) => onChange(x)}
          />
        </div>
      </Field>
    );
  }

  // Default to string
  return (
    <Field label={label} required={required} helper={schema.description}>
      <Input
        type="text"
        value={value === undefined || value === null ? "" : String(value)}
        placeholder={schema.examples?.[0] ? String(schema.examples[0]) : undefined}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
    </Field>
  );
}

function ArrayField({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: unknown[];
  onChange: (next: unknown[]) => void;
}): React.JSX.Element {
  const itemType = normalizeType(schema.items?.type);
  if (itemType === "object" || itemType === "array") {
    return <FallbackJsonEditor value={value} onChange={(x) => onChange(x as unknown[])} />;
  }
  return (
    <div className="space-y-2">
      {value.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={String(item ?? "")}
            onChange={(e) => {
              const next = [...value];
              next[i] = coerce(e.target.value, itemType);
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, itemType === "number" ? 0 : ""])}
      >
        <Plus className="size-4" /> Add
      </Button>
    </div>
  );
}

function FallbackJsonEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
}): React.JSX.Element {
  const [text, setText] = React.useState(() =>
    value === undefined ? "" : JSON.stringify(value, null, 2),
  );
  const [err, setErr] = React.useState<string | null>(null);

  const apply = (raw: string) => {
    setText(raw);
    if (!raw.trim()) {
      setErr(null);
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setErr(null);
      onChange(parsed);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="space-y-1">
      <textarea
        value={text}
        onChange={(e) => apply(e.target.value)}
        className="w-full min-h-[120px] rounded-md border border-input bg-background p-2 font-mono text-xs"
        placeholder="{}"
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function normalizeType(t: string | string[] | undefined): string {
  if (!t) return "string";
  if (Array.isArray(t)) return t.find((x) => x !== "null") ?? "string";
  return t;
}

function coerce(raw: string, type: string): unknown {
  if (raw === "") return undefined;
  if (type === "number" || type === "integer") return Number(raw);
  if (type === "boolean") return raw === "true";
  return raw;
}
