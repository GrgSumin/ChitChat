import { Loader2 } from "lucide-react";
import { Button } from "./button";

interface LoadingButtonProps extends React.ComponentProps<typeof Button> {
  loading: boolean;
}

export function LoadingButton({
  loading,
  disabled,
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      disabled={loading || disabled}
      className="flex items-center gap-2"
      {...props}
    >
      {loading && <Loader2 className="size-5 animate-spin" />}
      {props.children}
    </Button>
  );
}
