// ===========================================================================
// BF READUP – Most Read Global Widget (projects I'm in)
// Collapsed (10) → Expanded (pagination, 25/page)
// Server-side MAX_RESULTS = 200 respekteras
// ===========================================================================

window.BF = window.BF || {};

(function () {

  const PREFIX = "bf-readup-most-global";
  const LS_LAST_LOAD_KEY = "bf_readup_most_global_last_load";
  const LS_CACHE_KEY     = "bf_readup_most_global_cache";

  // -------------------------------------------------------------------------
  // STATE
  // -------------------------------------------------------------------------
  BF.mostGlobal = BF.mostGlobal || {};
  BF.mostGlobal.__bound = BF.mostGlobal.__bound || false;
  BF.mostGlobal.rows = [];

  BF.mostGlobal.UI = {
    COLLAPSED_LIMIT: 10,
    PER_PAGE: 25
  };

  BF.mostGlobal.state = {
    expanded: false,
    page: 1
  };

  // -------------------------------------------------------------------------
  // APP ROOT (samma metodik som updates)
  // -------------------------------------------------------------------------
  const BF_APP_ROOT = (() => {
    const path = window.location.pathname || "/";
    const parts = path.split("/").filter(Boolean);
    return parts.length > 0 ? `/${parts[0]}/` : "/";
  })();

  // -------------------------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------------------------
  if (!BF.humanTimeAgo) {
    BF.humanTimeAgo = function (iso) {
      if (!iso) return "—";

      const ts = Date.parse(iso);
      if (isNaN(ts)) return "—";

      const diffSec = Math.floor((Date.now() - ts) / 1000);

      const locales = BF.locales || {};
      if (diffSec < 60) return locales.common?.just_now || "just now";

      const min = Math.floor(diffSec / 60);
      if (min < 60) return `${min} ${locales.units?.minute || "min"}`;

      const h = Math.floor(min / 60);
      if (h < 24) return `${h} ${locales.units?.hour || "h"}`;

      const d = Math.floor(h / 24);
      return `${d} ${locales.units?.day || "d"}`;
    };
  }

  function t(key, fallback) {
    // Om vi har BF.t, använd den. Annars fallback.
    if (typeof BF.t === "function") return BF.t(key, fallback);
    return fallback;
  }

  function formatDuration(seconds) {
    const s = Math.max(0, parseInt(seconds || 0, 10) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }

  function loadCachedData() {
    try {
      const raw = localStorage.getItem(LS_CACHE_KEY);
      if (!raw) return null;
      const json = JSON.parse(raw);
      if (!json || !Array.isArray(json.rows)) return null;
      return json;
    } catch (e) {
      return null;
    }
  }

  function saveCachedData(rows) {
    try {
      localStorage.setItem(LS_CACHE_KEY, JSON.stringify({ rows }));
    } catch (e) {}
  }

  function updateEmptyState() {
    const emptyEl = document.getElementById(`${PREFIX}-empty`);
    const tableEl = document.getElementById(`${PREFIX}-table`);
    const footer  = document.querySelector(`.${PREFIX}-footer`);
    if (!emptyEl) return;

    const hasRows = BF.mostGlobal.rows.length > 0;

    if (tableEl) tableEl.style.display = hasRows ? "" : "none";
    if (footer)  footer.classList.toggle("is-visible", hasRows);

    emptyEl.style.display = hasRows ? "none" : "block";
  }

  function getTotalRows() {
    return BF.mostGlobal.rows.length;
  }

  function getTotalPages() {
    if (!BF.mostGlobal.state.expanded) return 1;
    return Math.max(1, Math.ceil(getTotalRows() / BF.mostGlobal.UI.PER_PAGE));
  }

  function ensurePageInRange() {
    const pages = getTotalPages();
    if (BF.mostGlobal.state.page < 1) BF.mostGlobal.state.page = 1;
    if (BF.mostGlobal.state.page > pages) BF.mostGlobal.state.page = pages;
  }

  function getVisibleRows() {
    const rows = BF.mostGlobal.rows;

    if (!BF.mostGlobal.state.expanded) {
      return rows.slice(0, BF.mostGlobal.UI.COLLAPSED_LIMIT);
    }

    ensurePageInRange();

    const start = (BF.mostGlobal.state.page - 1) * BF.mostGlobal.UI.PER_PAGE;
    const end   = start + BF.mostGlobal.UI.PER_PAGE;
    return rows.slice(start, end);
  }

	function scrollHeaderIntoView() {
		const h = document.querySelector(`h3.${PREFIX}-header`);
		if (!h) return;
		h.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}

  function updateHeaderCount() {
    const el = document.getElementById(`${PREFIX}-total-count`);
    if (el) el.textContent = String(getTotalRows());
  }

	function getRowClasses(row, index) {
		const classes = [
			"issue",
			index % 2 === 0 ? "odd" : "even"
		];

		if (row.tracker_id)  classes.push(`tracker-${row.tracker_id}`);
		if (row.status_id)   classes.push(`status-${row.status_id}`);
		if (row.priority_id) classes.push(`priority-${row.priority_id}`);
		if (row.is_closed)   classes.push("closed");

		return classes.join(" ");
	}

  function renderCell(row, key) {
    const issueId = row.issue_id ?? row.id; // ifall vi återanvänder samma format senare
    const subject = row.subject || "";
    const projectId = row.project_id;
    const projectName = row.project_name || "";
    const totalSeconds = row.total_seconds || 0;
    const readersCount = row.readers_count || 0;

    if (key === "id") {
      return `<td class="id"><a href="${BF_APP_ROOT}issues/${issueId}">${issueId}</a></td>`;
    }

    if (key === "subject") {
      return `<td class="subject"><a href="${BF_APP_ROOT}issues/${issueId}">${subject}</a></td>`;
    }

    if (key === "project") {
      // Tooltip: visa projektets hierarki (parents » project)
      // Kräver att backend skickar row.project_parents = [{name: "..."}...]
      // (precis som i "most"-widgeten).
      const parents = Array.isArray(row.project_parents) ? row.project_parents : [];

      // Projektets "visningsnamn" i slutet av stigen.
      // Vi tar row.project om den finns (som i andra widgeten), annars projectName.
      const leafName = row.project || projectName || "";

      const title = parents.length
        ? [...parents.map(p => p?.name).filter(Boolean), leafName].join(" » ")
        : "";

      // Länk: föredra /projects/:identifier/issues om vi har identifier.
      // Annars fall back till det vi hade innan.
      if (row.project_identifier) {
        return `
          <td class="project" title="${escapeHtml(title)}">
            <a href="${BF_APP_ROOT}projects/${encodeURIComponent(row.project_identifier)}/issues">
              ${escapeHtml(leafName)}
            </a>
          </td>
        `;
      }

      if (projectId) {
        // Behåll befintligt beteende, men med tooltip.
        return `
          <td class="project" title="${escapeHtml(title)}">
            <a href="${BF_APP_ROOT}projects/${projectId}">
              ${escapeHtml(leafName)}
            </a>
          </td>
        `;
      }

      return `<td class="project" title="${escapeHtml(title)}">${escapeHtml(leafName)}</td>`;
    }

    if (key === "total_seconds") {
      return `<td class="time_spent">${formatDuration(totalSeconds)}</td>`;
    }

    if (key === "readers_count") {
			return `
				<td class="readers_count">
					<span class="bf-readup-readers-count"
								data-issue-id="${issueId}">
						${parseInt(readersCount, 10) || 0}
					</span>
				</td>
			`;
    }

    if (key === "last_viewed_at") {
      const iso  = row.last_viewed_at;
      const text = iso ? BF.humanTimeAgo(iso) : "—";
      const title = iso ? new Date(iso).toLocaleString() : "";
      return `<td class="last_viewed" title="${title}">${text}</td>`;
    }

    return `<td class="${key}">${row[key] ?? ""}</td>`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatLocalDateTime(iso) {
    if (!iso) return "";
    const ts = Date.parse(iso);
    if (isNaN(ts)) return "";
    return new Date(ts).toLocaleString();
  }
	
  // -------------------------------------------------------------------------
  // RENDER TOOLTIP
  // -------------------------------------------------------------------------
	
	let readersTipEl = null;

  function ensureReadersTooltip() {
    if (readersTipEl) return readersTipEl;

    const el = document.createElement("div");
    el.id = "bf-readup-readers-tooltip";
    el.style.position = "fixed";
    el.style.zIndex = "99999";
    el.style.display = "none";
    el.style.maxWidth = "360px";
    el.style.pointerEvents = "none";
    el.style.padding = "8px 10px";
    el.style.border = "1px solid rgba(0,0,0,0.25)";
    el.style.borderRadius = "6px";
    el.style.background = "#fff";
    el.style.boxShadow = "0 2px 10px rgba(0,0,0,0.2)";
    el.style.fontSize = "12px";
    el.style.lineHeight = "1.3";

    document.body.appendChild(el);
    readersTipEl = el;
    return el;
  }

	function hideReadersTooltip() {
		if (!readersTipEl) return;
		readersTipEl.style.display = "none";
		readersTipEl.innerHTML = "";
		delete readersTipEl.dataset.issueId;
	}

  function moveReadersTooltip(e) {
    if (!readersTipEl || readersTipEl.style.display === "none") return;

    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;

    // håll tooltip inom viewport
    const rect = readersTipEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (x + rect.width + 8 > vw) x = Math.max(8, vw - rect.width - 8);
    if (y + rect.height + 8 > vh) y = Math.max(8, vh - rect.height - 8);

    readersTipEl.style.left = `${x}px`;
    readersTipEl.style.top = `${y}px`;
  }

	function buildReadersTooltipHtml(row) {
		const readers = Array.isArray(row.readers) ? row.readers.slice() : [];
		if (!readers.length) {
			return `<div class="bf-readup-tip-title"><strong>${escapeHtml(t("bf_readup.common.empty", "No data"))}</strong></div>`;
		}

		readers.sort((a, b) =>
			(parseInt(b.total_seconds || 0, 10) || 0) - (parseInt(a.total_seconds || 0, 10) || 0)
		);

		const lines = readers.map(r => {
			const name = escapeHtml(r.user_name || "");
			const dur  = escapeHtml(formatDuration(r.total_seconds));
			const iso  = r.last_viewed_at;
			const ago  = iso ? escapeHtml(BF.humanTimeAgo(iso)) : "—";
			const full = iso ? escapeHtml(formatLocalDateTime(iso)) : "";

			return `
				<div class="bf-readup-tip-row">
					<span class="bf-readup-tip-name">${name}</span>
					<span class="bf-readup-tip-dur">${dur}</span>
				</div>
				<div class="bf-readup-tip-sub">
					<span>${ago}</span>
					${full ? `<span style="margin-left:6px;">(${full})</span>` : ""}
				</div>
			`;
		}).join("");

		return `
			<div class="bf-readup-tip-title">
				${escapeHtml(t("bf_readup.columns.readers_count", "Readers"))}
			</div>
			${lines}
		`;
	}
	
  // -------------------------------------------------------------------------
  // RENDER TABLE
  // -------------------------------------------------------------------------
  function renderTable() {
    const tbody = document.getElementById(`${PREFIX}-tbody`);
    const thead = document.getElementById(`${PREFIX}-thead`);

    if (thead) {
      thead.innerHTML = `
        <tr>
          <th class="id">#</th>
          <th class="subject">${t("bf_readup.columns.issue", "Issue")}</th>
          <th class="project">${t("bf_readup.columns.project", "Project")}</th>
          <th class="readers_count">${t("bf_readup.columns.readers_count", "Readers")}</th>
          <th class="time_spent">${t("bf_readup.columns.time_spent_total", "Total time")}</th>
          <th class="last_viewed">${t("bf_readup.columns.last_viewed", "Last viewed")}</th>
        </tr>
      `;
    }

    if (!tbody) return;

    const rows = getVisibleRows();

    const baseIndex = BF.mostGlobal.state.expanded
      ? (BF.mostGlobal.state.page - 1) * BF.mostGlobal.UI.PER_PAGE
      : 0;

    tbody.innerHTML = rows.map((row, i) => `
      <tr id="issue-${row.issue_id}" class="${getRowClasses(row, baseIndex + i)}">
        ${renderCell(row, "id")}
        ${renderCell(row, "subject")}
        ${renderCell(row, "project")}
        ${renderCell(row, "readers_count")}
        ${renderCell(row, "total_seconds")}
        ${renderCell(row, "last_viewed_at")}
      </tr>
    `).join("");

    renderFooter();
    updateHeaderCount();
    updateEmptyState();

    window.dispatchEvent(new CustomEvent("bf-readup-rendered"));
  }

  // -------------------------------------------------------------------------
  // FOOTER: EXPAND + PAGINATION
  // -------------------------------------------------------------------------
	function renderFooter() {
		const footer     = document.querySelector(`.${PREFIX}-footer`);
		const expandBtn  = document.getElementById(`${PREFIX}-expand`);
		const pagination = document.getElementById(`${PREFIX}-pagination`);
		if (!footer || !expandBtn || !pagination) return;

		const total = getTotalRows();

		footer.classList.toggle(
			"is-visible",
			total > BF.mostGlobal.UI.COLLAPSED_LIMIT
		);

		expandBtn.style.display =
			total > BF.mostGlobal.UI.COLLAPSED_LIMIT ? "" : "none";

		expandBtn.setAttribute(
			"aria-expanded",
			BF.mostGlobal.state.expanded ? "true" : "false"
		);

		const label = expandBtn.querySelector(".label");
		const icon  = expandBtn.querySelector(".icon");

		const labelText = BF.mostGlobal.state.expanded
			? t("bf_readup.common.show_less", "Show less")
			: t("bf_readup.common.show_more", "Show more");

		if (label) label.textContent = labelText;
		expandBtn.title = labelText;
		expandBtn.setAttribute("aria-label", labelText);

		if (icon) {
			icon.classList.toggle("icon-zoom-in", !BF.mostGlobal.state.expanded);
			icon.classList.toggle("icon-zoom-out", BF.mostGlobal.state.expanded);
		}

		if (!BF.mostGlobal.state.expanded || total <= BF.mostGlobal.UI.PER_PAGE) {
			pagination.innerHTML = "";
			pagination.style.display = "none";
			return;
		}

		pagination.style.display = "";

		ensurePageInRange();

		const page  = BF.mostGlobal.state.page;
		const pages = getTotalPages();
		const startItem = (page - 1) * BF.mostGlobal.UI.PER_PAGE + 1;
		const endItem   = Math.min(page * BF.mostGlobal.UI.PER_PAGE, total);

		const prevLabel = t("bf_readup.common.previous_label", "« Previous");
		const nextLabel = t("bf_readup.common.next_label", "Next »");

		let html = `
			<span class="pagination">
				<ul class="pages">
					<li class="previous ${page === 1 ? "" : "page"}">
						${
							page === 1
								? `<span>${prevLabel}</span>`
								: `<a href="#" class="bf-most-global-page-link" data-page="${page - 1}">${prevLabel}</a>`
						}
					</li>
		`;

		for (let p = 1; p <= pages; p++) {
			html += p === page
				? `<li class="current"><span>${p}</span></li>`
				: `<li class="page"><a href="#" class="bf-most-global-page-link" data-page="${p}">${p}</a></li>`;
		}

		html += `
					<li class="next ${page === pages ? "" : "page"}">
						${
							page === pages
								? `<span>${nextLabel}</span>`
								: `<a href="#" class="bf-most-global-page-link" data-page="${page + 1}">${nextLabel}</a>`
						}
					</li>
				</ul>
				<span class="items">(${startItem}-${endItem}/${total})</span>
			</span>
		`;

		pagination.innerHTML = html;
	}

  // -------------------------------------------------------------------------
  // LOAD DATA
  // -------------------------------------------------------------------------
  function load(done) {
    fetch(`${BF_APP_ROOT}bf_readup/most_read_global`, {
      credentials: "same-origin"
    })
      .then(r => r.json())
      .then(json => {
        if (!json || !json.rows) return;

        BF.mostGlobal.rows = json.rows;
        BF.mostGlobal.state.page = 1;

        localStorage.setItem(LS_LAST_LOAD_KEY, Date.now().toString());
        saveCachedData(json.rows);
        renderTable();
      })
      .finally(() => {
        if (typeof done === "function") done();
      });
  }

  // -------------------------------------------------------------------------
  // EVENTS
  // -------------------------------------------------------------------------
  function bindEvents() {
    if (BF.mostGlobal.__bound) return;
    BF.mostGlobal.__bound = true;

    // Sync
    document.addEventListener("click", function (e) {
      const btn = e.target.closest(`.${PREFIX}-sync`);
      if (!btn) return;

      e.preventDefault();
      if (btn.classList.contains("is-loading")) return;

      btn.classList.add("is-loading");
      load(() => btn.classList.remove("is-loading"));
    });

    // Expand / collapse
    document.addEventListener("click", function (e) {
      const btn = e.target.closest(`#${PREFIX}-expand`);
      if (!btn) return;

      e.preventDefault();

      BF.mostGlobal.state.expanded = !BF.mostGlobal.state.expanded;
      BF.mostGlobal.state.page = 1;

      renderTable();
      scrollHeaderIntoView();
    });

    // Pagination
    document.addEventListener("click", function (e) {
      const link = e.target.closest("a.bf-most-global-page-link[data-page]");
      if (!link) return;

      e.preventDefault();

      const next = parseInt(link.dataset.page, 10);
      if (!next || isNaN(next)) return;

      BF.mostGlobal.state.page = next;
      renderTable();
      scrollHeaderIntoView();
    });
		
		// Hover tooltip for readers list (event delegation)
    document.addEventListener("mousemove", function (e) {
      const target = e.target.closest(".bf-readup-readers-count");
      if (!target) {
        // om vi inte hovrar på count längre, göm
        hideReadersTooltip();
        return;
      }

      const issueId = parseInt(target.dataset.issueId || "0", 10);
      if (!issueId) return;

      const row = BF.mostGlobal.rows.find(r => (r.issue_id ?? r.id) === issueId);
      if (!row) return;

      const tip = ensureReadersTooltip();

      // Om tooltip redan visar samma issue, bara flytta den
      if (tip.dataset.issueId !== String(issueId)) {
        tip.dataset.issueId = String(issueId);
        tip.innerHTML = buildReadersTooltipHtml(row);
        tip.style.display = "block";
      } else if (tip.style.display !== "block") {
        tip.style.display = "block";
      }

      moveReadersTooltip(e);
    });

    // Extra safety: hide on scroll / leaving window
    window.addEventListener("scroll", hideReadersTooltip, true);
    window.addEventListener("blur", hideReadersTooltip);
  }

  // -------------------------------------------------------------------------
  // BOOTSTRAP (Turbo-safe)
  // -------------------------------------------------------------------------
  function boot() {
    bindEvents();

    const cached = loadCachedData();
    if (cached && cached.rows && cached.rows.length) {
      BF.mostGlobal.rows = cached.rows;
      renderTable();
      updateEmptyState();
    }

    load();
  }

  document.addEventListener("DOMContentLoaded", boot);
  document.addEventListener("turbo:load", boot);
  document.addEventListener("turbo:render", boot);
  document.addEventListener("turbo:frame-load", boot);

})();