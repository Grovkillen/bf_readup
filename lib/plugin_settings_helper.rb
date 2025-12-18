# lib/plugin_settings_helper.rb

require "yaml"

module PluginSettingsHelper
  def self.load_defaults(plugin_name)
    path = Rails.root.join("plugins", plugin_name, "config", "settings.yml")
    return {} unless File.exist?(path)

    raw = YAML.load_file(path) || {}
    Hash[
      raw.map { |key, cfg| [key.to_s, cfg["default"]] }
    ]
  end
end
