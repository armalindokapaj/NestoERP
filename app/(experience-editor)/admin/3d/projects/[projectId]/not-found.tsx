import { EditorStateScreen } from "@/components/3d/platform/editor/EditorStateScreen";
import { Button } from "@/components/ui/button";

/** A missing Experience, answered inside the editor frame (3D Editor PRD §85, §223). */
export default function ExperienceEditorNotFound() {
  return (
    <EditorStateScreen
      code="404"
      title="This 3D Experience does not exist."
      actions={<Button asChild variant="secondary"><a href="/admin/3d">Open 3D Experiences</a></Button>}
    >
      It may never have been provisioned, or the address is wrong.
    </EditorStateScreen>
  );
}
