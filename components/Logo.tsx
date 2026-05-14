import React from 'react';

interface LogoProps {
  className?: string;
  full?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ className = "w-8 h-8", full = false }) => {
  return (
    <img
      src={full ? "/logo-full.svg" : "/mascot.svg"}
      alt="UniTime Logo"
      className={`${className} object-contain`}
    />
  );
};

export default Logo;
