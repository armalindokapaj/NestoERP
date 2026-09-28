"use client";

import { EditorStateScreen } from "@/components/3d/platform/editor/EditorStateScreen";
import { Button } from "@/components/ui/button";

/**
 * The editor tab's error boundary (3D Editor PRD §156, §157, §160). A reload
 * is the honest way back: it re-authorizes and reads the saved draft again.
 * The reference ties the failure to the server log without echoing it.
 */
export default function ExperienceEditorError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EditorStateScreen
      code="Editor error"
      title="The 3D editor encountered an error."
      actions={<Button onClick={() => window.location.reload()}>Reload editor</Button>}
    >
      Changes saved before the error are kept. Reload to continue from the last saved draft.
      {error.digest ? <span className="mt-3 block font-mono text-[11px] text-neutral-600">Reference {error.digest}</span> : null}
    </EditorStateScreen>
  );
}
