# lib/bf_readup/custom_field_matcher.rb
module BfReadup
  class CustomFieldMatcher
    class << self
      attr_accessor :rules
    end

    self.rules = []

    def self.load_rules
      cfg = Setting.plugin_bf_readup["cf_rules"]
      cfg = JSON.parse(cfg) if cfg.is_a?(String)
      self.rules = cfg || []
    end

    def self.match_key(issue, user)
      load_rules if rules.nil? || rules.empty?

      rules.each do |rule|
        cf = issue.custom_field_values
                  .select { |v| v.custom_field_id.to_i == rule["id"].to_i }
                  .first
        next unless cf

        text = cf.value.to_s.downcase
        case rule["match"]
        when "email"
          return rule["priority_key"] if text.include?(user.mail.downcase)
        when "login"
          return rule["priority_key"] if text.include?(user.login.downcase)
        when "name"
          return rule["priority_key"] if text.include?(user.name.to_s.downcase)
        end
      end

      nil
    end
  end
end
