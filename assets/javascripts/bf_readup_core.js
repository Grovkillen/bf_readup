window.BF = window.BF || {};

if (!BF.locales && window.BF_READUP_I18N) {
  BF.locales = window.BF_READUP_I18N;
}

if (!BF.t) {
  BF.t = function (key, fallback = "") {
    const root = BF.locales;
    if (!root) return fallback;

    const fullKey = key.includes(".") ? key : `common.${key}`;
    const parts = fullKey.split(".");
    let cur = root;

    for (let i = 0; i < parts.length; i++) {
      if (cur == null) return fallback;
      cur = cur[parts[i]];
    }

    return cur == null ? fallback : cur;
  };
}
