import { EditorClient } from "@/components/editor/editor-client";

export const metadata = { title: "Editor" };

export default async function DocumentPage({ params }) {
  const { id } = await params;
  return <EditorClient documentId={id} />;
}
