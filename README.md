BF Readup (Redmine plugin)

Current version: 0.0.14

Overview
- Tracks which Redmine issues have unread changes for each user and prioritizes them.
- My Page widgets (Updates, Recent, Most) show a compact list with quick actions.
- Reading lifecycle: enter, ping, exit. Mirrors timestamps into extra_data (JSONB).
- Client telemetry: tab focus/visibility signals stored in extra_data.tab.
- Sync status indicator: shows when the widget last synced, persists via localStorage.

Screenshots and visuals (to be updated)
- [Image: Updates widget]
- [Image: Recent/Most widgets]
- [Image: Admin settings – priorities and general]

Reading lifecycle
- enter: sets first_entered_at (once), updates last_viewed_at and last_ping_at.
- ping: periodically updates last_ping_at and aggregates total_seconds.
- exit: updates last_viewed_at.
Mirrored into extra_data.session as:
- latest_enter_at, latest_ping_at, last_exit_at (ISO8601). Use latest_enter_at → latest_ping_at to derive latest session duration.

Client telemetry (extra_data.tab)
- in_focus (boolean), visibility (visible/hidden).
- last_focus_at, last_blur_at, last_visibility_change (ISO8601).
- Posted to bf_readup/telemetry; rate limited on the client.

Prioritization
- Factors include: assignee/author/watcher roles, mentions, historic states, and optional custom field matchers.
- Settings influence which items appear and their ranking.

Sync status UI
- "Synced X ago" (relative), "syncing…" during refresh, "delayed" if stale, "not synced yet" when none.
- Persists across reloads using localStorage key bf_readup_last_load.

Settings (Admin guide)
Location: Administration → Plugins → BF Readup → Configure
- heartbeat_interval_seconds: ping interval in seconds during reading.
- lookback_days: how far back to include updates.
- columns: JSON array of table columns (key + label).
- prio_levels: JSON array of priority levels. The Admin UI now enforces predefined keys/methods and ordering by drag-and-drop (rank = position).
- custom_field_matchers: JSON array of matcher rules. Here you may reference a custom priority key of your own; this is the only place where typing a key is expected.
- User preference: hide_closed_issues (some items may be enforced by policy).
Effects:
- Prioritization: prio_levels/custom_field_matchers shape badges and rank.
- Visibility/inclusion: lookback_days and hide_closed_issues filter the list.
- Icons/ranks/ordering: driven by priorities and recency.

Admin defaults and rigidity
- Load default priority list: Use the “Load default list” button to populate sensible defaults on first setup.
- Drag-and-drop ordering: Move rows to change rank. Rank is inferred from position (top = 1). No need to edit rank numbers.
- Predefined keys and methods: Priority “key” and “method” are selected from predefined values to prevent invalid configurations. Labels and icons remain editable.
- Debug checkbox visibility: A global toggle controls whether the “Debug” checkbox is visible in the user’s Updates widget settings.

Operational guidance
- Heartbeat: Keep ≥ 10 seconds (minimum supported is 3 seconds, but not recommended). Lower intervals increase server traffic.
- Lookback: Avoid very large values. After a long period of inactivity, a huge lookback can produce heavy fetches. Best practice is to keep up with the updates list.

Database requirement – PostgreSQL
- Required. Uses JSONB for extra_data and time-based querying patterns.
- Other databases are not supported.

Locales
- English and Swedish locales are included. Update config/locales/en.yml and sv.yml as needed.
 - Documentation and Admin UI labels reflect availability of locales.

Versioning
- init.rb defines the plugin version; ensure README matches before tagging.
- Current version: 0.0.14.

Backward compatibility
- Existing endpoints (enter/ping/exit) remain unchanged.
- New telemetry lives in extra_data only (no schema changes).

License
- See the root project license.