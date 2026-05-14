import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'grid' | 'ut';
}

export const Logo: React.FC<LogoProps> = ({ className = "w-8 h-8" }) => {
  return (
    <img
      src="/logo.png"
      alt="UniTime Logo"
      className={`${className} object-contain`}
    />
  );
};

export default Logo;
