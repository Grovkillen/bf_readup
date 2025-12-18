// ===========================================================================
// BF READUP – Most Read Widget
// Collapsed (10) → Expanded (pagination, 40/page)
// Server-side MAX_RESULTS = 200 respekteras
// ===========================================================================

window.BF = window.BF || {};

(function () {

  const PREFIX = "bf-readup-most";
	const LS_LAST_LOAD_KEY = "bf_readup_most_last_load";
	const LS_CACHE_KEY = "bf_readup_most_cache";

  // -------------------------------------------------------------------------
  // STATE
  // -------------------------------------------------------------------------
	BF.most = BF.most || {};
	BF.most.__bound = BF.most.__bound || false;
  BF.most.rows = [];

  BF.most.UI = {
    COLLAPSED_LIMIT: 10,
    PER_PAGE: 25
  };

  BF.most.state = {
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
            if (diffSec < 60) return locales.common.just_now || "just now";

            const min = Math.floor(diffSec / 60);
            if (min < 60) return `${min} ${locales.units?.minute || "min"}`;

            const h = Math.floor(min / 60);
            if (h < 24) return `${h} ${locales.units?.hour || "h"}`;

            const d = Math.floor(h / 24);
            return `${d} ${locales.units?.day || "d"}`;
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

		const hasRows = BF.most.rows.length > 0;

		if (tableEl) tableEl.style.display = hasRows ? "" : "none";
		
		emptyEl.style.display = hasRows ? "none" : "block";
	}

  function getTotalRows() {
    return BF.most.rows.length;
  }

	function getTotalPages() {
		if (!BF.most.state.expanded) return 1;
		return Math.max(1, Math.ceil(getTotalRows() / BF.most.UI.PER_PAGE));
	}

  function ensurePageInRange() {
    const pages = getTotalPages();
    if (BF.most.state.page < 1) BF.most.state.page = 1;
    if (BF.most.state.page > pages) BF.most.state.page = pages;
  }

  function getVisibleRows() {
    const rows = BF.most.rows;

    if (!BF.most.state.expanded) {
      return rows.slice(0, BF.most.UI.COLLAPSED_LIMIT);
    }

    ensurePageInRange();

    const start = (BF.most.state.page - 1) * BF.most.UI.PER_PAGE;
    const end   = start + BF.most.UI.PER_PAGE;
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

    if (key === "total_seconds") {
      const h = Math.floor((row.total_seconds || 0) / 3600);
      const m = Math.floor(((row.total_seconds || 0) % 3600) / 60);
      return `<td class="time_spent">${h}h ${m}m</td>`;
    }

		if (key === "last_viewed_at") {
			const iso  = row.last_viewed_at;
			const text = iso ? BF.humanTimeAgo(iso) : "—";

			// Visa mänsklig tooltip, inte ISO
			const title = iso
				? new Date(iso).toLocaleString()
				: "";

			return `<td class="last_viewed" title="${title}">${text}</td>`;
		}

    return `<td class="${key}">${row[key] ?? ""}</td>`;
  }

  // -------------------------------------------------------------------------
  // RENDER TABLE
  // -------------------------------------------------------------------------
	function renderTable() {
		const tbody = document.getElementById(`${PREFIX}-tbody`);
		const thead = document.getElementById(`${PREFIX}-thead`);

		// Rendera header oavsett tbody
		if (thead) {
			thead.innerHTML = `
				<tr>
					<th class="id">#</th>
					<th class="subject">${BF.t("columns.issue", "Issue")}</th>
					<th class="project">${BF.t("columns.project", "Project")}</th>
					<th class="time_spent">${BF.t("columns.time_spent", "Time spent")}</th>
					<th class="last_viewed">${BF.t("columns.last_viewed", "Last viewed")}</th>
				</tr>
			`;
		}

		// Om tbody inte finns ännu → klart här
		if (!tbody) return;

		const rows = getVisibleRows();

		const baseIndex = BF.most.state.expanded
			? (BF.most.state.page - 1) * BF.most.UI.PER_PAGE
			: 0;

		tbody.innerHTML = rows.map((row, i) => `
			<tr id="issue-${row.id}" class="${getRowClasses(row, baseIndex + i)}">
				${renderCell(row, "id")}
				${renderCell(row, "subject")}
				${renderCell(row, "project")}
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
    const footer = document.querySelector(`.${PREFIX}-footer`);
    const expandBtn = document.getElementById(`${PREFIX}-expand`);
    const pagination = document.getElementById(`${PREFIX}-pagination`);
    if (!footer || !expandBtn || !pagination) return;

    const total = getTotalRows();

    // Visa footer endast om fler än 10
    footer.classList.toggle(
      "is-visible",
      total > BF.most.UI.COLLAPSED_LIMIT
    );

    // Expand-knapp
    expandBtn.style.display =
      total > BF.most.UI.COLLAPSED_LIMIT ? "" : "none";

    expandBtn.setAttribute(
      "aria-expanded",
      BF.most.state.expanded ? "true" : "false"
    );

		const label = expandBtn.querySelector(".label");
		const icon  = expandBtn.querySelector(".icon");
        const labelText = BF.most.state.expanded
            ? BF.t("show_less", "Show less")
            : BF.t("show_more", "Show more");

        if (label) label.textContent = labelText;
        expandBtn.title = labelText;
        expandBtn.setAttribute("aria-label", labelText);

        if (icon) {
          icon.classList.toggle("icon-zoom-in", !BF.most.state.expanded);
          icon.classList.toggle("icon-zoom-out", BF.most.state.expanded);
        }

    // Pagination
    if (!BF.most.state.expanded || total <= BF.most.UI.PER_PAGE) {
      pagination.innerHTML = "";
      pagination.style.display = "none";
      return;
    }

    pagination.style.display = "";

    ensurePageInRange();

    const page  = BF.most.state.page;
    const pages = getTotalPages();
    const startItem = (page - 1) * BF.most.UI.PER_PAGE + 1;
    const endItem   = Math.min(page * BF.most.UI.PER_PAGE, total);
      const prevLabel = BF.t("previous_label", "« Previous");
      const nextLabel = BF.t("next_label", "Next »");
    let html = `
      <span class="pagination">
        <ul class="pages">
          <li class="previous ${page === 1 ? "" : "page"}">
            ${
              page === 1
                ? `<span>${prevLabel}</span>`
                : `<a href="#" class="bf-most-page-link" data-page="${page - 1}">${prevLabel}</a>`
            }
          </li>
    `;

    for (let p = 1; p <= pages; p++) {
      html += p === page
        ? `<li class="current"><span>${p}</span></li>`
        : `<li class="page"><a href="#" class="bf-most-page-link" data-page="${p}">${p}</a></li>`;
    }

    html += `
          <li class="next ${page === pages ? "" : "page"}">
            ${
              page === pages
                ? `<span>${nextLabel}</span>`
                : `<a href="#" class="bf-most-page-link" data-page="${page + 1}">${nextLabel}</a>`
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
    fetch(`${BF_APP_ROOT}bf_readup/most_read`, {
      credentials: "same-origin"
    })
      .then(r => r.json())
			.then(json => {
				if (!json || !json.rows) return;

				BF.most.rows = json.rows;
				BF.most.state.page = 1;

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
		if (BF.most.__bound) return;
		BF.most.__bound = true;
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

      BF.most.state.expanded = !BF.most.state.expanded;
      BF.most.state.page = 1;

      renderTable();
      scrollHeaderIntoView();
    });

    // Pagination
    document.addEventListener("click", function (e) {
      const link = e.target.closest("a.bf-most-page-link[data-page]");
      if (!link) return;

      e.preventDefault();

      const next = parseInt(link.dataset.page, 10);
      if (!next || isNaN(next)) return;

      BF.most.state.page = next;
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
		if (cached && cached.rows.length) {
			BF.most.rows = cached.rows;
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
