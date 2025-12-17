// ==========================================================================
// BF Readup – Shared Helpers (used by Updates/Recent/Most widgets)
// - Provides BF.humanTimeAgo with locale-aware "just now"
// ==========================================================================

window.BF = window.BF || {};

(function () {
  // If already defined, do not overwrite (allow host apps to customize)
  if (!BF.humanTimeAgo) {
    BF.humanTimeAgo = function (iso) {
      if (!iso) return "—";

      const ts = Date.parse(iso);
      if (isNaN(ts)) return "—";

      const diffSec = Math.floor((Date.now() - ts) / 1000);

      // Use i18n "just now" if available
      if (diffSec < 60) {
        const jn = (window.BF_READUP_I18N && BF_READUP_I18N.just_now) || "just now";
        return jn;
      }

      const min = Math.floor(diffSec / 60);
      if (min < 60) return `${min} min`;

      const h = Math.floor(min / 60);
      if (h < 24) return `${h} h`;

      const d = Math.floor(h / 24);
      return `${d} d`;
    };
  }
})();
