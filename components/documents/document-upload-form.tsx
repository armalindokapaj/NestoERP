"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  useFieldErrors,
  type SelectOption,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentActionResult } from "@/lib/actions/documents";
import { formatFileSize } from "@/lib/modules/documents/document.files";

/**
 * Upload form (PRD #13 §86–§91, §98, §181).
 *
 * The context is locked when the form is opened from a project or a client, so
 * a person filing from inside a record cannot accidentally file somewhere else
 * — and the server re-validates it regardless (PRD #13 §89, §91).
 */
export function DocumentUploadForm({
  projects,
  clients,
  canFileToCompany,
  lockedContext,
  maxMegabytes,
  cancelHref,
  action,
}: {
  projects: SelectOption[];
  clients: SelectOption[];
  canFileToCompany: boolean;
  /** Fixed parent when opened from a record page (PRD #13 §89, §90). */
  lockedContext?: { kind: "project" | "client"; id: string; label: string };
  maxMegabytes: number;
  cancelHref: string;
  action: (formData: FormData) => Promise<DocumentActionResult>;
}) {
  const [context, setContext] = React.useState<string>(
    lockedContext?.kind ?? (projects.length > 0 ? "project" : canFileToCompany ? "company" : "client"),
  );
  const [file, setFile] = React.useState<File | null>(null);

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel="Upload document"
      pendingLabel="Uploading…"
    >
      <FormSection title="File">
        <div className="sm:col-span-2">
          <Field
            label="File"
            name="file"
            required
            hint={`Up to ${maxMegabytes} MB. Executable, script and macro-enabled files are not accepted.`}
          >
            <FileInput
              onSelect={(selected) => setFile(selected)}
              maxMegabytes={maxMegabytes}
            />
          </Field>
        </div>

        {file ? (
          <p className="sm:col-span-2 text-meta text-fg-muted">
            {file.name} · {formatFileSize(file.size)}
          </p>
        ) : null}

        <div className="sm:col-span-2">
          <Field
            label="Document name"
            name="name"
            required
            hint="What people will look for. Defaults to the file name."
          >
            <NameInput fileName={file?.name ?? null} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Description" name="description">
            <Textarea id="description" name="description" rows={3} maxLength={2000} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Where it belongs">
        {lockedContext ? (
          <>
            <input type="hidden" name="context" value={lockedContext.kind} />
            <input
              type="hidden"
              name={lockedContext.kind === "project" ? "projectId" : "clientId"}
              value={lockedContext.id}
            />
            <div className="sm:col-span-2">
              <Field label="Context" name="context">
                <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-body text-fg">
                  {lockedContext.label}
                </p>
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Context" name="context" required>
              <select
                id="context"
                name="context"
                value={context}
                onChange={(event) => setContext(event.target.value)}
                className={selectClass}
              >
                {projects.length > 0 ? <option value="project">Project</option> : null}
                {clients.length > 0 ? <option value="client">Client</option> : null}
                {canFileToCompany ? <option value="company">Company</option> : null}
              </select>
            </Field>

            {context === "project" ? (
              <Field label="Project" name="projectId" required>
                <select id="projectId" name="projectId" className={selectClass}>
                  {projects.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {context === "client" ? (
              <Field label="Client" name="clientId" required>
                <select id="clientId" name="clientId" className={selectClass}>
                  {clients.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {context === "company" ? (
              <p className="sm:col-span-2 text-meta text-fg-subtle">
                A company document is visible to colleagues with company-level Documents access.
              </p>
            ) : null}
          </>
        )}
      </FormSection>
    </RecordForm>
  );
}

/**
 * The document name defaults to the file name without its extension, which is
 * almost always what somebody would have typed anyway (PRD #13 §24).
 */
function NameInput({ fileName }: { fileName: string | null }) {
  const errors = useFieldErrors();
  const [value, setValue] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (touched || !fileName) return;
    setValue(fileName.replace(/\.[^.]+$/, ""));
  }, [fileName, touched]);

  return (
    <Input
      id="name"
      name="name"
      required
      maxLength={200}
      value={value}
      onChange={(event) => {
        setTouched(true);
        setValue(event.target.value);
      }}
      aria-invalid={Boolean(errors.name)}
      aria-describedby={errors.name ? "name-error" : undefined}
    />
  );
}

function FileInput({
  onSelect,
  maxMegabytes,
}: {
  onSelect: (file: File | null) => void;
  maxMegabytes: number;
}) {
  const [tooLarge, setTooLarge] = React.useState(false);

  return (
    <>
      <input
        id="file"
        name="file"
        type="file"
        required
        onChange={(event) => {
          const selected = event.target.files?.[0] ?? null;
          // A courtesy check so somebody is not made to wait for an upload the
          // server will refuse; the server checks again regardless.
          setTooLarge(Boolean(selected && selected.size > maxMegabytes * 1024 * 1024));
          onSelect(selected);
        }}
        className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-fg file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-table file:font-medium file:text-fg"
      />
      {tooLarge ? (
        <p role="alert" className="mt-1.5 text-meta text-danger-strong">
          That file is larger than {maxMegabytes} MB.
        </p>
      ) : null}
    </>
  );
}
