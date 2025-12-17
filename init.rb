# init.rb

require_relative "lib/bf_readup/hooks"

# -------------------------------------------------------------------
# Complex default settings (cannot live in settings.yml)
# -------------------------------------------------------------------

DEFAULT_COLUMNS = [
  { key: "prio",        label: "Type" },
  { key: "id",          label: "#" },
  { key: "project",     label: "Project" },
  { key: "subject",     label: "Issue" },
  { key: "updated_on",  label: "Updated" }
]

DEFAULT_PRIO_LEVELS = []
DEFAULT_CF_MATCHER  = []

# -------------------------------------------------------------------
# Plugin registration
# -------------------------------------------------------------------

Redmine::Plugin.register :bf_readup do
  name        "BF Readup"
  author      "Jimmy Westberg (Bracke Forest AB)"
  description "Tracking of read and unread changes in issues"
  version     "0.0.14"

  settings(
    default: {
      "heartbeat_interval_seconds" => 30,
      "lookback_days"              => 7,
      "expose_user_debug_option"   => 0,

    # complex default structures must be JSON strings
      "columns"                 => DEFAULT_COLUMNS.to_json,
      "prio_levels"             => DEFAULT_PRIO_LEVELS.to_json,
      "custom_field_matchers"   => DEFAULT_CF_MATCHER.to_json
    },
    partial: "settings/bf_readup_admin_settings"
  )
end