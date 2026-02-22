window.BF = window.BF || {};

if (!BF.locales && window.BF_READUP_I18N) {
  BF.locales = window.BF_READUP_I18N;
}

if (!BF.t) {
  BF.t = function (key, fallback = "") {
    const root = BF.locales;
    if (!root) return fallback;

    let k = String(key || "");

    // Tillåt både "bf_readup.columns.issue" och "columns.issue"
    if (k.startsWith("bf_readup.")) k = k.slice("bf_readup.".length);

    const fullKey = k.includes(".") ? k : `common.${k}`;
    const parts = fullKey.split(".");
    let cur = root;

    for (let i = 0; i < parts.length; i++) {
      if (cur == null) return fallback;
      cur = cur[parts[i]];
    }

    return cur == null ? fallback : cur;
  };
}