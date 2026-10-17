import { Link } from "react-router-dom";
import Icon from "../../../components/Icon";

// Breadcrumb trail for the flash screens: Flash Cards > Folder > Category.
// Pass an array of { label, to } items; the last item is the current page and
// renders as plain text (no link). An item without `to` also renders as text.
export default function FlashBreadcrumbs({ items = [] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && (
              <Icon name="chevron-right" size={14} className="text-ink/30" />
            )}
            {last || !item.to ? (
              <span className="font-medium text-ink/80" aria-current={last ? "page" : undefined}>
                {item.label}
              </span>
            ) : (
              <Link
                to={item.to}
                className="font-medium text-ink/50 transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
