# init.rb

require_relative "lib/bf_readup/hooks"

# -------------------------------------------------------------------
# Plugin registration
# -------------------------------------------------------------------

Redmine::Plugin.register :bf_readup do
  name        "BF Readup"
  author      "Jimmy Westberg (Bracke Forest AB)"
  description "Tracking of read and unread changes in issues"
  version     "0.0.15"

  settings(
    default: {
      "heartbeat_interval_seconds" => 30,
      "lookback_days"              => 7,
      "expose_user_debug_option"   => 0,

    # complex default structures must be JSON strings
      "columns"                 => "[]",
      "prio_levels"             => "[]",
      "custom_field_matchers"   => "[]"
    },
    partial: "settings/bf_readup_admin_settings"
  )
end