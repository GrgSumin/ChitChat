import { useUploadThing } from "@/lib/uploadthing";
import { useState } from "react";
import { toast } from "sonner";

export interface Attachment {
  file: File;
  mediaId?: string;
  isUploading: boolean;
}

export default function UseMediaUpload() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [uploadProgress, setUploadProgress] = useState<number>();

  const { startUpload, isUploading } = useUploadThing("attachments", {
    onBeforeUploadBegin(files) {
      const renamedFIle = files.map((file) => {
        const extension = file.name.split(".").pop();
        return new File(
          [file],
          `attachment_${crypto.randomUUID()}.${extension}`,
          {
            type: file.type,
          },
        );
      });
      setAttachments((prev) => [
        ...prev,
        ...renamedFIle.map((file) => ({ file, isUploading: true })),
      ]);
      return renamedFIle;
    },
    onUploadProgress: setUploadProgress,
    onClientUploadComplete(res) {
      setAttachments((prev) =>
        prev.map((a) => {
          const uploadResult = res.find((r) => r.name === a.file.name);

          if (!uploadResult) return a;
          return {
            ...a,
            mediaId: uploadResult.serverData.mediaId,
            isUploading: false,
          };
        }),
      );
    },
    onUploadError(e) {
      setAttachments((prev) => prev.filter((a) => !a.isUploading));
      toast("Error", {
        description: e.message,
      });
    },
  });

  function handleStartUpload(files: File[]) {
    if (isUploading) {
      toast("Error", {
        description: "Please wait for current upload to dinish",
      });
      return;
    }
    if (attachments.length + files.length > 5) {
      toast("Warning", {
        description: "You can only upload up to 5 attacthment per post",
      });
    }
    startUpload(files);
  }
  function removeAttachment(fileName: string) {
    setAttachments((prev) => prev.filter((a) => a.file.name !== fileName));
  }
  function reset() {
    setAttachments([]);
    setUploadProgress(undefined);
  }
  return {
    startUpload: handleStartUpload,
    attachments,
    isUploading,
    uploadProgress,
    removeAttachment,
    reset,
  };
}
