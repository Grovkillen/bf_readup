document.addEventListener("DOMContentLoaded", () => {

  // ============================
  // PRIORITY RULES
  // ============================

  const prTable = document.querySelector("#prio-rules-table tbody");
  const prAddBtn = document.querySelector("#add-prio-rule");
  const prJson = document.querySelector("#prio-rules-json");

  prAddBtn?.addEventListener("click", () => {
    const idx = prTable.children.length;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="number" class="pr-rank" value="${idx + 1}"></td>
      <td><input type="text"   class="pr-icon"></td>
      <td><input type="text"   class="pr-label"></td>
      <td><input type="text"   class="pr-key"></td>
      <td><input type="text"   class="pr-method"></td>
      <td><input type="checkbox" class="pr-active"></td>
      <td><button type="button" class="icon icon-del pr-del"></button></td>
    `;
    prTable.appendChild(row);
  });

  prTable?.addEventListener("click", (e) => {
    if (e.target.classList.contains("pr-del")) {
      e.target.closest("tr").remove();
    }
  });

  // ============================
  // CF RULES
  // ============================

  const cfTable = document.querySelector("#cf-rules-table tbody");
  const cfAddBtn = document.querySelector("#add-cf-rule");
  const cfJson = document.querySelector("#cf-rules-json");

  cfAddBtn?.addEventListener("click", () => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="number" class="cf-id"></td>
      <td><input type="text"   class="cf-match"></td>
      <td><input type="text"   class="cf-priority"></td>
      <td><button type="button" class="icon icon-del cf-del"></button></td>
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

  const form = document.querySelector("form[action*='bf_readup']");
  form?.addEventListener("submit", () => {

    // Priority rules → JSON
    const pr = [...prTable.querySelectorAll("tr")].map(tr => ({
      rank:   tr.querySelector(".pr-rank").value,
      icon:   tr.querySelector(".pr-icon").value,
      label:  tr.querySelector(".pr-label").value,
      key:    tr.querySelector(".pr-key").value,
      method: tr.querySelector(".pr-method").value,
      active: tr.querySelector(".pr-active").checked ? "on" : "off"
    }));

    prJson.value = JSON.stringify(pr);

    // CF rules → JSON
    const cf = [...cfTable.querySelectorAll("tr")].map(tr => ({
      id:           tr.querySelector(".cf-id").value,
      match:        tr.querySelector(".cf-match").value,
      priority_key: tr.querySelector(".cf-priority").value
    }));

    cfJson.value = JSON.stringify(cf);
  });

});
