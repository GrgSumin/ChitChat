"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

import { useSession } from "@/app/(main)/SessionProvider";
import UserAvatar from "@/components/ui/UserAvatar";
import { LoadingButton } from "@/components/ui/loadingButton";
import useSubmitPostMutation from "./mutation";

export default function PostEditor() {
  const { user } = useSession();
  const mutation = useSubmitPostMutation();

  const [hasContent, setHasContent] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        bold: false,
        italic: false,
      }),
      Placeholder.configure({
        placeholder: "What's on your mind?",
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "tiptap min-h-[80px] w-full focus:outline-none text-sm text-foreground",
      },
    },
    onUpdate({ editor }) {
      setHasContent(editor.getText().trim().length > 0);
    },
  });

  function onSubmit() {
    const input = editor?.getText({ blockSeparator: "\n" })?.trim() || "";
    if (!input) return;
    mutation.mutate(input, {
      onSuccess: () => {
        editor?.commands.clearContent();
      },
    });
  }

  return (
    <div className="bg-card border-border flex flex-col gap-3 rounded-2xl border p-5 shadow-sm">
      <div className="flex gap-4">
        <UserAvatar
          avatarUrl={user.avatarUrl}
          size={40}
          className="hidden sm:flex"
        />
        <EditorContent
          editor={editor}
          className="bg-muted/40 border-border max-h-[20rem] w-full overflow-y-auto rounded-xl border px-4 py-3"
        />
      </div>
      <div className="flex justify-end">
        <LoadingButton
          loading={mutation.isPending}
          disabled={!hasContent}
          onClick={onSubmit}
          className="bg-primary text-primary-foreground hover:bg-primary/90 min-w-24 rounded-xl px-5 text-sm font-semibold"
        >
          Post
        </LoadingButton>
      </div>
    </div>
  );
}
