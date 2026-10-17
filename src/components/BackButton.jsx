import { useNavigate } from "react-router-dom";
import Icon from "./Icon";

export default function BackButton({ fallback = "/", label = "Back" }) {
  const navigate = useNavigate();

  function goBack() {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 transition-colors hover:text-ink"
    >
      <Icon name="arrow-left" size={16} />
      {label}
    </button>
  );
}
