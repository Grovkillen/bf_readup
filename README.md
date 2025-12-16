# BF Readup

BF Readup is a Redmine plugin that tracks **reading behavior per user and per issue** and presents this data in clear, actionable views on *My Page*.

Unlike traditional “read/unread” solutions based on status flags or timestamps, BF Readup is built around **actual user interaction**:
- when an issue is opened
- how long it is viewed
- which journals were actually visible
- when the user can be proven to have seen the latest change

The result is a far more accurate representation of what is genuinely *new to you*.

---

## Widgets

### Updates since you last read

![Updates since last read](bf_readup/doc/bf_readup_updates.png)

Shows issues with new activity since you last confirmed reading them.  
Issues are prioritized using rule-based logic that takes roles, mentions, history, and system policies into account.

The column set and column order in this view are currently **hard-coded by design**.  
While the order is expected to remain stable, future versions may allow users to hide individual columns via personal settings.

---

### Recently visited issues

![Recently visited issues](bf_readup/doc/bf_readup_more_recent.png)

The screenshot shows both the **Recently visited** and **Most read** widgets side by side.

These widgets intentionally display fewer columns than the *Updates since you last read* widget.  
They focus on interaction history and reading time rather than change analysis, and the column sets are therefore deliberately different.

---

### Most read issues

![Most read issues](bf_readup/doc/bf_readup_more_recent.png)

Shows where time is actually spent, based on accumulated reading time per issue.

---

### My Page widget selection

![My Page dropdown](bf_readup/doc/bf_readup_mypage_dropdown.png)

BF Readup widgets integrate directly into Redmine’s *My Page* and can be freely combined with standard widgets.

---

## Features at a glance

- **Updates since you last read**
  - Prioritized list of issues with new changes
  - Shows number of new entries and their authors
  - Manual and bulk “mark as read”
  - Policy-based restrictions on what can be marked as read

- **Recently read issues**
  - When you actually last read the issue
  - Sorted by real interaction, not metadata

- **Most read issues**
  - Time-based statistics per user
  - Shows where attention is actually spent

- **Advanced priority rules**
  - Rule-based priority engine
  - Supports roles (assigned, author, watcher, mentioned)
  - Custom Field matchers (e.g. matching user email)

- **Debug mode**
  - Shows raw data, decision logic, and filter results
  - Local only via LocalStorage

---

## Priority rules and filters

![Priority filters](bf_readup/doc/bf_readup_updates_settings.png)

Users can control which prioritization rules are active, while system policies may enforce mandatory rules that cannot be disabled.

---

## Administration and settings

![Admin settings](bf_readup/doc/bf_readup_admin_settings.png)

Administrators can configure:
- heartbeat interval
- lookback period
- maximum priority allowed for “mark as read”
- full priority rule ordering
- custom field matchers

### Custom Field usage (Initiator concept)

Internally, BF Readup uses a **Custom Field matcher** to identify the *initiator* of an issue.

This is based on an internal custom field that represents the person who initiated the issue, which may differ from the user who technically created it in Redmine.

Key characteristics of this setup:
- the initiator field is **separate from Redmine’s user list**
- it may contain values for people without system accounts
- the field is kept **synchronized**, but not coupled, to Redmine users
- this allows external participants or non-logged-in staff to be treated as first-class initiators

This approach reflects real-world workflows where the originator of work is not always the same person who registers the issue in the system.

---

## Architecture overview

BF Readup consists of three main parts:

### Backend (Ruby / Rails)
- `bf_readup_visits` table for tracking read interactions
- A QueryEngine that determines:
  - what is new
  - what is prioritized
  - what is allowed to be marked as read
- Full interaction history stored in `extra_data`

### Frontend (Vanilla JavaScript)
- Turbo-safe initialization
- Diff-based rendering (FLIP-inspired)
- LocalStorage caching for performance
- Time-based columns updated dynamically

### UI integration
- My Page blocks (Updates / Recent / Most)
- Issue view (heartbeat + journal detection)
- Admin UI for rules and settings

---

## Database dependencies (IMPORTANT)

⚠️ **The current codebase uses explicit PostgreSQL features.**

Specifically:
- `extra_data` is stored as **jsonb**
- Indexing is done using **GIN indexes**
- Certain “mark as read” operations are optimized for PostgreSQL

➡️ This means the plugin is **not fully compatible with other databases** (such as MySQL) at this time.

### Intended handling
The intention is to:
- internally detect the active database engine
- automatically **disable PostgreSQL-specific optimizations** when unavailable
- allow the plugin to run in a degraded but functional mode where reasonable

This is **not yet implemented**, but it is an explicit design intention.

---

## Language disclaimer (IMPORTANT)

⚠️ **The plugin UI is currently hard-coded in Swedish.**

At this stage:
- all labels, texts, and messages are written in Swedish
- no locale switching is available
- this is a deliberate choice based on internal usage

### Planned work
- migrate all UI strings to `config/locales`
- enable proper internationalization
- keep Swedish as a first-class language

---

## Project intention and scope

BF Readup is:
- ❌ **not a commercial plugin**
- ❌ **not a community-driven roadmap project**
- ❌ **not designed for maximum general compatibility**

It is instead:
- ✅ an **internal tool** developed alongside a Redmine rollout
- ✅ a practical solution to real, day-to-day needs
- ✅ an open codebase that others are welcome to learn from

I am explicit that:
- the project evolves based on my and my company’s needs
- users “follow along” with the project’s direction, not the other way around
- third-party demands on roadmap or direction are not accepted

💡 **Good ideas, improvements, and bug fixes are always welcome.**

---

## AI as a co-creator

This project was developed with **ChatGPT as a co-creator**.

This is:
- openly acknowledged
- a deliberate part of the development workflow
- not hidden or downplayed

Architecture, implementation, and decisions are always **human-reviewed and intentional**.

---

## License and usage

No formal license has been defined yet.

Until then:
- use the code at your own risk
- no guarantees are provided
- no long-term support commitments are implied

---

## Version

**bf_readup v0.0.10**

The codebase is active and continues to evolve, but always with internal usefulness as the primary driver.

---
