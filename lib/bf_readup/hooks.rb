module BfReadup
  class Hooks < Redmine::Hook::ViewListener

    # ------------------------------------------------------------
    # 1. Issue show page: heartbeat + read-tracking JS
    # ------------------------------------------------------------
		def view_issues_show_details_bottom(context = {})
			javascript_include_tag('bf_readup', plugin: 'bf_readup')
		end

    # ------------------------------------------------------------
    # 2. Global HEAD inject: Root path + heartbeat interval
    # ------------------------------------------------------------
    def view_layouts_base_html_head(context = {})
      prefix    = Redmine::Utils.relative_url_root
      heartbeat = Setting.plugin_bf_readup['heartbeat_interval_seconds'].to_i

      i18n = I18n.t(:bf_readup, default: {}).deep_stringify_keys

      tags  = +""
      tags << javascript_tag("window.BF_READUP_ROOT = '#{prefix}/';")
      tags << javascript_tag("window.BF_READUP_HEARTBEAT = #{heartbeat};")
      tags << javascript_tag("window.BF_READUP_I18N = #{i18n.to_json};")

      tags
    end

    # ------------------------------------------------------------
    # 4. Provide selected columns to widget renderer
    # ------------------------------------------------------------
    def view_my_page_block(context = {})
      return unless context[:block] == "bf_readup_updates"

      prefs = User.current.pref[:bf_readup_columns]

      selected =
        if prefs.present?
          prefs.split(',').map(&:strip)
        else
          [] # Tom → JS fallback (alla kolumner)
        end

      context[:controller].instance_variable_set(
        :@bf_readup_selected_columns,
        selected
      )
    end
		
		def view_my_page_contextual(context = {})
			tags = +""

			tags << stylesheet_link_tag(
				'bf_readup_updates',
				'bf_readup_most',
				'bf_readup_recent',
				'bf_readup_most_global',
				plugin: 'bf_readup'
			)

			tags << javascript_include_tag(
				'bf_readup_core',
				'bf_readup_updates',
				'bf_readup_most',
				'bf_readup_recent',
				'bf_readup_most_read_global',
				plugin: 'bf_readup'
			)

			tags
		end

    # ------------------------------------------------------------
    # 5. Save settings from settings dialog in widget
    # ------------------------------------------------------------
    def controller_my_page_blocks_edit_before_save(context = {})
      return unless context[:block].to_s.start_with?("bf_readup_")

      # Detta kommer från <select name="bf_readup_columns[]">
      columns = context.dig(:params, :bf_readup_columns)

      if columns.is_a?(Array)
        User.current.pref[:bf_readup_columns] = columns.join(",")
        User.current.pref.save
      end
    end

  end
end
