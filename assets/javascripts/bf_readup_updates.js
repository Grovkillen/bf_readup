// assets\javascript\bf_readup_updates.js

// ===========================================================================
// BF READUP – Updates Widget (DEBUG SUPPORT + LocalStorage Cache)
// ===========================================================================

// ===========================================================================
// VIKTIG ARKITEKTUR-NOTERING
//
// Tabellen har TVÅ render-vägar:
// 1) renderTable()  – full, deterministisk render (inkl. debug-rader)
// 2) patchTable()   – snabb diff/FLIP-render för issue-rader
//
// Följande gäller ALLTID:
// - Tidskolumner (read_ago / activity_ago) får ALDRIG renderas rått
// - Debug-rader får ALDRIG förlita sig på patchTable()
// - Vid debug-läge eller policy-ändring måste full render användas
//
// Om detta bryts:
// - tider försvinner
// - debug-rader tappas
// - UI blir inkonsekvent
// ===========================================================================

window.BF = window.BF || {};

(function () {

	const BF_WIDGET_PREFIX = "bf-readup-updates";
 	const BF_UPDATES_BLOCK_SELECTOR = "#block-bf_readup_updates";
	const BF_LOADING_CLASS = "bf-widget-is-loading";
	const BF_LOADING_OVERLAY_CLASS = "bf-readup-loading-orbit";

	BF.ensureUpdatesLoadingOverlay = function () {
		const target = document.querySelector(BF_UPDATES_BLOCK_SELECTOR);
		if (!target) return;

		// Säkerställ att overlay fungerar utan att påverka layout:
		const cs = window.getComputedStyle(target);
		if (cs.position === "static") {
			if (!("bfReadupPrevPosition" in target.dataset)) {
				target.dataset.bfReadupPrevPosition = target.style.position || "";
			}
			target.style.position = "relative";
		}

		// Skapa overlay om den inte finns
		if (target.querySelector(`.${BF_LOADING_OVERLAY_CLASS}`)) return;

		const overlay = document.createElement("div");
		overlay.className = BF_LOADING_OVERLAY_CLASS;

		for (let i = 0; i < 4; i++) {
			const span = document.createElement("span");
			span.className = "bf-orbit-span";
			overlay.appendChild(span);
		}

		target.appendChild(overlay);
	};

	BF.setUpdatesLoading = function (isLoading) {
		const target = document.querySelector(BF_UPDATES_BLOCK_SELECTOR);
		if (!target) return;

		if (isLoading) {
			target.classList.add(BF_LOADING_CLASS);
			BF.ensureUpdatesLoadingOverlay();
		} else {
			target.classList.remove(BF_LOADING_CLASS);
			// Behåll overlay i DOM. CSS styr synligheten.
			// Återställ position om vi ändrade den (valfritt).
			if ("bfReadupPrevPosition" in target.dataset) {
				target.style.position = target.dataset.bfReadupPrevPosition;
				delete target.dataset.bfReadupPrevPosition;
			}
		}
	};

	// -------------------------------------------------------------------------
  // 0) GLOBAL STATE / GUARDS
  // -------------------------------------------------------------------------
  BF.__mypage = BF.__mypage || {};
  BF.__mypage.bound = BF.__mypage.bound || false;
  BF.__mypage.inited = BF.__mypage.inited || false;
  BF.__mypage.loading = BF.__mypage.loading || false;
	BF.__mypage.hasRendered = BF.__mypage.hasRendered || false;
	BF.__mypage.pollerStarted = BF.__mypage.pollerStarted || false;
	BF.__mypage.humanTimerStarted = BF.__mypage.humanTimerStarted || false;
	BF.__mypage.nextForcedSyncAt = BF.__mypage.nextForcedSyncAt || null;

	BF.VISUAL_TIMINGS = {
		DIM: 400,
		CELL: 1200,
		FLIP: 400,
		ROW_FLASH: 1500,
		COLLAPSE: 300
	};

	// Auto-refresh om My Page-datat är äldre än
	BF.AUTO_REFRESH_SECONDS = 900; //production
	//BF.AUTO_REFRESH_SECONDS = 60; //debut
	// Hur ofta pollern vaknar och kontrollerar ålder
	BF.POLL_INTERVAL_SECONDS = 30; //production
	//BF.POLL_INTERVAL_SECONDS = 10; //debug
	
	// Klasser vi synkar deterministiskt från serverstate
	BF.SYNCED_ROW_CLASSES = {
		closed: row => row.is_closed,
		overdue: row => row.overdue,
		"behind-schedule": row => row.behind_schedule,
		"created-by-me": row => row.created_by_me,
		"assigned-to-me": row => row.assigned_to_me,
		"bf-readup-locked": row => row.allowed_to_mark_as_read === false
	};

	BF.getDeterministicRowClasses = function (row) {
		const classes = [];

		if (row.tracker_id)  classes.push(`tracker-${row.tracker_id}`);
		if (row.status_id)   classes.push(`status-${row.status_id}`);
		if (row.priority_id) classes.push(`priority-${row.priority_id}`);

		return classes;
	};

	BF.UI = BF.UI || {};
	BF.UI.COLLAPSED_LIMIT = 10;
	BF.UI.EXPANDED_PER_PAGE = 40;

	BF.state = BF.state || {
		expanded: false, 					// false => visa max 10
		page: 1,         					// 1-indexerad sida när expanded
		lastVisibleCount: null 
	};
	
	BF.runtime = BF.runtime || {};
	BF.runtime.settings = BF.runtime.settings || {};

	BF.runtime.latestJournalByIssue = BF.runtime.latestJournalByIssue || {};

	// -------------------------------------------------------------------------
	// APP ROOT (dynamic, no hardcoded subdomain)
	// -------------------------------------------------------------------------
	const BF_APP_ROOT = (() => {
		const path = window.location.pathname || "/";
		// ex: "/ticket/my/page" -> "/ticket/"
		const parts = path.split("/").filter(Boolean);
		return parts.length > 0 ? `/${parts[0]}/` : "/";
	})();

  // =========================================================================
  // 1) AJAX WRAPPER
  // =========================================================================
	function post(url, data) {
		return fetch(url, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				"X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content
			},
			body: JSON.stringify(data || {})
		}).then(r => r.json());
	}

	function postForm(url, data) {
		const form = new URLSearchParams();

		Object.entries(data || {}).forEach(([key, val]) => {
			if (Array.isArray(val)) {
				val.forEach(v => form.append(`${key}[]`, v));
			} else {
				form.append(key, val);
			}
		});

		return fetch(url, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
				"X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content
			},
			body: form.toString()
		}).then(r => r.json());
	}

  // =========================================================================
  // 2) INIT (idempotent)
  // =========================================================================
  BF.init = function () {
    // Hitta element varje gång (My Page kan re-renderas)
    BF.cacheElements();

    // Bind events exakt en gång per page-load (oavsett hur ofta init körs)
    BF.bindEvents();

    // Init gör cached render + fetch bara första gången vi init:ar
		if (!BF.__mypage.inited) {
			BF.__mypage.inited = true;

			const cached = BF.loadCachedData();
			if (cached) {
				BF.columns = cached.columns || [];
				const cachedRows = cached.rows || [];

				BF.rows = cachedRows;

				BF.renderTable();
				BF.updateHeaderCount();
				BF.updateEmptyState();
				BF.updateBulkReadButtonState();
				BF.applyView();
				BF.updateMasterCheckboxState();
				BF.__mypage.hasRendered = true;
			}

			BF.loadData();
		}

  };

  // =========================================================================
  // 3) CACHE ELEMENTS
  // =========================================================================
	BF.cacheElements = function () {
		const p = BF_WIDGET_PREFIX;

		BF.el = {
			headerCount:   document.getElementById(`${p}-total-count`),
			tbody:         document.getElementById(`${p}-tbody`),
			thead:         document.getElementById(`${p}-thead`),
			settingsPanel: document.getElementById(`${p}-settings`),
			footer:        document.querySelector(`.${p}-footer`),
			expandBtn:     document.getElementById(`${p}-expand`),
			pagination:    document.getElementById(`${p}-pagination`)
		};
	};

  // =========================================================================
  // 4) SETTINGS PANEL + DEBUG TOGGLE (bind once, delegate)
  // =========================================================================
  BF.bindEvents = function () {
    if (BF.__mypage.bound) return;
    BF.__mypage.bound = true;

    // --------------------------------------------------------------
    // Settings toggle (My Page) – delegation
    // --------------------------------------------------------------
    document.addEventListener("click", function (e) {
			const btn = e.target.closest(`.${BF_WIDGET_PREFIX}-open-settings`);
      if (!btn) return;

      e.preventDefault();

      // För säkerhets skull: hämta panel live (DOM kan ha bytts)
      const panel = document.getElementById(`${BF_WIDGET_PREFIX}-settings`);
      if (!panel) return;

      panel.style.display =
        (panel.style.display === "none" || panel.style.display === "")
          ? "block"
          : "none";

      const cb = document.getElementById("bf-readup-debug-checkbox");
      if (cb) cb.checked = BF.isDebugEnabled();
    });
		
		// --------------------------------------------------------------
		// Settings: prio visibility
		// --------------------------------------------------------------
		document.addEventListener("change", function (e) {
			if (!e.target.matches("#bf-readup-prio-list input[type='checkbox']")) return;
			if (e.target.disabled) return;

			const selected = [];

			document
				.querySelectorAll("#bf-readup-prio-list input[type='checkbox']:checked")
				.forEach(cb => selected.push(cb.dataset.prioKey));

			postForm(`${BF_APP_ROOT}bf_readup/preferences`, {
				visible_prios: selected
			}).then(json => {
				BF.runtime.preferences = json.preferences || {};
				BF.renderVisibleRowsFast();
				BF.applyView();
			});
		});

		// --------------------------------------------------------------
		// Settings: hide closed issues
		// --------------------------------------------------------------
		document.addEventListener("change", function (e) {
			if (e.target.id !== "bf-hide-closed") return;

			postForm(`${BF_APP_ROOT}bf_readup/preferences`, {
				hide_closed_issues: e.target.checked
			}).then(json => {
				BF.runtime.preferences = json.preferences || {};
				BF.renderVisibleRowsFast();
				BF.applyView();
			});
		});

    // --------------------------------------------------------------
    // Debug checkbox toggle – delegation
    // --------------------------------------------------------------
    document.addEventListener("change", function (e) {
      if (e.target && e.target.id === "bf-readup-debug-checkbox") {
        if (e.target.checked) {
          localStorage.setItem("bf_readup_debug", "1");
        } else {
          localStorage.removeItem("bf_readup_debug");
        }

        // Nollställ init-flaggan om du vill tvinga ny fetch-livscykel:
        // (behövs inte egentligen, men kan vara bra vid Turbo)
        // BF.__mypage.inited = true;

        BF.loadData();
      }
    });

    // --------------------------------------------------------------
    // Debug row toggle (om du har en .bf-debug-toggle i UI)
    // --------------------------------------------------------------
    document.addEventListener("click", function (e) {
      const toggle = e.target.closest(".bf-debug-toggle");
      if (!toggle) return;

      const row = toggle.closest("tr");
      if (!row) return;

      const debugRow = row.nextElementSibling;
      if (!debugRow || !debugRow.classList.contains("bf-debug-row")) return;

      debugRow.classList.toggle("is-open");
    });
		
		// --------------------------------------------------------------
    // Klick på prio-ikon → toggla debug-rad (endast i debug-läge)
    // --------------------------------------------------------------
    document.addEventListener("click", function (e) {
      const prioCell = e.target.closest(".bf-col-prio");
      if (!prioCell) return;

      // Endast om debug är aktivt
      if (!BF.isDebugEnabled()) return;

      const row = prioCell.closest("tr");
      if (!row) return;

      const debugRow = row.nextElementSibling;
      if (!debugRow || !debugRow.classList.contains("bf-debug-row")) return;

      e.preventDefault();
      debugRow.classList.toggle("is-open");
    });
		
    // --------------------------------------------------------------
    // Sync-knapp (manuell reload)
    // --------------------------------------------------------------
    document.addEventListener("click", function (e) {
      const syncBtn = e.target.closest(`.${BF_WIDGET_PREFIX}-sync`);
      if (!syncBtn) return;

      e.preventDefault();

      // Förhindra dubbelklick under laddning
      if (BF.__mypage.loading) return;

      BF.loadData();
    });
		
		document.addEventListener("mouseenter", function (e) {
			const syncBtn = e.target.closest(`.${BF_WIDGET_PREFIX}-sync`);
			if (!syncBtn) return;
			BF.updateSyncButtonTooltip();
		}, true);

		// --------------------------------------------------------------
		// Bulk: markera valda som lästa
		// --------------------------------------------------------------
		document.addEventListener("click", function (e) {
			const btn = e.target.closest(".bf-mark-selected-read");
			if (!btn) return;

			if (btn.classList.contains("is-disabled")) {
				e.preventDefault();
				return;
			}

			e.preventDefault();
			BF.markSelectedAsRead();
		});
		
		document.addEventListener("change", function (e) {
			if (e.target.matches("tr.issue input[type='checkbox']")) {
				BF.updateMasterCheckboxState();
				BF.updateBulkReadButtonState();
			}
		});

		document.addEventListener("click", function (e) {

			// Expand/Minimera
			const expand = e.target.closest(`#${BF_WIDGET_PREFIX}-expand`);
			if (expand) {
				e.preventDefault();

				const total = BF.getTotalRows();
				if (total <= BF.UI.COLLAPSED_LIMIT) return; // inget att expandera

				BF.state.expanded = !BF.state.expanded;
				BF.state.page = 1; // när man byter läge: börja på sida 1
				if (BF.isDebugEnabled()) {
					BF.renderTable();
				} else {
					BF.renderVisibleRowsFast();
				}
				BF.updateMasterCheckboxState();
				BF.applyView();
				BF.updateBulkReadButtonState();
				return;
			}

			// Pagination links
			const pageLink = e.target.closest("a.bf-page-link[data-page]");
			if (pageLink) {
				e.preventDefault();

				const next = parseInt(pageLink.getAttribute("data-page"), 10);
				if (!next || isNaN(next)) return;

				BF.state.page = next;
				BF.ensurePageInRange();

				if (BF.isDebugEnabled()) {
					BF.renderTable();
				} else {
					BF.renderVisibleRowsFast();
				}

				BF.updateMasterCheckboxState();
				BF.applyView();
				BF.updateBulkReadButtonState();
				return;

			}

		});

  };

	BF.shouldScrollHeaderIntoView = function (prevCount, nextCount) {
		if (prevCount == null) return false;

		// Scrolla endast om vi minskar antalet synliga rader
		return nextCount < prevCount;
	};

	BF.scrollHeaderIntoView = function () {
		const header = document.querySelector(`h3.${BF_WIDGET_PREFIX}-header`);
		if (!header) return;

		header.scrollIntoView({
			behavior: "smooth",
			block: "nearest"
		});
	};

  BF.toggleSettings = function () {
    const box = (BF.el && BF.el.settingsPanel) || document.getElementById(`${BF_WIDGET_PREFIX}-settings`);
    if (!box) return;

    box.style.display =
      (box.style.display === "none" || box.style.display === "")
        ? "block"
        : "none";
  };

	BF.updateBulkReadButtonState = function () {
		const btn = document.querySelector(".bf-mark-selected-read");
		if (!btn || !BF.el || !BF.el.tbody) {
			if (btn) {
				btn.classList.add("is-disabled");
				btn.setAttribute("aria-disabled", "true");
				btn.title = BF.locales?.common.mark_selected_require_selection || "Select at least one issue to use this action";
			}
			return;
		}

		const anyChecked =
			BF.el.tbody.querySelector(
				"tr.issue input[type='checkbox']:checked:not(:disabled)"
			) !== null;

		const anyRows =
			BF.el.tbody.querySelector("tr.issue") !== null;

		const enabled = anyRows && anyChecked;

		btn.classList.toggle("is-disabled", !enabled);
		btn.setAttribute("aria-disabled", enabled ? "false" : "true");
		btn.title = enabled
			? (BF.locales?.common.mark_selected_read || "Mark selected as read")
			: (BF.locales?.common.mark_selected_require_selection || "Select at least one issue to use this action");
	};

	BF.updateMasterCheckboxState = function () {
		const master = document.getElementById("bf-check-all");
		if (!master || !BF.el || !BF.el.tbody) return;

		const checkboxes = Array.from(
			BF.el.tbody.querySelectorAll(
				"tr.issue input[type='checkbox']:not(:disabled)"
			)
		);

		// Inga valbara rader alls
		if (checkboxes.length === 0) {
			master.checked = false;
			master.indeterminate = false;
			master.disabled = true;
			return;
		}

		master.disabled = false;

		const checkedCount = checkboxes.filter(cb => cb.checked).length;

		if (checkedCount === 0) {
			master.checked = false;
			master.indeterminate = false;
		} else if (checkedCount === checkboxes.length) {
			master.checked = true;
			master.indeterminate = false;
		} else {
			master.checked = false;
			master.indeterminate = true;
		}
	};

	BF.updateEmptyState = function () {
		const emptyEl = document.getElementById(`${BF_WIDGET_PREFIX}-empty`);
		const tableEl = document.getElementById(`${BF_WIDGET_PREFIX}-table`);
		if (!emptyEl) return;

		const hasRows = (BF.rows || []).length > 0;

		if (tableEl) tableEl.style.display = hasRows ? "" : "none";
		emptyEl.style.display = hasRows ? "none" : "block";
	};

	BF.removeIssueRowById = function (issueId) {
		const tr = document.getElementById(`issue-${issueId}`);
		if (tr) BF.removeRow(tr);

		BF.rows = (BF.rows || []).filter(r => String(r.id) !== String(issueId));

		BF.ensurePageInRange();

		if (BF.isDebugEnabled()) {
			BF.renderTable();
		} else {
			BF.renderVisibleRowsFast();
		}
		BF.updateMasterCheckboxState();
		BF.applyView();

		BF.updateHeaderCount();
		BF.updateEmptyState();
		BF.updateBulkReadButtonState();
	};
	
	BF.updateHeaderCount = function () {
		if (!BF.el || !BF.el.headerCount) return;

		const count = BF.getTotalRows();
		BF.el.headerCount.textContent = String(count);
	};

