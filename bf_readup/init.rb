# init.rb

require_relative "lib/bf_readup/hooks"

# -------------------------------------------------------------------
# Komplexa default-inställningar (kan inte ligga i settings.yml)
# -------------------------------------------------------------------

DEFAULT_COLUMNS = [
  { key: "prio",        label: "Typ" },
  { key: "id",          label: "#" },
  { key: "project",     label: "Projekt" },
  { key: "subject",     label: "Ärende" },
  { key: "updated_on",  label: "Uppdaterad" }
]

DEFAULT_PRIO_LEVELS = []
DEFAULT_CF_MATCHER  = []

# -------------------------------------------------------------------
# Plugin-registrering
# -------------------------------------------------------------------

Redmine::Plugin.register :bf_readup do
  name        "BF Readup"
  author      "Jimmy Westberg (Bracke Forest AB)"
  description "Spårning av lästa och olästa ändringar i ärenden"
  version     "0.0.10"

  settings(
    default: {
      "heartbeat_interval_seconds" => 30,
      "lookback_days"              => 7,

      # komplexa defaultstrukturer måste vara JSON-strängar
      "columns"                 => DEFAULT_COLUMNS.to_json,
      "prio_levels"             => DEFAULT_PRIO_LEVELS.to_json,
      "custom_field_matchers"   => DEFAULT_CF_MATCHER.to_json
    },
    partial: "settings/bf_readup_admin_settings"
  )
end