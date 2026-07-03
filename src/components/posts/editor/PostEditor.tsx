"use client";

import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

import { useSession } from "@/app/(main)/SessionProvider";
import UserAvatar from "@/components/ui/UserAvatar";
import { LoadingButton } from "@/components/ui/loadingButton";
import useSubmitPostMutation from "./mutation";
import UseMediaUpload, { Attachment } from "./useMediaUpload";
import { Button } from "@/components/ui/button";
import { ImageIcon, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";

export default function PostEditor() {
  const { user } = useSession();
  const mutation = useSubmitPostMutation();
  const {
    startUpload,
    attachments,
    isUploading,
    uploadProgress,
    removeAttachment,
    reset: resetMediaUpload,
  } = UseMediaUpload();

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
    mutation.mutate(
      {
        content: input,
        mediaIds: attachments.map((a) => a.mediaId).filter(Boolean) as string[],
      },
      {
        onSuccess: () => {
          editor?.commands.clearContent();
          resetMediaUpload();
        },
      },
    );
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
      {!!attachments.length && (
        <AttachmentPreviews
          attachment={attachments}
          removeAttachment={removeAttachment}
        />
      )}
      <div className="flex justify-end gap-3">
        {isUploading && (
          <>
            <span className="text-sm">{uploadProgress ?? 0} %</span>
            <Loader2 className="text-primary size-5 animate-spin" />
          </>
        )}
        <AddAttachmentsButton
          onFileSelected={startUpload}
          disabled={isUploading || attachments.length >= 6}
        />
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

interface AddAttachmentButtonProps {
  onFileSelected: (files: File[]) => void;
  disabled: boolean;
}

function AddAttachmentsButton({
  onFileSelected,
  disabled,
}: AddAttachmentButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="hover:text-primary"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        <ImageIcon size={20} />
      </Button>
      <input
        type="file"
        accept="image/*, video/*"
        multiple
        ref={fileInputRef}
        className="sr-only hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) {
            onFileSelected(files);
            e.target.value = "";
          }
        }}
      ></input>
    </>
  );
}

interface AttachmentPreviewsProps {
  attachment: Attachment[];
  removeAttachment: (filename: string) => void;
}

function AttachmentPreviews({
  attachment,
  removeAttachment,
}: AttachmentPreviewsProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        attachment.length > 1 && "sm-grid sm:grid-cols-2",
      )}
    >
      {attachment.map((attachment) => (
        <AttachmentPreview
          key={attachment.file.name}
          attachment={attachment}
          onRemoveClick={() => removeAttachment(attachment.file.name)}
        />
      ))}
    </div>
  );
}

interface AttachmentPreviewProps {
  attachment: Attachment;
  onRemoveClick: () => void;
}

function AttachmentPreview({
  attachment: { file, isUploading, mediaId },
  onRemoveClick,
}: AttachmentPreviewProps) {
  const src = URL.createObjectURL(file);

  return (
    <div
      className={cn("relative mx-auto size-fit", isUploading && "opacity-50")}
    >
      {file.type.startsWith("image") ? (
        <Image
          src={src}
          alt="Attachment preview"
          width={500}
          height={500}
          className="max-h-[30rem size-fit"
          rounded-2xl
        />
      ) : (
        <video controls className="max-h[30rem] size-fit rounded-2xl">
          <source src={src} type={file.type} />
        </video>
      )}
      {!isUploading && (
        <button
          onClick={onRemoveClick}
          className="bg-foreground text-background absolute top-3 right-3 rounded-full p-1.5 hover:bg-foreground/60 transition-colors"
        >
          <X size={20} />
        </button>
      )}
    </div>
  );
}
