import { memo } from "react";

interface ClaudetteBrandLogoProps {
  size?: "xs" | "small" | "medium" | "large";
  className?: string;
  showIcon?: boolean;
}

const sizeMap = {
  xs: { width: 80, height: 20, fontSize: 14, iconSize: 16 },
  small: { width: 120, height: 28, fontSize: 18, iconSize: 22 },
  medium: { width: 160, height: 36, fontSize: 24, iconSize: 28 },
  large: { width: 220, height: 48, fontSize: 32, iconSize: 38 },
};

// Geometric "C" icon inspired by the Grep blocky "G" style
const ClaudetteIcon = memo(({ size = 28, className = "" }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Outer blocky C shape */}
    <path
      d="M20 10H80V25H35V75H80V90H20V10Z"
      fill="currentColor"
    />
    {/* Inner cutout for the C */}
    <path
      d="M35 25H65V40H50V60H65V75H35V25Z"
      fill="var(--claude-bg, #1a1a2e)"
    />
    {/* Accent bar */}
    <rect x="65" y="40" width="15" height="20" fill="currentColor" opacity="0.6" />
  </svg>
));

ClaudetteIcon.displayName = "ClaudetteIcon";

export const ClaudetteBrandLogo = memo(({
  size = "medium",
  className = "",
  showIcon = true
}: ClaudetteBrandLogoProps) => {
  const dimensions = sizeMap[size];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {showIcon && (
        <ClaudetteIcon size={dimensions.iconSize} className="text-claude-accent" />
      )}
      <span
        className="font-mono font-bold tracking-wider text-current"
        style={{
          fontSize: dimensions.fontSize,
          letterSpacing: '0.15em'
        }}
      >
        CLAUDETTE
      </span>
    </div>
  );
});

ClaudetteBrandLogo.displayName = "ClaudetteBrandLogo";

// Export the icon separately for use in compact spaces
export { ClaudetteIcon };
export default ClaudetteBrandLogo;
