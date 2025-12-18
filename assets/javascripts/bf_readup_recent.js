// ===========================================================================
// BF READUP – Recent Read Widget
// Collapsed (10) → Expanded (pagination, 40/page)
// Server-side MAX_RESULTS = 200 respekteras
// ===========================================================================

window.BF = window.BF || {};

(function () {

  const PREFIX = "bf-readup-recent";
	const LS_LAST_LOAD_KEY = "bf_readup_recent_last_load";
	const LS_CACHE_KEY = "bf_readup_recent_cache";

  // -------------------------------------------------------------------------
  // STATE
  // -------------------------------------------------------------------------
	BF.recent = BF.recent || {};
	BF.recent.__bound = BF.recent.__bound || false;
  BF.recent.rows = [];

  BF.recent.UI = {
    COLLAPSED_LIMIT: 10,
    PER_PAGE: 25
  };

  BF.recent.state = {
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

            if (diffSec < 60) return BF.t("just_now", "—");

            const min = Math.floor(diffSec / 60);
            if (min < 60) return `${min} ${BF.t("units.minute", "min")}`;

            const h = Math.floor(min / 60);
            if (h < 24) return `${h} ${BF.t("units.hour", "h")}`;

            const d = Math.floor(h / 24);
            return `${d} ${BF.t("units.day", "d")}`;
        };
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
			localStorage.setItem(
				LS_CACHE_KEY,
				JSON.stringify({ rows })
			);
		} catch (e) {}
	}

	function getLastLoadTs() {
		const raw = localStorage.getItem(LS_LAST_LOAD_KEY);
		if (!raw) return null;

		const ts = parseInt(raw, 10);
		return isNaN(ts) ? null : ts;
	}

	function shouldAutoRefresh(maxAgeSeconds) {
		const last = getLastLoadTs();
		if (!last) return true;

		const ageSeconds = (Date.now() - last) / 1000;
		return ageSeconds > maxAgeSeconds;
	}

	function updateEmptyState() {
		const emptyEl = document.getElementById(`${PREFIX}-empty`);
		const tableEl = document.getElementById(`${PREFIX}-table`);
		const footer  = document.querySelector(`.${PREFIX}-footer`);
		if (!emptyEl) return;

		const hasRows = BF.recent.rows.length > 0;

		if (tableEl) tableEl.style.display = hasRows ? "" : "none";
		if (footer)  footer.style.display  = hasRows ? "" : "none";
		emptyEl.style.display = hasRows ? "none" : "block";
	}

  function getTotalRows() {
    return BF.recent.rows.length;
  }

	function getTotalPages() {
		if (!BF.recent.state.expanded) return 1;
		return Math.max(1, Math.ceil(getTotalRows() / BF.recent.UI.PER_PAGE));
	}

  function ensurePageInRange() {
    const pages = getTotalPages();
    if (BF.recent.state.page < 1) BF.recent.state.page = 1;
    if (BF.recent.state.page > pages) BF.recent.state.page = pages;
  }

  function getVisibleRows() {
    const rows = BF.recent.rows;

    if (!BF.recent.state.expanded) {
      return rows.slice(0, BF.recent.UI.COLLAPSED_LIMIT);
    }

    ensurePageInRange();

    const start = (BF.recent.state.page - 1) * BF.recent.UI.PER_PAGE;
    const end   = start + BF.recent.UI.PER_PAGE;
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
    return [
      "issue",
      index % 2 === 0 ? "odd" : "even",
      row.is_closed ? "closed" : "",
      row.overdue ? "overdue" : "",
      row.behind_schedule ? "behind-schedule" : "",
      row.created_by_me ? "created-by-me" : "",
      row.assigned_to_me ? "assigned-to-me" : "",
      row.tracker_id ? `tracker-${row.tracker_id}` : "",
      row.status_id ? `status-${row.status_id}` : "",
      row.priority_id ? `priority-${row.priority_id}` : ""
    ].filter(Boolean).join(" ");
  }

  function renderCell(row, key) {
    if (key === "id") {
      return `<td class="id"><a href="${BF_APP_ROOT}issues/${row.id}">${row.id}</a></td>`;
    }

    if (key === "subject") {
      return `<td class="subject"><a href="${BF_APP_ROOT}issues/${row.id}">${row.subject || ""}</a></td>`;
    }

    if (key === "project") {
      const title = row.project_parents?.length
        ? [...row.project_parents.map(p => p.name), row.project].join(" » ")
        : "";

      return `
        <td class="project" title="${title}">
          <a href="${BF_APP_ROOT}projects/${row.project_identifier}/issues">
            ${row.project || ""}
          </a>
        </td>
      `;
    }

		if (key === "last_read_at") {
			const iso = row.last_read_at;
			const text = iso ? BF.humanTimeAgo(iso) : "—";
			const title = iso ? new Date(iso).toLocaleString() : "";

			return `<td class="last_read" title="${title}">${text}</td>`;
		}

    return `<td class="${key}">${row[key] ?? ""}</td>`;
  }

  // -------------------------------------------------------------------------
  // RENDER TABLE
  // -------------------------------------------------------------------------
	function renderTable() {
		const tbody = document.getElementById(`${PREFIX}-tbody`);
		const thead = document.getElementById(`${PREFIX}-thead`);

		// Rendera header så fort thead finns
        if (thead) {
            thead.innerHTML = `
            <tr>
              <th class="id">#</th>
              <th class="subject">${BF.t("columns.subject", "Subject")}</th>
              <th class="project">${BF.t("columns.project", "Project")}</th>
              <th class="last_read">${BF.t("columns.last_viewed", "Last viewed")}</th>
            </tr>
          `;
        }

		// Om tbody inte finns ännu → vänta
		if (!tbody) return;

		const rows = getVisibleRows();

		const baseIndex = BF.recent.state.expanded
			? (BF.recent.state.page - 1) * BF.recent.UI.PER_PAGE
			: 0;

		tbody.innerHTML = rows.map((row, i) => `
			<tr id="issue-${row.id}" class="${getRowClasses(row, baseIndex + i)}">
				${renderCell(row, "id")}
				${renderCell(row, "subject")}
				${renderCell(row, "project")}
				${renderCell(row, "last_read_at")}
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
    const footer = document.querySelector(`.${PREFIX}-footer`);
    const expandBtn = document.getElementById(`${PREFIX}-expand`);
    const pagination = document.getElementById(`${PREFIX}-pagination`);
    if (!footer || !expandBtn || !pagination) return;

    const total = getTotalRows();

    // Visa footer endast om fler än 10
    footer.classList.toggle(
      "is-visible",
      total > BF.recent.UI.COLLAPSED_LIMIT
    );

    // Expand-knapp
    expandBtn.style.display =
      total > BF.recent.UI.COLLAPSED_LIMIT ? "" : "none";

    expandBtn.setAttribute(
      "aria-expanded",
      BF.recent.state.expanded ? "true" : "false"
    );

    const label = expandBtn.querySelector(".label");
    const icon  = expandBtn.querySelector(".icon");

    const labelText = BF.recent.state.expanded
      ? BF.t("show_less", "Show less")
      : BF.t("show_more", "Show more");

    if (label) label.textContent = labelText;
    expandBtn.title = labelText;
    expandBtn.setAttribute("aria-label", labelText);

    if (icon) {
      icon.classList.toggle("icon-zoom-in", !BF.recent.state.expanded);
      icon.classList.toggle("icon-zoom-out", BF.recent.state.expanded);
    }

    // Pagination
    if (!BF.recent.state.expanded || total <= BF.recent.UI.PER_PAGE) {
      pagination.innerHTML = "";
      pagination.style.display = "none";
      return;
    }

    pagination.style.display = "";

    ensurePageInRange();

    const page  = BF.recent.state.page;
    const pages = getTotalPages();
    const startItem = (page - 1) * BF.recent.UI.PER_PAGE + 1;
    const endItem   = Math.min(page * BF.recent.UI.PER_PAGE, total);
    const prevLabel = BF.t("previous_label", "« Previous");
    const nextLabel = BF.t("next_label", "Next »");

    let html = `
      <span class="pagination">
        <ul class="pages">
          <li class="previous ${page === 1 ? "" : "page"}">
            ${
                page === 1
                    ? `<span>${prevLabel}</span>`
                    : `<a href="#" class="bf-recent-page-link" data-page="${page - 1}">${prevLabel}</a>`
            }
          </li>
    `;

    for (let p = 1; p <= pages; p++) {
      html += p === page
        ? `<li class="current"><span>${p}</span></li>`
        : `<li class="page"><a href="#" class="bf-recent-page-link" data-page="${p}">${p}</a></li>`;
    }

    html += `
          <li class="next ${page === pages ? "" : "page"}">
            ${
                page === pages
                    ? `<span>${nextLabel}</span>`
                    : `<a href="#" class="bf-recent-page-link" data-page="${page + 1}">${nextLabel}</a>`
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
    fetch(`${BF_APP_ROOT}bf_readup/recently_read`, {
      credentials: "same-origin"
    })
      .then(r => r.json())
			.then(json => {
				if (!json || !json.rows) return;

				BF.recent.rows = json.rows;
				BF.recent.state.page = 1;

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
		if (BF.recent.__bound) return;
		BF.recent.__bound = true;
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

      BF.recent.state.expanded = !BF.recent.state.expanded;
      BF.recent.state.page = 1;

      renderTable();
      scrollHeaderIntoView();
    });

    // Pagination
    document.addEventListener("click", function (e) {
      const link = e.target.closest("a.bf-recent-page-link[data-page]");
      if (!link) return;

      e.preventDefault();

      const next = parseInt(link.dataset.page, 10);
      if (!next || isNaN(next)) return;

      BF.recent.state.page = next;
      renderTable();
      scrollHeaderIntoView();
    });
  }

  // -------------------------------------------------------------------------
  // BOOTSTRAP (Turbo-safe)
  // -------------------------------------------------------------------------
	function boot() {
		bindEvents();

		const cached = loadCachedData();
		if (cached && cached.rows && cached.rows.length) {
			BF.recent.rows = cached.rows;
			BF.recent.state.page = 1;
			renderTable();
			updateEmptyState();
		}

		const haveCache = !!(cached && cached.rows && cached.rows.length);
		const haveAnyRowsInMemory = BF.recent.rows.length > 0;

		load();
	}

  document.addEventListener("DOMContentLoaded", boot);
  document.addEventListener("turbo:load", boot);
  document.addEventListener("turbo:render", boot);
  document.addEventListener("turbo:frame-load", boot);

})();
