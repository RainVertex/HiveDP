const MARK_PATH =
  "M24.00 2.00 L43.05 13.00 L43.05 35.00 L24.00 46.00 L4.95 35.00 L4.95 13.00 Z " +
  "M14.80 14.00 L21.00 14.00 L21.00 21.00 L27.00 21.00 L27.00 14.00 L33.20 14.00 " +
  "L33.20 34.00 L27.00 34.00 L27.00 27.00 L21.00 27.00 L21.00 34.00 L14.80 34.00 Z";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="HiveDP"
      fill="currentColor"
    >
      <path fillRule="evenodd" clipRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}

interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <BrandMark className="h-7 w-7 text-app-text" />
      <span className="text-xl font-bold tracking-tight leading-none">
        <span className="text-app-text">Hive</span>
        <span className="text-app-primary">DP</span>
      </span>
    </span>
  );
}
