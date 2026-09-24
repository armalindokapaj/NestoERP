/**
 * Cross-tab notice that an Experience Editor tab saved its draft (3D Editor
 * PRD §143-§148).
 *
 * The editor opens in its own browser tab, so the Experience's management tab
 * and any other editor tab on the same Experience are left showing an older
 * revision. A message names the Experience and the revision it reached, never
 * the scene: a listener reads again under its own session, and a listener in
 * the tab that sent the message ignores it.
 *
 * Client-safe: no server imports.
 */

export const EXPERIENCE_EDITOR_CHANNEL = "nesto-3d-experience-editor";

export type ExperienceEditorSaved = {
  v: 1;
  type: "EXPERIENCE_EDITOR_SAVED";
  /** The tab that saved, so it does not answer its own message. */
  source: string;
  projectId: string;
  revision: number;
};

const TAB_ID = typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function publishExperienceEditorSaved(projectId: string, revision: number): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(EXPERIENCE_EDITOR_CHANNEL);
  channel.postMessage({ v: 1, type: "EXPERIENCE_EDITOR_SAVED", source: TAB_ID, projectId, revision } satisfies ExperienceEditorSaved);
  channel.close();
}

/** Saves of this Experience made in other tabs, with the revision each reached. */
export function subscribeExperienceEditorSaved(projectId: string, listener: (revision: number) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(EXPERIENCE_EDITOR_CHANNEL);
  channel.onmessage = (event: MessageEvent<Partial<ExperienceEditorSaved>>) => {
    const message = event.data;
    if (message?.type !== "EXPERIENCE_EDITOR_SAVED" || message.source === TAB_ID || message.projectId !== projectId) return;
    if (typeof message.revision !== "number") return;
    listener(message.revision);
  };
  return () => channel.close();
}
