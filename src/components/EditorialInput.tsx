import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface EditorialInputProps {
  value: string;
  onChange: (nextValue: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function EditorialInput({
  value,
  onChange,
  onClear,
  disabled = false,
}: EditorialInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const syncHeight = () => {
      el.style.height = 'auto';
      el.style.height = `${Math.max(el.scrollHeight, 56)}px`;
    };

    syncHeight();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  const hasText = value.length > 0;

  return (
    <section aria-label="German practice text" className="relative">
      <div className="relative flex items-start gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={1}
          dir="ltr"
          lang="de"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          aria-label="German sentence input"
          placeholder="Schreib einen deutschen Satz..."
          className="w-full resize-none overflow-hidden bg-transparent pr-11 text-[25px] sm:text-[31px] font-normal leading-[1.42] tracking-[-0.018em] text-[#1A1918] placeholder:text-[#736F68]/50 focus:outline-none disabled:opacity-60 transition-opacity duration-200"
        />

        {hasText && !disabled && (
          <button
            type="button"
            onClick={() => {
              onClear();
              textareaRef.current?.focus();
            }}
            aria-label="Clear text"
            className="absolute top-0.5 right-0 flex h-10 w-10 items-center justify-center rounded-full text-[#736F68] transition-colors duration-150 ease-out hover:bg-[#F2EFE9] hover:text-[#1A1918] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1918]"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
