// Initials-style assistant avatar; hard-coded "A" since the only chat agent is the Platform Assistant.

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
