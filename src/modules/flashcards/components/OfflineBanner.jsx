import { useEffect, useState } from "react";
import { pendingReviewCount, subscribeReviewQueue } from "../lib/api";
import Icon from "../../../components/Icon";

// A slim status strip shown anywhere in the flash module when the browser is
// offline. It also reports how many answers are waiting in the local review
// queue, so "offline" never looks like "my work was lost".
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [queued, setQueued] = useState(() => pendingReviewCount());

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const unsubscribe = subscribeReviewQueue(setQueued);
    setQueued(pendingReviewCount());
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      unsubscribe?.();
    };
  }, []);

  if (online && queued === 0) return null;

  return (
    <div
      role="status"
      className="sticky top-14 z-40 mx-auto mb-2 flex w-fit items-center gap-2 rounded-full border border-line bg-elevated/95 px-3.5 py-1.5 text-xs font-semibold text-ink/80 backdrop-blur"
    >
      <span className={online ? "text-sage" : "text-butter"}>
        <Icon name={online ? "rotate-cw" : "zap"} size={14} />
      </span>
      {online
        ? `Syncing ${queued} queued answer${queued === 1 ? "" : "s"}…`
        : `Offline${queued ? ` · ${queued} answer${queued === 1 ? "" : "s"} saved locally` : ""}`}
    </div>
  );
}
