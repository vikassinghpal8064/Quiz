// Shared framer-motion variants and form classes for the flash modals, so the
// dialogs animate and space identically without copy-pasting the same objects
// into every file. Mirrors the constants used by the existing quiz modals.
export const overlay = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const panel = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 10 },
};

export const fieldClass = "field mt-1 block w-full px-3 py-2.5 text-sm shadow-sm";
export const labelClass = "block text-sm font-medium text-ink/70";
