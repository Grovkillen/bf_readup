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
      prefix = Redmine::Utils.relative_url_root
      heartbeat = Setting.plugin_bf_readup['heartbeat_interval_seconds'].to_i

      tags  = +""
      tags << "<script>window.BF_READUP_ROOT = '#{prefix}/';</script>"
      tags << "<script>window.BF_READUP_HEARTBEAT = #{heartbeat};</script>"

      tags.html_safe
    end

    # ------------------------------------------------------------
    # 3. MyPage: inject widget JS
    # ------------------------------------------------------------
    def view_my_page_contextual(context = {})
      javascript_include_tag('bf_readup_updates', plugin: 'bf_readup')
    end

    # ------------------------------------------------------------
    # 4. Provide selected columns to widget renderer
    # ------------------------------------------------------------
    def view_my_page_block(context = {})
      return unless context[:block] == "bf_readup"

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

    # ------------------------------------------------------------
    # 5. Save settings from settings dialog in widget
    # ------------------------------------------------------------
    def controller_my_page_blocks_edit_before_save(context = {})
      return unless context[:block] == "bf_readup"

      # Detta kommer från <select name="bf_readup_columns[]">
      columns = context.dig(:params, :bf_readup_columns)

      if columns.is_a?(Array)
        User.current.pref[:bf_readup_columns] = columns.join(",")
        User.current.pref.save
      end
    end

  end
end
