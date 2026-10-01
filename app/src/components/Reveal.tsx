import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

/** Fades and lifts its content in the first time it scrolls into view. */
export function Reveal({ as: Tag = 'div', className = '', children, id }: { as?: ElementType; className?: string; children: ReactNode; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    // A plain position check rather than IntersectionObserver, which some embedded and background
    // contexts never fire, leaving the content invisible.
    const check = () => {
      const el = ref.current;
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.92) setShown(true);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [shown]);
  return (
    <Tag ref={ref} id={id} className={`reveal ${shown ? 'is-in' : ''} ${className}`}>
      {children}
    </Tag>
  );
}
