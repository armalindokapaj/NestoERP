import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EntityActionSheet, type EntityAction } from "@/components/detail/entity-action-sheet";
import { FormSteps } from "@/components/forms/form-steps";
import { RelationSelector } from "@/components/forms/relation-selector";
import { UploadField, UploadProgress } from "@/components/forms/upload-field";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const el = React.createElement;

describe("RelationSelector (MOB-04 §31-§34)", () => {
  const options = [
    { value: "c1", label: "Eyes of Tirana" },
    { value: "c2", label: "Green Coast" },
  ];

  it("submits the chosen id through a hidden input and shows the chosen label on the trigger", () => {
    const out = html(el(RelationSelector, { name: "projectId", label: "Project", value: "c1", selected: options[0], options }));
    expect(out).toContain('type="hidden"');
    expect(out).toContain('name="projectId"');
    expect(out).toContain('value="c1"');
    expect(out).toContain("Eyes of Tirana");
    expect(out).toContain('aria-haspopup="dialog"');
  });

  it("shows the placeholder when nothing is chosen", () => {
    const out = html(el(RelationSelector, { name: "projectId", label: "Project", options, placeholder: "No client yet" }));
    expect(out).toContain("No client yet");
    expect(out).toContain('value=""');
  });

  it("takes part in native validation when required, and hands focus to the trigger", () => {
    const out = html(el(RelationSelector, { name: "projectId", label: "Project", options, required: true }));
    expect(out).toContain("required");
    expect(out).toContain('type="text"');
    expect(out).toContain("sr-only");
    expect(out).not.toContain('type="hidden"');
  });

  it("renders a context-fixed relation as text with no trigger to change it", () => {
    const out = html(el(RelationSelector, { name: "projectId", label: "Project", value: "c1", selected: options[0], options, locked: true }));
    expect(out).toContain("data-relation-locked");
    expect(out).toContain("Eyes of Tirana");
    expect(out).not.toContain("<button");
    expect(out).toContain('value="c1"');
  });
});

describe("FormSteps (MOB-04 §44-§46)", () => {
  const steps = [
    { id: "general", title: "General", content: el("input", { name: "a", required: true }) },
    { id: "financial", title: "Financial", content: el("input", { name: "b" }) },
    { id: "review", title: "Review", content: el("p", null, "check") },
  ];

  it("states the step compactly and keeps every step's fields in the form, hiding the inactive ones", () => {
    const out = html(el(FormSteps, { steps }));
    expect(out).toContain("Step 1 of 3 · General");
    expect(out).toContain('name="a"');
    expect(out).toContain('name="b"');
    expect(out).toMatch(/data-step="financial"[^>]*hidden|hidden=""[^>]*data-step="financial"/);
    expect(out).not.toMatch(/data-step="general"[^>]*hidden/);
  });

  it("starts on a requested step, and Back is disabled on the first", () => {
    expect(html(el(FormSteps, { steps, initial: 1 }))).toContain("Step 2 of 3 · Financial");
    const first = html(el(FormSteps, { steps }));
    expect(first).toMatch(/<button[^>]*disabled[^>]*>Back/);
  });

  it("offers Next until the last step, where the form's own submit belongs", () => {
    expect(html(el(FormSteps, { steps }))).toContain(">Next<");
    expect(html(el(FormSteps, { steps, initial: 2 }))).not.toContain(">Next<");
  });
});

describe("UploadField and UploadProgress (MOB-04 §40-§42)", () => {
  it("offers choose-file and take-photo, with a camera-capture input", () => {
    const out = html(el(UploadField, { name: "files" }));
    expect(out).toContain("Choose file");
    expect(out).toContain("Take photo");
    expect(out).toContain('capture="environment"');
    expect(out).toContain('name="files"');
  });

  it("can drop the camera action", () => {
    expect(html(el(UploadField, { name: "files", capture: false }))).not.toContain("Take photo");
  });

  it("shows percent and a progressbar while uploading, and retry/remove on failure", () => {
    const out = html(
      el(UploadProgress, {
        items: [
          { id: "1", fileName: "Facade.pdf", status: "uploading", progress: 68 },
          { id: "2", fileName: "Plan.dwg", status: "failed", error: "Too large" },
          { id: "3", fileName: "Done.png", status: "done" },
        ],
        onRetry: () => undefined,
        onRemove: () => undefined,
      }),
    );
    expect(out).toContain("Uploading 68%");
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="68"');
    expect(out).toContain("Upload failed");
    expect(out).toContain("Too large");
    expect(out).toContain(">Retry<");
    expect(out).toContain("Ready");
  });

  it("renders nothing for an empty queue", () => {
    expect(html(el(UploadProgress, { items: [] }))).toBe("");
  });
});

describe("EntityActionSheet (MOB-04 §11, §79)", () => {
  const actions: EntityAction[] = [
    { key: "delete", label: "Delete", destructive: true, onSelect: () => undefined },
    { key: "edit", label: "Edit", href: "/units/1/edit" },
    { key: "dup", label: "Duplicate", onSelect: () => undefined },
  ];

  it("renders nothing when there is no permitted action", () => {
    expect(html(el(EntityActionSheet, { name: "A-120", actions: [] }))).toBe("");
  });

  it("offers the sheet on a phone and the menu from md over one list", () => {
    const out = html(el(EntityActionSheet, { name: "A-120", actions }));
    expect(out).toContain('data-entity-actions="sheet"');
    expect(out).toContain('data-entity-actions="menu"');
    expect(out).toContain("md:hidden");
    expect(out).toContain("hidden md:block");
  });
});
