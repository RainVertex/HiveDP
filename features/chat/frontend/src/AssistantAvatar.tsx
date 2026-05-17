// Mirrors ProfileAvatar's initials-style fallback so the user and assistant
// avatars look balanced side-by-side. Hard-coded "A" since there's no
// per-agent avatar story yet — the only agent in the chat surface is the
// Platform Assistant.

const sizeClasses = {
  sm: "h-7 w-7 text-xs",
  md: "h-10 w-10 text-sm",
};

interface Props {
  size?: keyof typeof sizeClasses;
}

export function AssistantAvatar({ size = "sm" }: Props) {
  return (
    <span
      className={`flex items-center justify-center rounded-full bg-app-primary text-white font-semibold ${sizeClasses[size]}`}
      aria-label="Assistant"
    >
      A
    </span>
  );
}
