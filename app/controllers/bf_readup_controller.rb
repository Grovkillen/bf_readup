# app/controllers/bf_readup_controller.rb
class BfReadupController < ApplicationController
  accept_api_auth :updates

  before_action :require_login
	skip_before_action :verify_authenticity_token, only: [:updates, :mark_as_read, :mark_all_as_read, :telemetry]

  # Dessa behövs inte för updates, därför exkluderade där
	before_action :find_issue,
		except: [
			:updates,
			:mark_as_read,
			:mark_all_as_read,
			:recently_read,
			:most_read,
			:preferences
		]

	before_action :find_visit,
		except: [
			:updates,
			:mark_as_read,
			:mark_all_as_read,
			:recently_read,
			:most_read,
			:preferences
		]

  # --------------------------------------------------------------------------
  # DEFAULT COLUMN DEFINITION (fallback)
  # --------------------------------------------------------------------------
  DEFAULT_COLUMNS = [
    { "key" => "prio",       "label" => "Type" },
    { "key" => "id",         "label" => "#" },
    { "key" => "project",    "label" => "Project" },
    { "key" => "tracker",    "label" => "Tracker" },
    { "key" => "status",     "label" => "Status" },
    { "key" => "subject",    "label" => "Subject" },
    { "key" => "updated_on", "label" => "Last updated" },
    { "key" => "read_ago",   "label" => "Since I read" },
    { "key" => "activity_ago", "label" => "Latest activity" },
    { "key" => "new_count",  "label" => "New" }
  ].freeze

  def columns
    DEFAULT_COLUMNS
  end

  # --------------------------------------------------------------------------
  # TIME TRACKING
  # --------------------------------------------------------------------------
  def enter
    @visit.first_entered_at ||= Time.now
    @visit.last_viewed_at    = Time.now
    @visit.last_ping_at      = Time.now
    @visit.last_journal_id   = params[:journal_id].to_i if params[:journal_id].present?
    # Mirror in extra_data for telemetry/derivation
    ed = @visit.extra_data || {}
    ed["session"] ||= {}
    ed["session"]["latest_enter_at"] = Time.current.utc.iso8601
    @visit.extra_data = ed
    @visit.save!
    render json: { status: "ok" }
  end

	def ping
		interval = Setting.plugin_bf_readup["heartbeat_interval_seconds"].to_i
		now      = Time.current

		@visit.last_ping_at = now
		@visit.total_seconds += interval

		# Mirror in extra_data
		ed = @visit.extra_data || {}
		ed["session"] ||= {}
		ed["session"]["latest_ping_at"] = now.utc.iso8601
		@visit.extra_data = ed

		if params[:journal_id].present?
			client_journal_id = params[:journal_id].to_i

			latest_visible_journal_id =
				@issue.journals
							.visible(User.current)
							.maximum(:id)

			if latest_visible_journal_id &&
				 client_journal_id == latest_visible_journal_id

				# Användaren är bevisligen på senaste synliga data
				@visit.last_viewed_at  = now
				@visit.last_journal_id = client_journal_id
			end
		end

		@visit.save!
		render json: { status: "ok" }
	end

  def exit
    @visit.last_viewed_at = Time.now
    # Mirror in extra_data
    ed = @visit.extra_data || {}
    ed["session"] ||= {}
    ed["session"]["last_exit_at"] = Time.current.utc.iso8601
    @visit.extra_data = ed
    @visit.save!
    render json: { status: "ok" }
  end

  # --------------------------------------------------------------------------
  # LIGHTWEIGHT TELEMETRY (tab focus/visibility)
  # --------------------------------------------------------------------------
  def telemetry
    # Expect JSON payload with keys under :data and require issue context
    payload = params[:data] || {}

    # Must have issue_id for visit context
    unless params[:issue_id].present?
      return render json: { status: "error", error: "issue_id required" }, status: :unprocessable_entity
    end

    # Build/find visit for current user/issue (no time side-effects)
    @issue = Issue.find(params[:issue_id])
    find_visit

    ed = @visit.extra_data || {}
    ed["tab"] ||= {}

    # in_focus: boolean
    if payload.key?(:in_focus) || payload.key?("in_focus")
      ed["tab"]["in_focus"] = truthy?(payload[:in_focus] || payload["in_focus"])
    end

    # visibility: 'visible' | 'hidden'
    if payload.key?(:visibility) || payload.key?("visibility")
      vis = (payload[:visibility] || payload["visibility"]).to_s
      ed["tab"]["visibility"] = %w[visible hidden].include?(vis) ? vis : ed["tab"]["visibility"]
    end

    # event timestamps
    evt = (payload[:event] || payload["event"])&.to_s
    now_iso = Time.current.utc.iso8601
    case evt
    when "focus"
      ed["tab"]["last_focus_at"] = now_iso
    when "blur"
      ed["tab"]["last_blur_at"] = now_iso
    when "visibilitychange"
      ed["tab"]["last_visibility_change"] = now_iso
    end

    @visit.extra_data = ed
    @visit.save!

    render json: { status: "ok" }
  end

  # --------------------------------------------------------------------------
  # MYPAGE ENDPOINT – HUVUDSVAR TILL FRONTEND
  # --------------------------------------------------------------------------
	def updates
		debug_mode = params[:debug].to_s == "1"

		payload = BfReadup::QueryEngine.changed_since_last_read(
			User.current,
			debug_mode
		)

		rows = payload[:rows].map do |u|
			issue = u[:issue]
			pr    = u[:prio]
			read_at = u[:last_read_at]

			allowed_to_mark =
				BfReadup::QueryEngine.allowed_to_mark_as_read?(
					issue,
					User.current,
					BfReadupVisit.find_by(user_id: User.current.id, issue_id: issue.id)
				)
				
			{
				id: issue.id,
				prio: pr[:icon],
				prio_rank: pr[:rank],
				prio_key: pr[:key],
				prio_label: pr[:label],

				project: issue.project&.name,
				project_identifier: issue.project&.identifier,

				project_parents: issue.project.ancestors.map do |p|
					{ id: p.id, name: p.name }
				end,

				tracker: issue.tracker&.name,
				tracker_id: issue.tracker_id,

				status: issue.status&.name,
				status_id: issue.status_id,
				is_closed: issue.closed?,

				priority_id: issue.priority_id,
				priority: issue.priority&.name,

				subject: issue.subject,
				updated_on: format_time(issue.updated_on),
				updated_on_iso: issue.updated_on&.iso8601,

				last_read_at_text: read_at ? format_time(read_at) : nil,
				last_read_at_iso: read_at&.iso8601,

				last_activity_at_text: u[:last_activity_at] ? format_time(u[:last_activity_at]) : nil,
				last_activity_at_iso: u[:last_activity_at]&.iso8601,

				author_id: issue.author_id,
				author_name: issue.author&.name,

				new_count: u[:new_count],
				new_authors: u[:new_authors],
				journal_authors: u[:journal_authors],

				created_by_me: issue.author_id == User.current.id,
				assigned_to_id: issue.assigned_to_id,
				assigned_to_name: issue.assigned_to&.name,
				assigned_to_me: issue.assigned_to_id == User.current.id,

				overdue: issue.due_date.present? && issue.due_date < Date.today,
				behind_schedule: safe_behind_schedule(issue),

				allowed_to_mark_as_read: allowed_to_mark,

				debug: u[:debug]
			}
		end

		render json: {
			status: payload[:status],
			settings: {
				limits: payload[:limits],
				mark_as_read_max_rank: Setting.plugin_bf_readup["mark_as_read_max_rank"].to_i,
				prio_levels: BfReadup::QueryEngine.load_prio_rules
			},
			preferences: User.current.pref&.others&.dig("bf_readup") || {},
			stats: payload[:stats],
			columns: columns,
			rows: rows
		}

	end

	def mark_as_read
		issue_id = params[:issue_id]
		user     = User.current

		return render_403 unless user&.logged?

		visit = BfReadupVisit.find_or_initialize_by(
			user_id:  user.id,
			issue_id: issue_id
		)

		issue = Issue.find(issue_id)

		unless BfReadup::QueryEngine.allowed_to_mark_as_read?(issue, user, visit)
			return render json: { status: "forbidden" }, status: 403
		end

		journal_id =
			if params[:journal_id].present?
				params[:journal_id].to_i
			else
				issue.journals
						 .visible(user)
						 .maximum(:id)
			end

			BfReadup::QueryEngine.apply_mark_as_read!(
				visit,
				journal_id,
				type: "manual"
			)

		render json: { status: "ok" }
	end

	def mark_all_as_read
		user = User.current
		return render_403 unless user&.logged?

		issue_ids = Array(params[:issue_ids]).map(&:to_i).uniq
		return render json: { status: "ok", marked_count: 0 } if issue_ids.empty?
		
		issues = Issue.where(id: issue_ids)
		marked_count = 0

		issues.each do |issue|
			visit = BfReadupVisit.find_or_initialize_by(
				user_id:  user.id,
				issue_id: issue.id
			)

			next unless BfReadup::QueryEngine.allowed_to_mark_as_read?(issue, user, visit)

			journal_id =
				issue.journals
						 .visible(user)
						 .maximum(:id)

			BfReadup::QueryEngine.apply_mark_as_read!(
				visit,
				journal_id,
				type: "bulk"
			)

			marked_count += 1
		end

		render json: {
			status: "ok",
			marked_count: marked_count
		}
	end

	def recently_read
		rows =
			BfReadup::QueryEngine.recently_read(User.current).map do |r|
				issue = r[:issue]

				serialize_issue(
					issue,
					last_read_at: r[:read_at]&.utc&.iso8601
				)
			end

		render json: {
			status: "ok",
			rows: rows
		}
	end

	def most_read
		rows =
			BfReadup::QueryEngine.most_read(User.current).map do |r|
				issue = r[:issue]

				serialize_issue(
					issue,
					total_seconds: r[:total_seconds],
					last_viewed_at: r[:last_viewed_at]&.utc&.iso8601
				)
			end

		render json: {
			status: "ok",
			rows: rows
		}
	end

	def preferences
		user = User.current
		return render_403 unless user&.logged?

		prefs = user.pref
		data  = prefs.others["bf_readup"] || {}

		# ------------------------------------------------------------
		# READ ONLY (ingen payload)
		# ------------------------------------------------------------
		if request.request_method_symbol == :get || params.blank?
			return render json: {
				status: "ok",
				preferences: data
			}
		end

		# ------------------------------------------------------------
		# WRITE
		# ------------------------------------------------------------
		data ||= {}

		if params.key?(:visible_prios)
			visible_prios = Array(params[:visible_prios]).map(&:to_s)

			valid_keys =
				BfReadup::QueryEngine
					.load_prio_rules
					.map { |p| p["key"] }

			visible_prios.select! { |k| valid_keys.include?(k) }

			data["visible_prios"] = visible_prios
		end

		if params.key?(:hide_closed_issues)
			data["hide_closed_issues"] =
				params[:hide_closed_issues] == true ||
				params[:hide_closed_issues] == "true"
		end

		prefs.others["bf_readup"] = data
		prefs.save!

	end

  # --------------------------------------------------------------------------
  private
  # --------------------------------------------------------------------------

  def find_issue
    @issue = Issue.find(params[:issue_id])
  end

  def find_visit
    @session_id = params[:session_id] || "default"

    @visit = BfReadupVisit.find_or_initialize_by(
      user_id:  User.current.id,
      issue_id: @issue.id
    )
  end

  def truthy?(val)
    val == true || val.to_s == "true" || val.to_s == "1"
  end

  def safe_behind_schedule(issue)
    issue.done_ratio.to_i < issue.percent_for_due_date.to_i
  rescue
    false
  end
	
	def serialize_issue(issue, extra = {})
		{
			id: issue.id,

			project: issue.project&.name,
			project_identifier: issue.project&.identifier,

			project_parents: issue.project.ancestors.map do |p|
				{ id: p.id, name: p.name }
			end,

			tracker: issue.tracker&.name,
			tracker_id: issue.tracker_id,

			status: issue.status&.name,
			status_id: issue.status_id,
			is_closed: issue.closed?,

			priority_id: issue.priority_id,
			priority: issue.priority&.name,

			subject: issue.subject,
			updated_on: format_time(issue.updated_on),
			updated_on_iso: issue.updated_on&.iso8601,

			author_id: issue.author_id,
			author_name: issue.author&.name,

			assigned_to_id: issue.assigned_to_id,
			assigned_to_name: issue.assigned_to&.name,
			assigned_to_me: issue.assigned_to_id == User.current.id,

			created_by_me: issue.author_id == User.current.id,

			overdue: issue.due_date.present? && issue.due_date < Date.today,
			behind_schedule: safe_behind_schedule(issue)
		}.merge(extra)
	end

end
