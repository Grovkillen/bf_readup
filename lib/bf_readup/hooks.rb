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

      # Expose a minimal i18n map to JavaScript for dynamic UI strings
      i18n = {
        show_more:                 l(:'bf_readup.common.show_more', default: 'Show more'),
        show_less:                 l(:'bf_readup.common.show_less', default: 'Show less'),
        next_label:                l(:'bf_readup.common.next_label', default: 'Next »'),
        previous_label:            l(:'bf_readup.common.previous_label', default: '« Previous'),
        issue:                     l(:'bf_readup.columns.issue', default: 'Issue'),
        project:                   l(:'bf_readup.columns.project', default: 'Project'),
        time_spent:                l(:'bf_readup.columns.time_spent', default: 'Time'),
        last_read:                 l(:'bf_readup.columns.last_read', default: 'Last read'),
        last_updated:              l(:'bf_readup.columns.last_updated', default: 'Last updated'),
        last_viewed:               l(:'bf_readup.columns.last_viewed', default: 'Last viewed'),
        tracker:                   l(:'bf_readup.columns.tracker', default: 'Tracker'),
        subject:                   l(:'bf_readup.columns.subject', default: 'Subject'),
        read_ago:                  l(:'bf_readup.columns.read_ago', default: 'Since I read'),
        mark_selected_require_selection: l(:'bf_readup.common.mark_selected_require_selection', default: 'Select at least one issue to use this action'),
        mark_selected_read:        l(:'bf_readup.common.mark_selected_read', default: 'Mark selected as read'),
        mark_as_read:              l(:'bf_readup.common.mark_as_read', default: 'Mark as read'),
        cannot_mark_as_read:       l(:'bf_readup.common.cannot_mark_as_read', default: "Can't be marked as read"),
        just_now:                  l(:'bf_readup.common.just_now', default: "just now")
      }

      tags << "<script>window.BF_READUP_I18N = #{i18n.to_json};</script>"

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

      # This comes from the settings form: <select name="bf_readup_columns[]">
      columns = context.dig(:params, :bf_readup_columns)

      if columns.is_a?(Array)
        User.current.pref[:bf_readup_columns] = columns.join(",")
        User.current.pref.save
      end
    end

  end
end
