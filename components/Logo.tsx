import React from 'react';

interface LogoProps {
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ className = "w-8 h-8" }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="3"   y="3"   width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.35" />
      <rect x="9.5" y="3"   width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.35" />
      <rect x="16"  y="3"   width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.35" />
      <rect x="3"   y="9.5" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.35" />
      <rect x="16"  y="9.5" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.35" />
      <rect x="3"   y="16"  width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.35" />
      <rect x="9.5" y="16"  width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.35" />
      <rect x="16"  y="16"  width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.35" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.5" fill="currentColor" className="animate-pulse" />
      <circle cx="12" cy="12" r="1" fill="white" fillOpacity="0.5" />
    </svg>
  );
};

export default Logo;