// -------------------------------------------------------------------------
// NAME RENDERING: no-break full name (prevent first/last name wrapping)
// -------------------------------------------------------------------------
	BF.nbspName = BF.nbspName || function (name) {
		return String(name ?? "")
			.trim()
			.replace(/\s+/g, " ")
			.replace(/ /g, "\u00A0"); // NBSP
	};
	
// IMPORTANT:
// renderCell() är ENDA källan för cell-DOM.
// Alla renderingar (initial, fast, insert) måste gå via denna.
	BF.renderCell = function (row, col) {
		const key = col.key;
		const val = row[key] ?? "";

		if (key === "prio") {
			return `
				<td class="bf-col-prio" title="${row.prio_label || ""}">
					${row.prio || ""}
				</td>
			`;
		}

		if (key === "id") {
			return `<td class="id"><a href="${BF_APP_ROOT}issues/${row.id}">${row.id}</a></td>`;
		}

		if (key === "subject") {
			return `
				<td class="subject" data-bf-owned="false">
					<a href="${BF_APP_ROOT}issues/${row.id}">${val}</a>
				</td>
			`;
		}

		if (key === "project") {
			const title = row.project_parents?.length
				? [...row.project_parents.map(p => p.name), val].join(" » ")
				: "";

			return `
				<td class="project" title="${title}">
					<span class="bf-project-cell">
						<a href="${BF_APP_ROOT}projects/${row.project_identifier}/issues"
							 class="bf-project-link">
							${val}
						</a>
					</span>
				</td>
			`;
		}

		if (key === "updated_by") {
			const display = BF.nbspName(val);
			return `
				<td class="updated_by" data-bf-owned="true">
					${display}
				</td>
			`;
		}

		if (key === "new_count") {
			const authors = row.new_authors || [];
			return `
				<td class="new_count" title="${authors.join("\n")}">
					${val}
				</td>
			`;
		}
		
		if (key === "read_ago" || key === "activity_ago") {
			const iso =
				key === "read_ago"
					? row.last_read_at_iso
					: row.last_activity_at_iso;

			const text =
				key === "read_ago"
					? (row.last_read_at_text ? BF.humanTimeAgo(iso) : "—")
					: (row.last_activity_at_text ? BF.humanTimeAgo(iso) : "—");

			const title =
				key === "read_ago"
					? (row.last_read_at_text || "")
					: (row.last_activity_at_text || "");

			return `
				<td class="${key}" title="${title}">
					${text}
				</td>
			`;
		}
		
		return `<td class="${key}" data-bf-owned="true">${val}</td>`;
	};

	BF.armNextSyncIn = function (seconds) {
		const s = parseInt(seconds, 10);
		const delay = (!s || isNaN(s) || s < 1) ? 60 : s;

		// "Varje klickning sätter now+1min" => vi skriver alltid över med nytt now+delay
		BF.__mypage.nextForcedSyncAt = Date.now() + (delay * 1000);
	};
	
	BF.ensureMarkAsReadButton = function (tr, row) {
		if (row.allowed_to_mark_as_read === false) return;
		if (!tr || tr.__bfHasMarkReadBtn) return;

		// vi lägger den i projects-kolumnen
		const projectTd   = tr.querySelector("td.project");
		const projectCell = projectTd?.querySelector(".bf-project-cell");

		if (!projectTd || !projectCell) return;

		projectTd.style.position = "relative";
		
		const btn = document.createElement("a");
		btn.href = "javascript:void(0)";
		btn.title = BF.locales?.common.mark_as_read || "Mark as read";
		btn.className = "bf-mark-read-btn";

		Object.assign(btn.style, {
			width: "18px",
			height: "18px",
			position: "absolute",
			left: "6px",
			top: "50%", 
			transform: "translateY(-50%) scale(1)",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			borderRadius: "50%",
			backgroundColor: "rgba(233,233,233,0.25)",
			color: "rgba(50,50,50,0.45)",
			opacity: "0",
			pointerEvents: "auto",
			cursor: "pointer",
			transition: "opacity 0.12s ease, background-color 0.2s ease, transform 0.12s ease"
		});

		btn.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg"
					 viewBox="0 0 24 24"
					 width="16"
					 height="16"
					 style="display:inline-block !important">
				<path d="M5 13l4 4L19 7"
					fill="none"
					stroke="#111"
					stroke-width="2.4"
					stroke-linecap="round"
					stroke-linejoin="round"/>
			</svg>
		`;

		// hover-effekt
		btn.addEventListener("mouseenter", () => {
			btn.style.backgroundColor = "#BEB500";
			btn.style.opacity = "1";
			btn.style.transform = "translateY(-50%) scale(1.08)";
		});

		btn.addEventListener("mouseleave", () => {
			btn.style.backgroundColor = "rgba(233,233,233,0.25)";
			btn.style.transform = "translateY(-50%) scale(1)";
		});

		// klick → markera EN som läst
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();

			post(`${BF_APP_ROOT}bf_readup/mark_as_read`, { issue_id: row.id })
				.then(() => {
					BF.removeIssueRowById(row.id);
					BF.armNextSyncIn(60);
				});

		});

		// synlighet via hover på raden
		tr.addEventListener("mouseenter", () => {
			btn.style.opacity = "0.35";
		});

		tr.addEventListener("mouseleave", () => {
			btn.style.opacity = "0";
		});

		projectTd.prepend(btn);
		tr.__bfHasMarkReadBtn = true;
	};
	
	BF.markSelectedAsRead = function () {
		const ids = [];

		BF.el.tbody
			.querySelectorAll("tr.issue input[type='checkbox']:checked:not(:disabled)")
			.forEach(cb => {
				const tr = cb.closest("tr.issue");
				if (!tr) return;
				const id = tr.id.replace("issue-", "");
				if (id) ids.push(parseInt(id, 10));
			});

		if (!ids.length) return;

		post(`${BF_APP_ROOT}bf_readup/mark_all_as_read`, { issue_ids: ids })
			.then(() => {
				ids.forEach(id => BF.removeIssueRowById(id));

				BF.updateMasterCheckboxState();
				BF.updateBulkReadButtonState();
				BF.armNextSyncIn(60);
			});

	};

  BF.isDebugEnabled = function () {
    return localStorage.getItem("bf_readup_debug") === "1";
  };

	BF.tmpl = function (str, vars) {
		if (!str) return "";
		return String(str).replace(/%\{(\w+)\}/g, (_, k) => {
			return (vars && vars[k] != null) ? String(vars[k]) : "";
		});
	};

	BF.formatSyncedAgo = function () {
		const c = BF.locales?.common || {};

		const raw = localStorage.getItem("bf_readup_last_load");
		if (!raw) return c.last_synced_never || "Last synced: never";

		const last = parseInt(raw, 10);
		if (isNaN(last)) return c.last_synced_unknown || "Last synced: unknown";

		const diffSec = Math.floor((Date.now() - last) / 1000);

		if (diffSec < 10) return c.last_synced_just_now || "Last synced: just now";
		if (diffSec < 60) {
			return BF.tmpl(c.last_synced_seconds || "Last synced: %{n} sec ago", { n: diffSec });
		}

		const min = Math.floor(diffSec / 60);
		if (min < 60) {
			return BF.tmpl(c.last_synced_minutes || "Last synced: %{n} min ago", { n: min });
		}

		const h = Math.floor(min / 60);
		if (h < 24) {
			return BF.tmpl(c.last_synced_hours || "Last synced: %{n} h ago", { n: h });
		}

		const d = Math.floor(h / 24);
		return BF.tmpl(c.last_synced_days || "Last synced: %{n} d ago", { n: d });
	};

	BF.updateSyncButtonTooltip = function () {
		const syncBtn = document.querySelector(`.${BF_WIDGET_PREFIX}-sync`);
		if (!syncBtn) return;

		const title1 = BF.locales?.common?.sync_title || "Refresh";
		const title2 = BF.formatSyncedAgo();

		syncBtn.setAttribute("title", `${title1}\n${title2}`);
	};

	BF.startSyncTooltipTimer = function () {
		if (BF.__mypage.syncTooltipTimerStarted) return;
		BF.__mypage.syncTooltipTimerStarted = true;

		// Sätt direkt (så den finns innan första hover)
		BF.updateSyncButtonTooltip();

		// Uppdatera löpande så "X min" inte blir gammalt
		setInterval(() => {
			if (document.visibilityState !== "visible") return;
			BF.updateSyncButtonTooltip();
		}, 30 * 1000);
	};

	BF.shouldAutoRefresh = function () {
		const raw = localStorage.getItem("bf_readup_last_load");
		if (!raw) return true; // aldrig laddat --> ja

		const last = parseInt(raw, 10);
		if (isNaN(last)) return true;

		const ageSeconds = (Date.now() - last) / 1000;
		return ageSeconds > BF.AUTO_REFRESH_SECONDS;
	};

	BF.startPolling = function () {
		if (BF.__mypage.pollerStarted) return;
		BF.__mypage.pollerStarted = true;

		setInterval(() => {
			if (document.visibilityState !== "visible") return;
			if (BF.__mypage.loading) return;

			// 1) Forced sync har företräde
			if (BF.__mypage.nextForcedSyncAt && Date.now() >= BF.__mypage.nextForcedSyncAt) {
				BF.__mypage.nextForcedSyncAt = null;
				BF.loadData();
				return;
			}

			// 2) Ordinarie åldersbaserad auto-refresh
			if (BF.shouldAutoRefresh()) {
				BF.loadData();
			}
		}, BF.POLL_INTERVAL_SECONDS * 1000);
	};

  // =========================================================================
  // 5) LOCAL STORAGE CACHE
  // =========================================================================
  BF.loadCachedData = function () {
    try {
      const raw = localStorage.getItem("bf_readup_cache");
      if (!raw) return null;
      const json = JSON.parse(raw);
      if (!json || !json.rows) return null;
      return json;
    } catch (e) {
      return null;
    }
  };

  BF.saveCachedData = function (payload) {
    try {
      localStorage.setItem("bf_readup_cache", JSON.stringify(payload));
    } catch (e) {}
  };

  // =========================================================================
  // 5.5) HUMAN READABLE STUFF
  // =========================================================================
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

	BF.getTotalRows = function () {
		const rows = BF.rows || [];
		return rows.length;
	};

	BF.getTotalPages = function () {
		const total = BF.getTotalRows();
		if (!BF.state.expanded) return 1;
		return Math.max(1, Math.ceil(total / BF.UI.EXPANDED_PER_PAGE));
	};

	BF.ensurePageInRange = function () {
		const pages = BF.getTotalPages();
		if (BF.state.page < 1) BF.state.page = 1;
		if (BF.state.page > pages) BF.state.page = pages;
	};

	BF.applyUserFilters = function (rows) {
		// DEBUG-LÄGE: inga filter alls
		if (BF.isDebugEnabled()) return rows;

		const prefs = BF.runtime.preferences || {};
		const visiblePrios = Array.isArray(prefs.visible_prios)
			? prefs.visible_prios
			: [];
		const hideClosed   = prefs.hide_closed_issues === true;

		return rows.filter(row => {

			// ----------------------------------
			// 1) Dölj stängda
			// ----------------------------------
			if (hideClosed && row.is_closed) {
				return false;
			}

			// ----------------------------------
			// 2) Prioritetsfilter
			// ----------------------------------
			if (visiblePrios.length > 0) {

				// OBS: låsta prios SKA alltid visas
				const locked =
					BF.runtime.settings?.mark_as_read_max_rank > 0 &&
					row.prio_rank < BF.runtime.settings.mark_as_read_max_rank;

				if (!locked && !visiblePrios.includes(row.prio_key)) {
					return false;
				}
			}

			return true;
		});
	};

	BF.getVisibleRows = function () {
		let rows = BF.rows || [];

		// Minimerat läge
		if (!BF.state.expanded) {
			return rows.slice(0, BF.UI.COLLAPSED_LIMIT);
		}

		BF.ensurePageInRange();

		const start = (BF.state.page - 1) * BF.UI.EXPANDED_PER_PAGE;
		const end   = start + BF.UI.EXPANDED_PER_PAGE;
		return rows.slice(start, end);
	};

	BF.renderVisibleRowsFast = function () {
		const prevCount = BF.state.lastVisibleCount;
		const tbody = BF.el.tbody;
		if (!tbody) return;

		const rows = BF.getVisibleRows();
		let html = "";

		const baseIndex = BF.state.expanded
			? (BF.state.page - 1) * BF.UI.EXPANDED_PER_PAGE
			: 0;

		rows.forEach((row, index) => {
			const globalIndex = baseIndex + index;

			const trClasses = [
				"issue",
				globalIndex % 2 === 0 ? "odd" : "even",
				row.is_closed ? "closed" : "",
				row.allowed_to_mark_as_read === false ? "bf-readup-locked" : "",
				row.tracker_id ? `tracker-${row.tracker_id}` : "",
				row.status_id ? `status-${row.status_id}` : ""
			].filter(Boolean).join(" ");

			html += `<tr id="issue-${row.id}" class="${trClasses}">
				${BF.buildRowHTML(row)}
			</tr>`;
		});

		tbody.innerHTML = html;
		
		const nextCount = rows.length;
		BF.state.lastVisibleCount = nextCount;

		if (BF.shouldScrollHeaderIntoView(prevCount, nextCount)) {
			BF.scrollHeaderIntoView();
		}

		// återställ mark-as-read-knappar
		tbody.querySelectorAll("tr.issue").forEach(tr => {
			const id = tr.id.replace("issue-", "");
			const row = rows.find(r => String(r.id) === id);
			if (row) BF.ensureMarkAsReadButton(tr, row);
		});
	};

	BF.updateFooterUI = function () {
		BF.cacheElements(); // säkerställ att footer-knappar finns (Turbo)

		const footer = BF.el.footer;
		if (!footer) return;

		const total = BF.getTotalRows();

		// Footer ska endast synas om vi har > 10
		if (total > BF.UI.COLLAPSED_LIMIT) {
			footer.classList.add("is-visible");
		} else {
			footer.classList.remove("is-visible");
		}

		// Expand-knappen
		const expand = BF.el.expandBtn;
		if (expand) {
			const expanded = !!BF.state.expanded;
			const icon = expand.querySelector(".icon");
			const label = expand.querySelector(".label");

			expand.setAttribute("aria-expanded", expanded ? "true" : "false");

			if (expanded) {
				label.textContent = BF.locales?.common.show_less || "Show less";
				icon.classList.remove("icon-zoom-in");
				icon.classList.add("icon-zoom-out");
			} else {
				label.textContent = BF.locales?.common.show_more || "Show more";
				icon.classList.remove("icon-zoom-out");
				icon.classList.add("icon-zoom-in");
			}

			expand.style.display =
				BF.getTotalRows() > BF.UI.COLLAPSED_LIMIT ? "" : "none";
		}

		// Pagination (bara i expanded-läge och om fler än 40)
		BF.renderPagination();
	};

	BF.renderPagination = function () {
		const host = BF.el.pagination;
		if (!host) return;

		const total = BF.getTotalRows();

		// Ingen pagination om:
		// - inte expanded
		// - eller total <= 40
		if (!BF.state.expanded || total <= BF.UI.EXPANDED_PER_PAGE) {
			host.innerHTML = "";
			host.style.display = "none";
			return;
		}

		host.style.display = "";

		BF.ensurePageInRange();

		const pages = BF.getTotalPages();
		const page  = BF.state.page;

		// Redmine-lik markup (utan URL:er, vi använder data-page)
		const startItem = (page - 1) * BF.UI.EXPANDED_PER_PAGE + 1;
		const endItem   = Math.min(page * BF.UI.EXPANDED_PER_PAGE, total);

		let html = `
			<span class="pagination">
				<ul class="pages">
					<li class="previous ${page === 1 ? "" : "page"}">
						${page === 1
							? `<span>${BF.locales?.common.previous_label || "« Previous"}</span>`
							: `<a href="#" class="bf-page-link" data-page="${page - 1}">${BF.locales?.common.previous_label || "« Previous"}</a>`}
					</li>
		`;

		for (let p = 1; p <= pages; p++) {
			if (p === page) {
				html += `<li class="current"><span>${p}</span></li>`;
			} else {
				html += `<li class="page"><a href="#" class="bf-page-link" data-page="${p}">${p}</a></li>`;
			}
		}

		html += `
					<li class="next ${page === pages ? "" : "page"}">
						${page === pages
							? `<span>${BF.locales?.common.next_label || "Next »"}</span>`
							: `<a href="#" class="bf-page-link" data-page="${page + 1}">${BF.locales?.common.next_label || "Next »"}</a>`}
					</li>
				</ul>
				<span>
					<span class="items">(${startItem}-${endItem}/${total})</span>
				</span>
			</span>
		`;

		host.innerHTML = html;
	};

	BF.applyView = function () {
		// Säkerställ page/expanded är konsekvent mot datat
		const total = BF.getTotalRows();

		// Om vi inte ens har >10 => tvinga minimerat läge + sida 1
		if (total <= BF.UI.COLLAPSED_LIMIT) {
			BF.state.expanded = false;
			BF.state.page = 1;
		}

		// Om expanded men inget att paginera längre => sida 1 är ok
		BF.ensurePageInRange();

		BF.updateFooterUI();
	};

	// =========================================================================
	// SETTINGS UI – PRIORITIES
	// =========================================================================
	BF.renderPrioSettings = function () {
		const host = document.getElementById("bf-readup-prio-list");
		if (!host) return;

		const prios = BF.runtime.settings?.prio_levels || [];
		const prefs = BF.runtime.preferences || {};
		const visible = new Set(prefs.visible_prios || []);

		host.innerHTML = "";

		prios.forEach(p => {
			const locked =
				BF.runtime.settings.mark_as_read_max_rank > 0 &&
				p.rank < BF.runtime.settings.mark_as_read_max_rank;

			const label = document.createElement("label");
			label.className = "bf-prio-setting";

			label.innerHTML = `
				<input type="checkbox"
							 data-prio-key="${p.key}"
							 ${visible.has(p.key) || locked ? "checked" : ""}
							 ${locked ? "disabled" : ""}>
				<span class="bf-prio-icon">${p.icon}</span>
				<span class="bf-prio-label">${p.label}</span>
 			${locked ? `<span class="bf-prio-locked">${BF.locales?.common.locked || "(locked)"}</span>` : ""}
			`;

			host.appendChild(label);
		});
	};

	function BF_bootstrapPreferencesIfMissing(json) {
		if (!json) return Promise.resolve(json);

		const prefs = json.preferences;

		const missing =
			!prefs ||
			(typeof prefs === "object" && Object.keys(prefs).length === 0);

		if (!missing) {
			return Promise.resolve(json);
		}

		const defaults = {};

		// Alla prios synliga som default
		if (Array.isArray(json.settings?.prio_levels)) {
			defaults.visible_prios = json.settings.prio_levels.map(p => p.key);
		}

		// Dölj INTE stängda som default
		defaults.hide_closed_issues = false;

		return postForm(`${BF_APP_ROOT}bf_readup/preferences`, defaults)
			.then(resp => {
				json.preferences = resp.preferences || {};
				return json;
			});
	}

	// =========================================================================
	// 6) LOAD DATA (guard mot dubbel fetch + loading-indikator)
	// =========================================================================
	BF.loadData = function () {
		if (BF.__mypage.loading) return;
		BF.__mypage.loading = true;
		BF.setUpdatesLoading(true);
		const debug = BF.isDebugEnabled();
		
		const syncBtn = document.querySelector(`.${BF_WIDGET_PREFIX}-sync`);
		if (syncBtn) syncBtn.classList.add("is-loading");

		post(`${BF_APP_ROOT}bf_readup/updates`, { debug: debug ? 1 : 0 })
			.then(json => BF_bootstrapPreferencesIfMissing(json))
			.then(json => {
				if (!json || !json.rows) {
					console.error("BF Readup: Bad JSON payload", json);
					return;
				}

				localStorage.setItem("bf_readup_last_load", Date.now().toString());
				BF.updateSyncButtonTooltip();
				BF.saveCachedData(json);

				BF.columns = json.columns || [];
								
				const newSettings = json.settings || {};
				const oldSettings = BF.runtime.settings || {};

				const policyChanged =
					newSettings.mark_as_read_max_rank !== oldSettings.mark_as_read_max_rank;

				BF.runtime.settings    = newSettings;
				BF.runtime.preferences = json.preferences || {};
				// Nollställ render ENDAST första gången prefs anländer
				if (!BF.__mypage.prefsLoaded) {
					BF.__mypage.hasRendered = false;
					BF.__mypage.prefsLoaded = true;
				}
				const hideClosed = document.getElementById("bf-hide-closed");
				if (hideClosed) {
					hideClosed.checked = BF.runtime.preferences.hide_closed_issues === true;
				}

				BF.renderPrioSettings();
				BF.cacheElements();
				
				// --------------------------------------------------------------
				// APPLY USER FILTERS EARLY (single source of truth)
				// --------------------------------------------------------------
				const rawRows = json.rows || [];

				BF.rows = BF.isDebugEnabled()
					? rawRows
					: BF.applyUserFilters(rawRows);

	
				// Indexera senaste synliga journal per issue
				BF.runtime.latestJournalByIssue = {};

				BF.rows.forEach(row => {
					if (row.journal_authors && row.journal_authors.length) {
						const last = row.journal_authors[row.journal_authors.length - 1];
						if (last && last.journal_id) {
							BF.runtime.latestJournalByIssue[String(row.id)] = last.journal_id;
						}
					}
				});

				// Uppdatera footer/state baserat på nya rader
				BF.applyView();
				BF.updateMasterCheckboxState();
				
				// --------------------------------------------------------------
				// EMPTY RESULT SHORT-CIRCUIT
				// --------------------------------------------------------------
				if (BF.rows.length === 0) {
					BF.renderTable();          // korrekt header
					BF.updateHeaderCount();    // visar 0
					BF.updateEmptyState();     // visar tom-state
					BF.updateFooterUI();       // göm expand/pagination
					BF.updateBulkReadButtonState();
					BF.__mypage.hasRendered = true;
					return;
				}
				const visible = BF.getVisibleRows();

				if (!BF.__mypage.hasRendered || policyChanged) {
					BF.renderTable();
					BF.__mypage.hasRendered = true;
				} else {
					BF.patchTable(visible);
				}

				BF.updateHeaderCount();
				BF.updateEmptyState();
				BF.updateBulkReadButtonState();

				if (debug) console.log("BF DEBUG PAYLOAD:", json);
			})
			.catch(err => {
				console.error("BF Readup load failed:", err);
			})
			.finally(() => {
				BF.__mypage.loading = false;
				
				const syncBtn = document.querySelector(`.${BF_WIDGET_PREFIX}-sync`);
				if (syncBtn) syncBtn.classList.remove("is-loading");
				
				BF.setUpdatesLoading(false);
			});
	};

  // =========================================================================
  // 7) RENDER TABLE
  // =========================================================================
	
// OBS: renderTable används ENDAST vid initial render.
// Alla uppdateringar efter detta ska ske via patchTable().

  BF.renderTable = function () {
    const thead = BF.el.thead;
    const tbody = BF.el.tbody;
    const rows = BF.getVisibleRows();
    const cols  = BF.columns || [];

    if (!thead || !tbody) return;

    // HEADER
    let thHtml = "<tr>";

    thHtml += `
      <th class="checkbox hide-when-print">
        <input type="checkbox" id="bf-check-all">
      </th>
    `;

    cols.forEach(col => {
      const key = col.key;
      const label = BF.locales?.columns?.[key] || col.label || "";
      const thClass = key === "prio" ? "bf-prio bf-col-prio" : key;

      thHtml += `
        <th class="${thClass}">
          <a title="${label}">
            <svg class="s18 icon-svg"><use href="${BF_APP_ROOT}assets/icons-903cd898.svg#icon--"></use></svg>
            <span class="icon-label">${label}</span>
          </a>
        </th>
      `;
    });

    thHtml += "</tr>";
    thead.innerHTML = thHtml;

    // BODY
    let bodyHtml = "";

		const baseIndex = BF.state.expanded
			? (BF.state.page - 1) * BF.UI.EXPANDED_PER_PAGE
			: 0;

    rows.forEach((row, index) => {

			const globalIndex = baseIndex + index;

			let trClasses = [
				"issue",
				globalIndex % 2 === 0 ? "odd" : "even",
        row.is_closed ? "closed" : "",
				row.allowed_to_mark_as_read === false ? "bf-readup-locked" : "",
        row.tracker_id       ? `tracker-${row.tracker_id}` : "",
        row.status_id        ? `status-${row.status_id}` : "",
        row.priority_id      ? `priority-${row.priority_id}` : "",
        row.overdue          ? "overdue" : "",
        row.behind_schedule  ? "behind-schedule" : "",
        row.created_by_me    ? "created-by-me" : "",
        row.assigned_to_me   ? "assigned-to-me" : ""
      ].filter(Boolean).join(" ");

      let tr = `<tr id="issue-${row.id}" class="${trClasses}">`;

      // Checkbox
			const disabled = row.allowed_to_mark_as_read === false;

			tr += `
				<td class="checkbox">
				<input type="checkbox"
							 value="${row.id}"
							 ${disabled ? `disabled title='${BF.locales?.common.cannot_mark_as_read || "Cannot be marked as read"}'` : ""}>

				</td>
			`;

      // Data cells
      cols.forEach(col => {
        tr += BF.renderCell(row, col);
      });

      tr += "</tr>";
      bodyHtml += tr;

      // DEBUG ROW (bevarad)
      if (row.debug) {
        bodyHtml += `
          <tr class="bf-debug-row" data-issue-id="${row.id}">
            <td></td>
            <td colspan="${cols.length}">
              <pre style="white-space:pre-wrap; background:#111; color:#5f5; padding:8px; font-size:11px;">
${JSON.stringify(row.debug, null, 2)}
              </pre>
            </td>
          </tr>
        `;
      }
    });

    tbody.innerHTML = bodyHtml;
		
		BF.el.tbody.querySelectorAll("tr.issue").forEach(tr => {
			const id = tr.id.replace("issue-", "");
			const row = BF.rows.find(r => String(r.id) === id);
			if (row) BF.ensureMarkAsReadButton(tr, row);
		});

    // SELECT ALL (binds på nytt efter render, men bara lokalt på nya DOM)
    const checkAll = document.getElementById("bf-check-all");
    if (checkAll) {
			checkAll.addEventListener("change", function () {
				tbody
					.querySelectorAll("tr.issue input[type='checkbox']:not(:disabled)")
					.forEach(cb => {
						cb.checked = checkAll.checked;
					});

				BF.updateMasterCheckboxState();
				BF.updateBulkReadButtonState();
			});

      const checkboxTh = thead.querySelector("th.checkbox");
      if (checkboxTh) {
        checkboxTh.addEventListener("click", function (e) {
          if (e.target === checkAll) return;
          e.preventDefault();
          checkAll.checked = !checkAll.checked;
          checkAll.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
    }
		
		window.dispatchEvent(new CustomEvent("bf-readup-rendered"));
  };

  // =========================================================================
  // 8) INDEXING ROWS
  // =========================================================================
	BF.indexExistingRows = function () {
		const map = new Map();
		if (!BF.el || !BF.el.tbody) return map;

		BF.el.tbody.querySelectorAll("tr.issue").forEach(tr => {
			const id = tr.id && tr.id.replace("issue-", "");
			if (id) map.set(id, tr);
		});

		return map;
	};

  // =========================================================================
  // 9) PATCH TABLE
  // =========================================================================
	
// IMPORTANT:
// All row ordering/indexing MUST operate on `tr.issue` only.
// `bf-debug-row` is always treated as a dependent row.

	BF.patchTable = function (newRows) {
		const tbody = BF.el.tbody;
		if (!tbody) return;

		const timings = BF.VISUAL_TIMINGS;

		const existing = BF.indexExistingRows();
		const seen = new Set();

		const toRemove = [];
		const toUpdate = [];
		const toMove   = [];

		// --------------------------------------------------
		// 9.1) Första mätning (FLIP start)
		// --------------------------------------------------
		const firstRects = new Map();
		existing.forEach((tr, id) => {
			firstRects.set(id, tr.getBoundingClientRect());
		});

		// --------------------------------------------------
		// 9.2) Patch + bygg korrekt DOM-ordning
		// --------------------------------------------------
		newRows.forEach((row, index) => {
			const id = String(row.id);
			let tr = existing.get(id);

			if (!tr) {
				tr = BF.insertRow(row, index);
			} else {
				BF.patchRow(tr, row);
				BF.ensureMarkAsReadButton(tr, row);

				toUpdate.push(tr);

				const issueRows = tbody.querySelectorAll("tr.issue");
				const current = issueRows[index];
				if (current !== tr) {
					tbody.insertBefore(tr, current || null);
					const debugRow = tr.nextElementSibling;
					if (debugRow && debugRow.classList.contains("bf-debug-row")) {
						tbody.insertBefore(debugRow, tr.nextSibling);
					}
					toMove.push(tr);
				}
			}

			seen.add(id);
		});

		// --------------------------------------------------
		// 9.3) Identifiera borttag
		// --------------------------------------------------
		existing.forEach((tr, id) => {
			if (tr.classList.contains("bf-debug-row")) return;
			if (!seen.has(id)) {
				toRemove.push(tr);
			}
		});

		// --------------------------------------------------
		// 9.4) STEG 1 – dimma borttagna rader
		// --------------------------------------------------
		toRemove.forEach(tr => {
			tr.classList.add("bf-row-pending-remove");
		});

		// --------------------------------------------------
		// 9.5) Bygg indexkartor (för semantisk flytt)
		// --------------------------------------------------
		const oldIndex = new Map();
		[...existing.keys()].forEach((id, i) => oldIndex.set(id, i));

		const newIndex = new Map();
		newRows.forEach((row, i) => newIndex.set(String(row.id), i));
		
		// --------------------------------------------------
		// 9.6–9.9 körs EFTER att celluppdateringar visats
		// --------------------------------------------------
		setTimeout(() => {

			// --------------------------------------------------
			// 9.6) STEG 3 – FLIP (flytta rader, semantiskt)
			// --------------------------------------------------
			requestAnimationFrame(() => {
				toMove.forEach(tr => {
					const id = tr.id.replace("issue-", "");

					const first = firstRects.get(id);
					if (!first) return;

					const last = tr.getBoundingClientRect();
					const dy = first.top - last.top;

					const prevIndex = oldIndex.get(id);
					const nextIndex = newIndex.get(id);

					// Endast verklig, semantisk flytt
					if (
						prevIndex == null ||
						nextIndex == null ||
						prevIndex === nextIndex ||
						dy === 0
					) return;

					tr.style.transform = `translateY(${dy}px)`;
					tr.style.transition = "none";

					if (nextIndex < prevIndex) {
						tr.classList.add("bf-row-moved-up");
					} else {
						tr.classList.add("bf-row-moved-down");
					}

					requestAnimationFrame(() => {
						tr.style.transition = "transform 400ms ease";
						tr.style.transform = "";

						setTimeout(() => {
							tr.classList.remove("bf-row-moved-up", "bf-row-moved-down");
						}, timings.FLIP);
					});
				});
			});

			// --------------------------------------------------
			// 9.7) STEG 4 – rad uppdaterad-indikering
			// --------------------------------------------------
			setTimeout(() => {
				toUpdate.forEach(tr => {
					tr.classList.add("bf-row-updated");
					setTimeout(
						() => tr.classList.remove("bf-row-updated"),
						timings.ROW_FLASH
					);
				});
			}, timings.FLIP);

			// --------------------------------------------------
			// 9.8) STEG 5 – kollapsa borttagna rader
			// --------------------------------------------------
			setTimeout(() => {
				toRemove.forEach(tr => {
					tr.style.height = `${tr.offsetHeight}px`;
					tr.offsetHeight; // force reflow
					tr.classList.add("bf-row-collapse");
				});
			}, timings.FLIP + timings.ROW_FLASH);

			// --------------------------------------------------
			// 9.9) STEG 6 – fysisk borttagning
			// --------------------------------------------------
			setTimeout(() => {
				toRemove.forEach(tr => {
					const debugRow = tr.nextElementSibling;
					if (debugRow && debugRow.classList.contains("bf-debug-row")) {
						debugRow.remove();
					}
					tr.remove();
				});
				window.dispatchEvent(new CustomEvent("bf-readup-rendered"));
			}, timings.FLIP + timings.ROW_FLASH + timings.COLLAPSE);

		}, timings.DIM + timings.CELL);
		
		BF.applyView();
		BF.updateMasterCheckboxState();
	};

  // =========================================================================
  // 10) INSERT ROW
  // =========================================================================

	BF.insertRow = function (row, index) {
		const tbody = BF.el.tbody;
		const tr = document.createElement("tr");

		tr.id = `issue-${row.id}`;
		tr.className = "issue bf-row-enter";

		tr.innerHTML = BF.buildRowHTML(row);

		const issueRows = tbody.querySelectorAll("tr.issue");

		if (index >= issueRows.length) {
			tbody.appendChild(tr);
		} else {
			tbody.insertBefore(tr, issueRows[index]);
		}

		// Låt View Customize hinna dekorera
		requestAnimationFrame(() => {
			BF.patchRow(tr, row);   // patchar endast text/klasser
			BF.ensureMarkAsReadButton(tr, row);
			tr.classList.add("bf-row-enter-active");
			tr.classList.remove("bf-row-enter");
		});

		return tr;
	};

  // =========================================================================
  // 11) PATCH ROW
  // =========================================================================
	
// OBS:
// patchRow får ALDRIG skriva td.innerHTML eller td.textContent generellt.
// Vi patchar endast de textnoder vi explicit äger,
// annars förstör vi View Customize / tredjeparts-dekorationer.

	BF.patchRow = function (tr, row) {
		let rowChanged = false;

		// ----------------------------------------------------
		// 11.1) Synka radklasser från serverstate
		// ----------------------------------------------------
		Object.entries(BF.SYNCED_ROW_CLASSES).forEach(([cls, predicate]) => {
			const shouldHave = !!predicate(row);

			if (shouldHave && !tr.classList.contains(cls)) {
				tr.classList.add(cls);
				rowChanged = true;
			}

			if (!shouldHave && tr.classList.contains(cls)) {
				tr.classList.remove(cls);
				rowChanged = true;
			}
		});

		// ----------------------------------------------------
		// 11.1.5) Synka deterministiska ID-klasser
		// ----------------------------------------------------
		const wanted = new Set(BF.getDeterministicRowClasses(row));

		[...tr.classList].forEach(cls => {
			if (
				cls.startsWith("tracker-") ||
				cls.startsWith("status-") ||
				cls.startsWith("priority-")
			) {
				if (!wanted.has(cls)) {
					tr.classList.remove(cls);
				}
			}
		});

		wanted.forEach(cls => {
			if (!tr.classList.contains(cls)) {
				tr.classList.add(cls);
			}
		});

		// ----------------------------------------------------
		// 11.2) Patch cellinnehåll
		// ----------------------------------------------------
		BF.columns.forEach(col => {
			const key = col.key;
			let td;

			// ------------------------------
			// PRIO: patcha textContent (cell ägs av BF)
			// ------------------------------

			if (key === "prio") {
				td = tr.querySelector("td.bf-col-prio");
				if (!td) return;

				const newVal   = row.prio ?? "";
				const newTitle = row.prio_label ?? "";

				let changed = false;

				if (td.textContent !== newVal) {
					td.textContent = newVal;
					changed = true;
				}

				if (td.getAttribute("title") !== newTitle) {
					td.setAttribute("title", newTitle);
					changed = true;
				}

				if (changed) {
					td.classList.add("bf-cell-updated");
					setTimeout(() => td.classList.remove("bf-cell-updated"), 1200);
				}

				return;
			}
			
			td = tr.querySelector(`td.${key}`);
			if (!td) return;

			// ------------------------------
			// SUBJECT: patcha endast texten i <a>
			// ------------------------------
			if (key === "subject") {
				const a = td.querySelector("a");
				if (!a) return;

				const newText = row.subject ?? "";
				if (a.firstChild && a.firstChild.nodeType === Node.TEXT_NODE) {
					if (a.firstChild.nodeValue !== newText) {
						a.firstChild.nodeValue = newText;
						rowChanged = true;
					}
				}
				return;
			}
			
			// ------------------------------
			// ID: samma princip
			// ------------------------------
			if (key === "id") {
				const a = td.querySelector("a");
				if (!a) return;

				const newText = String(row.id);
				if (a.textContent !== newText) {
					a.textContent = newText;
					rowChanged = true;
				}
				return;
			}

			// ------------------------------
			// PROJECT: patcha endast texten i <a>
			// (lämna ev. ikoner/dekorationer orörda)
			// ------------------------------
			if (key === "project") {
				const link =
					td.querySelector("a.bf-project-link") ||
					td.querySelector("a[href*='/projects/']");

				if (!link) return;

				const newText = row.project ?? "";
				let changed = false;

				if (link.textContent !== newText) {
					link.textContent = newText;
					changed = true;
				}

				if (row.project_parents && row.project_parents.length) {
					const title = [
						...row.project_parents.map(p => p.name),
						newText
					].join(" » ");

					if (td.getAttribute("title") !== title) {
						td.setAttribute("title", title);
						changed = true;
					}
				}

				if (changed) {
					td.classList.add("bf-cell-updated");
					setTimeout(() => td.classList.remove("bf-cell-updated"), 1200);
				}

				return;
			}

			// ------------------------------
			// READ_AGO / ACTIVITY_AGO
			// ------------------------------
			if (key === "read_ago" || key === "activity_ago") {
				const iso =
					key === "read_ago"
						? row.last_read_at_iso
						: row.last_activity_at_iso;

				const text =
					key === "read_ago"
						? (row.last_read_at_text ? BF.humanTimeAgo(iso) : "—")
						: (row.last_activity_at_text ? BF.humanTimeAgo(iso) : "—");

				const title =
					key === "read_ago"
						? (row.last_read_at_text || "")
						: (row.last_activity_at_text || "");

				// PATCHA ENDAST TEXTNOD
				if (td.textContent !== text) {
					td.textContent = text;
				}

				if (title && td.getAttribute("title") !== title) {
					td.setAttribute("title", title);
				}

				return;
			}
						
			// ------------------------------
			// NEW_COUNT: uppdatera siffra + tooltip
			// ------------------------------
			if (key === "new_count") {
				const newVal   = row.new_count ?? "";
				const authors  = row.new_authors || [];
				const newTitle = authors.length ? authors.join("\n") : "";

				if (td.textContent !== String(newVal)) {
					td.textContent = newVal;
				}

				if (td.getAttribute("title") !== newTitle) {
					td.setAttribute("title", newTitle);
				}

				return;
			}
			
			// ------------------------------
			// UPDATED_BY: patcha textContent med NBSP (förhindra radbrytning)
			// ------------------------------
			if (key === "updated_by") {
				const newVal = BF.nbspName(row.updated_by ?? "");

				if (td.textContent !== newVal) {
					td.textContent = newVal;

					td.classList.add("bf-cell-updated");
					setTimeout(() => td.classList.remove("bf-cell-updated"), 1200);

					rowChanged = true;
				}

				return;
			}

			// ------------------------------
			// Övriga celler: patcha ENDAST BF-ägda celler
			// ------------------------------
			if (td.dataset.bfOwned === "true" && td.children.length === 0) {
				const newValue = row[key] ?? "";
				if (td.textContent !== String(newValue)) {
					td.textContent = newValue;

					td.classList.add("bf-cell-updated");
					setTimeout(() => td.classList.remove("bf-cell-updated"), 1200);

					rowChanged = true;
				}
			}

		});

		// ----------------------------------------------------
		// 11.3) Synka "Markera som läst"-knappen
		// ----------------------------------------------------
		const btn = tr.querySelector(".bf-mark-read-btn");

		if (row.allowed_to_mark_as_read === false) {
			// Ska INTE få markeras → ta bort knapp om den finns
			if (btn) {
				btn.remove();
				tr.__bfHasMarkReadBtn = false;
			}
		} else {
			// Ska få markeras → säkerställ att knapp finns
			BF.ensureMarkAsReadButton(tr, row);
		}

	};

  // =========================================================================
  // 12) REMOVE ROW
  // =========================================================================
	BF.removeRow = function (tr) {
		if (!tr) return;

		tr.classList.add("bf-row-pending-remove");

		// matchar kollaps-logiken i patchTable
		setTimeout(() => {
			tr.style.height = `${tr.offsetHeight}px`;
			tr.offsetHeight; // force reflow
			tr.classList.add("bf-row-collapse");
		}, 50);

		setTimeout(() => {
			tr.remove();
		}, BF.VISUAL_TIMINGS.COLLAPSE + 100);
	};

  // =========================================================================
  // 13) BUILD ROW HTML
  // =========================================================================
	BF.buildRowHTML = function (row) {
		const disabled = row.allowed_to_mark_as_read === false;

		let html = `
			<td class="checkbox">
			<input type="checkbox"
						 value="${row.id}"
						 ${disabled ? `disabled title='${BF.locales?.common.cannot_mark_as_read || "Cannot be marked as read"}'` : ""}>
			</td>
		`;

		BF.columns.forEach(col => {
			html += BF.renderCell(row, col);
		});

		return html;
	};

  // =========================================================================
  // 14) BOOTSTRAP (Turbo-safe)
  // =========================================================================
	function boot() {
		BF.init();

		// Starta bakgrundspolling
		BF.startPolling();
		BF.startSyncTooltipTimer();

		if (!BF.__mypage.humanTimerStarted) {
			BF.__mypage.humanTimerStarted = true;

			setInterval(() => {
				if (!BF.el || !BF.el.tbody) return;

				const rowIndex = new Map();
				BF.rows.forEach(r => rowIndex.set(String(r.id), r));

				BF.el.tbody.querySelectorAll("tr.issue").forEach(tr => {
					const id = tr.id.replace("issue-", "");
					const row = rowIndex.get(id);
					if (!row) return;

					["read_ago", "activity_ago"].forEach(key => {
						const td = tr.querySelector(`td.${key}`);
						if (!td) return;

						const iso =
							key === "read_ago"
								? row.last_read_at_iso
								: row.last_activity_at_iso;

						const text = BF.humanTimeAgo(iso);
						if (td.textContent !== text) {
							td.textContent = text;
						}
					});
				});
			}, 60 * 1000);
		}

		// Direkt refresh om vi återkommer efter lång tid
		if (BF.shouldAutoRefresh()) {
			BF.loadData();
		}
	}

  // Classic
  document.addEventListener("DOMContentLoaded", boot);

  // Turbo (om det finns)
  document.addEventListener("turbo:load", boot);
  document.addEventListener("turbo:render", boot);
  document.addEventListener("turbo:frame-load", boot);
})();
