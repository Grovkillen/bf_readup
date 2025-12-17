document.addEventListener("DOMContentLoaded", () => {

  // ============================
  // CONFIG: Allowed keys/methods + defaults
  // ============================
  const ALLOWED_KEYS = [
    { value: "assigned_to_me", label: "Assigned to me" },
    { value: "author",         label: "I am author" },
    { value: "watcher",        label: "I am watcher" },
    { value: "mentioned",      label: "Mentions me" },
    { value: "overdue",        label: "Overdue" },
    { value: "behind_schedule",label: "Behind schedule" }
  ];
  const ALLOWED_METHODS = [
    { value: "role",   label: "Role based" },
    { value: "state",  label: "State based" },
    { value: "content",label: "Content based" },
    { value: "cf_match", label: "Custom Field Matcher" }
  ];

  const DEFAULT_RULES = [
    { icon: "⭐", label: "Assigned to me",   key: "assigned_to_me", method: "role",   active: "on" },
    { icon: "✍", label: "I am author",      key: "author",         method: "role",   active: "on" },
    { icon: "👁", label: "I am watcher",     key: "watcher",        method: "role",   active: "on" },
    { icon: "@", label: "Mentions me",       key: "mentioned",      method: "content",active: "on" },
    { icon: "⏰", label: "Overdue",          key: "overdue",        method: "state",  active: "on" },
    { icon: "📉", label: "Behind schedule",  key: "behind_schedule", method: "state",  active: "off" }
  ];

  // ============================
  // PRIORITY RULES
  // ============================

  const prTable = document.querySelector("#prio-rules-table tbody");
  const prAddBtn = document.querySelector("#add-prio-rule");
  const prLoadDefaultsBtn = document.querySelector("#load-default-prio");
  const prJson = document.querySelector("#prio-rules-json");

  function addOption(select, value, text) {
    const opt = document.createElement("option");
    opt.value = value; opt.textContent = text;
    select.appendChild(opt);
  }

  function updateKeyVisibility(tr) {
    const selMethod = tr.querySelector("select.pr-method");
    const selKey = tr.querySelector("select.pr-key");
    const inputKey = tr.querySelector("input.pr-key-custom");

    if (selMethod.value === "cf_match") {
      selKey.style.display = "none";
      inputKey.style.display = "inline-block";
    } else {
      selKey.style.display = "inline-block";
      inputKey.style.display = "none";
    }
  }

  function populateSelects(tr) {
    const selKey = tr.querySelector("select.pr-key");
    const selMethod = tr.querySelector("select.pr-method");
    const inputKey = tr.querySelector("input.pr-key-custom");

    const keyInit = tr.querySelector(".pr-key-initial")?.value;
    const methodInit = tr.querySelector(".pr-method-initial")?.value;

    if (selKey && selKey.options.length === 0) {
      ALLOWED_KEYS.forEach(k => addOption(selKey, k.value, k.label));
    }
    if (selMethod && selMethod.options.length === 0) {
      ALLOWED_METHODS.forEach(m => addOption(selMethod, m.value, m.label));
    }

    if (methodInit) selMethod.value = methodInit;

    if (selMethod.value === "cf_match") {
      if (keyInit) inputKey.value = keyInit;
    } else {
      if (keyInit) selKey.value = keyInit;
    }

    updateKeyVisibility(tr);
  }

  function updateRanks() {
    if (!prTable) return;
    [...prTable.querySelectorAll("tr")].forEach((tr, idx) => {
      const rankDisplay = tr.querySelector(".pr-rank-display");
      if (rankDisplay) rankDisplay.textContent = String(idx + 1);
    });
  }

  function makeRow(rule) {
    const tr = document.createElement("tr");
    tr.setAttribute("draggable", "true");
    tr.innerHTML = `
      <td class="pr-rank-display"></td>
      <td><input type="text" class="pr-icon" value="${rule?.icon || ''}" size="3"></td>
      <td><input type="text" class="pr-label" value="${rule?.label || ''}"></td>
      <td>
        <select class="pr-key"></select>
        <input type="text" class="pr-key-custom" value="" style="display:none;" placeholder="custom_key">
        <input type="hidden" class="pr-key-initial" value="${rule?.key || ''}">
      </td>
      <td>
        <select class="pr-method"></select>
        <input type="hidden" class="pr-method-initial" value="${rule?.method || ''}">
      </td>
      <td><input type="checkbox" class="pr-active" ${rule?.active === 'on' ? 'checked' : ''}></td>
      <td><button type="button" class="icon icon-del pr-del"></button></td>
    `;
    populateSelects(tr);

    tr.querySelector("select.pr-method").addEventListener("change", () => updateKeyVisibility(tr));

    return tr;
  }

  function addRule(rule) {
    const tr = makeRow(rule);
    prTable.appendChild(tr);
    updateRanks();
  }

  prAddBtn?.addEventListener("click", () => addRule({ active: "on" }));

  prLoadDefaultsBtn?.addEventListener("click", () => {
    prTable.innerHTML = "";
    DEFAULT_RULES.forEach(r => addRule(r));
  });

  prTable?.addEventListener("click", (e) => {
    if (e.target.classList.contains("pr-del")) {
      e.target.closest("tr").remove();
      updateRanks();
    }
  });

  // Drag & drop ordering
  let dragEl = null;
  prTable?.addEventListener("dragstart", (e) => {
    const tr = e.target.closest("tr");
    dragEl = tr;
    e.dataTransfer.effectAllowed = "move";
  });
  prTable?.addEventListener("dragover", (e) => {
    e.preventDefault();
    const tr = e.target.closest("tr");
    if (!tr || tr === dragEl) return;
    const rect = tr.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    tr.parentNode.insertBefore(dragEl, before ? tr : tr.nextSibling);
  });
  prTable?.addEventListener("drop", (e) => {
    e.preventDefault();
    updateRanks();
  });

  // Initialize existing rows (populate selects and ranks)
  [...prTable.querySelectorAll("tr")].forEach(tr => populateSelects(tr));
  updateRanks();

  // ============================
  // CF RULES
  // ============================

  const cfTable = document.querySelector("#cf-rules-table tbody");
  const cfAddBtn = document.querySelector("#add-cf-rule");
  const cfJson = document.querySelector("#cf-rules-json");

  cfAddBtn?.addEventListener("click", () => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type=\"number\" class=\"cf-id\"></td>
      <td><input type=\"text\"   class=\"cf-match\"></td>
      <td><input type=\"text\"   class=\"cf-priority\"></td>
      <td><button type=\"button\" class=\"icon icon-del cf-del\"></button></td>
    `;
    cfTable.appendChild(row);
  });

  cfTable?.addEventListener("click", (e) => {
    if (e.target.classList.contains("cf-del")) {
      e.target.closest("tr").remove();
    }
  });

  // ============================
  // SERIALIZE ON FORM SUBMIT
  // ============================

  const form = document.querySelector("#settings form");
  form?.addEventListener("submit", (e) => {

    // Priority rules → JSON
    const pr = [...prTable.querySelectorAll("tr")].map((tr, idx) => {
      const method = tr.querySelector(".pr-method").value;
      const key = (method === "cf_match") 
        ? tr.querySelector(".pr-key-custom").value 
        : tr.querySelector(".pr-key").value;

      return {
        rank:   idx + 1,
        icon:   tr.querySelector(".pr-icon").value,
        label:  tr.querySelector(".pr-label").value,
        key:    key,
        method: method,
        active: tr.querySelector(".pr-active").checked ? "on" : "off"
      };
    });

    // Uniqueness validation
    const usedMethods = new Set();
    const usedCfKeys = new Set();
    let error = null;

    pr.forEach(rule => {
      if (rule.method !== "cf_match") {
        if (usedMethods.has(rule.method + ":" + rule.key)) {
          error = `Duplicate priority method: ${rule.method} (${rule.key})`;
        }
        usedMethods.add(rule.method + ":" + rule.key);
      } else {
        if (!rule.key) {
          error = "CF Matcher requires a key";
        }
        if (usedCfKeys.has(rule.key)) {
          error = `Duplicate CF key: ${rule.key}`;
        }
        usedCfKeys.add(rule.key);
      }
    });

    if (error) {
      alert(error);
      e.preventDefault();
      return;
    }

    prJson.value = JSON.stringify(pr);

    // CF rules → JSON
    const cf = [...(cfTable?.querySelectorAll("tr") || [])].map(tr => ({
      id:           tr.querySelector(".cf-id").value,
      match:        tr.querySelector(".cf-match").value,
      priority_key: tr.querySelector(".cf-priority").value
    }));

    cfJson.value = JSON.stringify(cf);
  });

});
