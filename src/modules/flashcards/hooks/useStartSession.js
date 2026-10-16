import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { startSession } from "../lib/api";

// Starts a study session and jumps to it, or reports why it could not.
//
// Every entry point ("Study", "Focus session") uses this so the payload shape
// and the error handling live in one place. `notify` is the flash toast helper
// (useToast); a failure is a toast, not a thrown promise, so a click can never
// leave an unhandled rejection behind.
export default function useStartSession(notify) {
  const navigate = useNavigate();

  return useCallback(
    async (payload) => {
      try {
        const session = await startSession(payload);
        navigate(`/flash/study/${session.id}`);
        return session;
      } catch (err) {
        notify?.(err?.message ?? "Could not start a study session", "error");
        return null;
      }
    },
    [navigate, notify]
  );
}
