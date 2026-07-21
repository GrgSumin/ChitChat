"use client";

export default function TypingBubble() {
  return (
    <div className="flex w-full justify-start gap-2">
      <div className="bg-muted flex items-center gap-1 rounded-2xl rounded-bl-sm px-4 py-3">
        <span className="bg-muted-foreground/60 size-2 animate-bounce rounded-full [animation-delay:-0.3s]" />
        <span className="bg-muted-foreground/60 size-2 animate-bounce rounded-full [animation-delay:-0.15s]" />
        <span className="bg-muted-foreground/60 size-2 animate-bounce rounded-full" />
      </div>
    </div>
  );
}
