import { useCallback, useState } from "react";

// Toast state for the flash screens. Matches the pattern AdminUpload uses
// (add, then auto-dismiss after ~3.5s) but factored out so every flash page
// does not re-implement it. The Toast component itself is the shared one.
export default function useToast(ttl = 3500) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (message, type = "success") => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
    },
    [ttl]
  );

  return { toasts, notify, dismiss };
}
