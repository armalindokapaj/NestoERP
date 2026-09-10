import { cn } from "@/lib/utils/cn";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("nesto-skeleton", className)} {...props} />;
}
