import { EditorStateScreen } from "@/components/3d/platform/editor/EditorStateScreen";
import { Button } from "@/components/ui/button";
import { getEditorTranslations } from "@/lib/3d/platform/editor-text-server";

/** A missing Experience, answered inside the editor frame (3D Editor PRD §85, §223). */
export default async function ExperienceEditorNotFound() {
  const editorServerText = await getEditorTranslations();
  return (
    <EditorStateScreen
      code="404"
      title={editorServerText("This 3D Experience does not exist.")}
      actions={<Button asChild variant="secondary"><a href="/admin/3d">{editorServerText("Open 3D Experiences")}</a></Button>}
    >
      {editorServerText("It may never have been provisioned, or the address is wrong.")}
    </EditorStateScreen>
  );
}
