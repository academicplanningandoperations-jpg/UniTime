import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'grid' | 'ut';
}

export const Logo: React.FC<LogoProps> = ({ className = "w-8 h-8", variant = 'grid' }) => {
  if (variant === 'grid') {
    return (
      <svg 
        viewBox="0 0 24 24" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg" 
        className={className}
      >
        {/* Background Grid */}
        <rect x="3" y="3" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" />
        <rect x="9.5" y="3" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" />
        <rect x="16" y="3" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" />
        
        <rect x="3" y="9.5" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" />
        <rect x="16" y="9.5" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" />
        
        <rect x="3" y="16" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" />
        <rect x="9.5" y="16" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" />
        <rect x="16" y="16" width="5" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" />
        
        {/* The "Perfectly Placed" Session */}
        <rect 
          x="9.5" 
          y="9.5" 
          width="5" 
          height="5" 
          rx="1.5" 
          fill="currentColor" 
          className="animate-pulse"
        />
        
        {/* Accents */}
        <circle cx="12" cy="12" r="1" fill="white" fillOpacity="0.5" />
      </svg>
    );
  }

  // Interlocking UT Variant
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
    >
      {/* The 'U' shape */}
      <path 
        d="M5 4V13C5 16.866 8.13401 20 12 20C15.866 20 19 16.866 19 13V4" 
        stroke="currentColor" 
        strokeWidth="2.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      {/* The 'T' shape interlocking */}
      <path 
        d="M8 7H16" 
        stroke="currentColor" 
        strokeWidth="2.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path 
        d="M12 7V16" 
        stroke="currentColor" 
        strokeWidth="2.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      {/* Connection Point */}
      <circle cx="12" cy="7" r="1.5" fill="currentColor" />
    </svg>
  );
};

export default Logo;
