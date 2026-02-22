# lib/bf_readup/query_engine.rb
module BfReadup
	class QueryEngine
		MAX_RESULTS = 200

    ###########################################################################
    # HUVUDMETOD
    ###########################################################################
    def self.changed_since_last_read(user, debug_mode = false)
      lookback_days = Setting.plugin_bf_readup["lookback_days"].to_i
      since_time    = lookback_days.days.ago

      prio_levels = load_prio_rules

      issues = Issue.joins(:project)
                    .where("issues.updated_on >= ?", since_time)
                    .where(projects: { status: 1 })

      results = []
			overflow = false

      issues.each do |issue|

        #######################################################################
        # 1. PROJEKTMEDLEMSKAP + INITIERING AV FILTERED OUT
        #######################################################################
				was_filtered_out = false
				include_in_normal = true
        user_is_part_of_project = issue.project.users.exists?(id: user.id)

        #######################################################################
        # 2. JOURNALDATA (bara synliga journals)
        #######################################################################
        all_journals =
          issue.journals.
            visible(user).
            order("journals.id ASC")

				visit = BfReadupVisit.find_by(user_id: user.id, issue_id: issue.id)

				pos = read_positions(visit)

				break_journal_id       = pos[:effective_journal_id]
				effective_last_read_at = pos[:effective_at]

				never_read = pos[:actual_at].nil? && pos[:marked_at].nil?

				new_journals =
					all_journals.where("journals.id > ?", break_journal_id)
					
        filtered_journals =
          new_journals.reject { |j| j.user_id == user.id }

				last_journal = all_journals.last

				last_activity_at =
					if last_journal
						last_journal.created_on
					else
						issue.updated_on
					end

				last_activity_by =
					if last_journal
						last_journal.user
					else
						issue.author
					end

				if effective_last_read_at &&
					 new_journals.empty? &&
					 last_activity_at &&
					 last_activity_at <= effective_last_read_at
					next
				end

        #######################################################################
        # 3. FLAGGAR
        #######################################################################
        is_author           = issue.author_id == user.id
        has_journals        = all_journals.any?
        has_new             = new_journals.any?
        has_new_from_others = filtered_journals.any?
        only_self_changes   = has_new && !has_new_from_others

        #######################################################################
        # 4. FILTRERING (NORMAL MODE)
        #######################################################################
				if !user_is_part_of_project
					include_in_normal = false
					reason_normal = "not_part_of_project"

				elsif is_author
					include_in_normal = has_new_from_others
					reason_normal = include_in_normal ?
														"author_has_new_from_others" :
														"author_no_relevant_changes"

				elsif never_read
					include_in_normal = true
					reason_normal = "never_read"

				elsif has_new_from_others
					include_in_normal = true
					reason_normal = "new_journals_from_others"

				else
					include_in_normal = false
					reason_normal =
						if !has_new
							"no_new_journals"
						elsif only_self_changes
							"only_self_changes"
						else
							"filtered_out"
						end
				end

				was_filtered_out ||= !include_in_normal

				include_in_final = debug_mode ? true : include_in_normal
				next unless include_in_final

        #######################################################################
        # 5. PRIORITETSMATCHNING
        #######################################################################
        match_key, match_rule = find_prio_match(issue, user, visit, prio_levels)

        # Nytt ärende utan match → forcera rätt prioritet
        if never_read && !is_author && match_key.nil?
          match_key  = "new_issue_never_read"
          match_rule = prio_levels.find { |p| p["key"] == match_key }
        end

        #######################################################################
        # 6. FALLBACK VID AVSAKNAD AV PRIORITET
        #######################################################################
				if was_filtered_out && debug_mode
					match_rule = {
						"label" => "Filtrerades bort (visas genom debug)",
						"icon"  => "🐞",
						"rank"  => 999
					}
					match_key = "debug_filtered"
				elsif match_rule.nil?
					next unless debug_mode
					match_rule = {
						"label" => "Ingen prioritet matchade",
						"icon"  => "🐞",
						"rank"  => 999
					}
					match_key ||= "debug"
				end
				
        #######################################################################
        # 7. NEW_COUNT – KORRIGERAD LOGIK
        #######################################################################
        new_count =
          if is_author
            # Författaren ska inte få "1" bara för att issue saknar journals
            filtered_journals.size
          elsif never_read
            has_journals ? filtered_journals.size : 1
          else
            filtered_journals.size
          end

				new_authors =
					if filtered_journals.any?
						filtered_journals
							.map(&:user)
							.compact
							.uniq { |u| u.id }
							.map(&:name)
					elsif new_count.to_i > 0
						[issue.author&.name].compact
					else
						[]
					end
					
        #######################################################################
        # 8. DEBUG-PAKET
        #######################################################################
        debug_info = nil
        if debug_mode
					debug_info = {
						issue_id: issue.id,
						subject: issue.subject,
						updated_on: issue.updated_on,

						part_of_project: user_is_part_of_project,
						normal_mode_reason: reason_normal,
						normal_mode_included: include_in_normal,

						read_positions: pos,
						break_journal_id: break_journal_id,

						all_journal_ids: all_journals.map(&:id),
						new_journal_ids: new_journals.map(&:id),
						filtered_journal_ids: filtered_journals.map(&:id),
						new_count: new_count,

						flags: {
							is_author: is_author,
							never_read: never_read,
							has_journals: has_journals,
							has_new: has_new,
							has_new_from_others: has_new_from_others,
							only_self_changes: only_self_changes
						},

						prio_match: match_key,
						prio_rule: match_rule
					}
        end

        #######################################################################
        # 9. PUSH RESULT
        #######################################################################
				results << {
					issue: issue,
					prio: {
						key:   match_key,
						label: match_rule["label"],
						icon:  match_rule["icon"],
						rank:  match_rule["rank"].to_i
					},
					new_count: new_count,
					new_authors: new_authors,
					journal_authors: filtered_journals.map { |j| journal_meta(j) },
					last_activity_at: last_activity_at,
					last_activity_by_id: last_activity_by&.id,
					last_activity_by_name: last_activity_by&.name,
					last_read_at: effective_last_read_at,
					debug: debug_info
				}

				if results.size > MAX_RESULTS
					overflow = true
				end

      end

			sorted =
				results.sort_by do |r|
					[
						r[:prio][:rank],
						-(r[:last_activity_at]&.to_i || 0),
						-(r[:issue].updated_on.to_i),
						r[:issue].id
					]
				end

			if overflow
				sorted = sorted.first(MAX_RESULTS)
			end

			{
				status: overflow ? "overflow" : "ok",

				limits: {
					max_results: MAX_RESULTS
				},

				stats: {
					total_found: results.size,
					returned: sorted.size
				},

				rows: sorted
			}
			
    end

    ###########################################################################
    # PRIORITY RULE LOADER
    ###########################################################################
    def self.load_prio_rules
      raw = Setting.plugin_bf_readup["prio_levels"]
      return [] if raw.nil?

      pl = JSON.parse(raw) rescue []
      pl = pl.is_a?(Array) ? pl : []
      pl.select { |p| p["active"] }
    end

    ###########################################################################
    # PRIORITY MATCHING
    ###########################################################################
    def self.find_prio_match(issue, user, visit, levels)
      levels.sort_by { |p| p["rank"].to_i }.each do |prio|
        next unless prio["method"]
        next unless respond_to?(prio["method"], true)
        return [prio["key"], prio] if send(prio["method"], issue, user, visit)
      end
      [nil, nil]
    end

    ###########################################################################
    # JOURNAL META
    ###########################################################################
    def self.journal_meta(j)
      {
        journal_id: j.id,
        created_on: j.created_on,
        user_id:    j.user_id,
        user_name:  j.user&.name.to_s
      }
    end
		
		###########################################################################
		# MARK AS READ – POLICY & WRITE LOGIC
		###########################################################################

		def self.allowed_to_mark_as_read?(issue, user, visit)
			return true if visit.nil?

			return false if mentioned_unread?(issue, user, visit)

			max_rank = Setting.plugin_bf_readup["mark_as_read_max_rank"].to_i
			max_rank = nil if max_rank <= 0

			if max_rank
				match_key, match_rule =
					find_prio_match(issue, user, visit, load_prio_rules)

				return false if match_rule && match_rule["rank"].to_i < max_rank
			end

			true
		end

		def self.apply_mark_as_read!(visit, journal_id, type:)
			extra = visit.extra_data || {}

			extra["marked_as_read_at"] = Time.current.utc.iso8601
			extra["marked_as_read_type"] = type
			extra["marked_as_read_journal_id"] = journal_id.to_i

			visit.extra_data = extra
			visit.save!
		end

		###########################################################################
		# READ POSITION (HJÄLPFUNKTION)
		###########################################################################
		def self.read_positions(visit)
			return {
				actual_at: nil,
				actual_journal_id: 0,
				marked_at: nil,
				marked_journal_id: nil,
				effective_at: nil,
				effective_journal_id: 0,
				effective_source: :none
			} unless visit

			actual_at = visit.last_viewed_at
			actual_journal_id = (visit.last_journal_id || 0)

			extra = visit.extra_data.is_a?(Hash) ? visit.extra_data : {}

			marked_at =
				begin
					extra["marked_as_read_at"].present? ? Time.parse(extra["marked_as_read_at"].to_s) : nil
				rescue
					nil
				end

			marked_journal_id =
				extra["marked_as_read_journal_id"].present? ? extra["marked_as_read_journal_id"].to_i : nil

			if marked_at && marked_journal_id && (actual_at.nil? || marked_at >= actual_at)
				{
					actual_at: actual_at,
					actual_journal_id: actual_journal_id,
					marked_at: marked_at,
					marked_journal_id: marked_journal_id,
					effective_at: marked_at,
					effective_journal_id: marked_journal_id,
					effective_source: :marked
				}
			else
				{
					actual_at: actual_at,
					actual_journal_id: actual_journal_id,
					marked_at: marked_at,
					marked_journal_id: marked_journal_id,
					effective_at: actual_at,
					effective_journal_id: actual_journal_id,
					effective_source: actual_at ? :actual : :none
				}
			end
		end

		###########################################################################
		# EFFECTIVE READ POSITION (ENDA SANNINGEN)
		###########################################################################
		def self.effective_read_state(visit)
			return {
				journal_id: 0,
				read_at: nil
			} unless visit

			last_viewed_at   = visit.last_viewed_at
			last_journal_id  = visit.last_journal_id

			extra = visit.extra_data.is_a?(Hash) ? visit.extra_data : {}

			marked_at =
				begin
					extra["marked_as_read_at"].present? ?
						Time.parse(extra["marked_as_read_at"]) :
						nil
				rescue
					nil
				end

			marked_journal_id =
				extra["marked_as_read_journal_id"].present? ?
					extra["marked_as_read_journal_id"].to_i :
					nil

			if marked_at && marked_journal_id &&
					 (last_viewed_at.nil? || marked_at >= last_viewed_at)
				{
					journal_id: marked_journal_id,
					read_at: marked_at
				}
			else
				{
					journal_id: last_journal_id || 0,
					read_at: last_viewed_at
				}
			end

		end

    ###########################################################################
    # PRIORITETSMETODER
    ###########################################################################
		def self.mentioned_unread?(issue, user, visit)
			pos = read_positions(visit)
			last_id = pos[:effective_journal_id]

			issue.journals
					 .visible(user)
					 .where("journals.id > ?", last_id)
					 .any? { |j|
						 j.notes.to_s.include?("@#{user.login}") ||
						 j.notes.to_s.include?(user.mail)
					 }
		end

    def self.assigned_now?(issue, user, visit)
      issue.assigned_to_id == user.id
    end

    def self.author?(issue, user, visit)
      issue.author_id == user.id
    end

    def self.watcher?(issue, user, visit)
      issue.watcher_user_ids.include?(user.id)
    end

    def self.assigned_historic?(issue, user, visit)
      issue.journals.visible(user).any? do |j|
        j.details.any? { |d| d.prop_key == "assigned_to_id" && d.old_value.to_i == user.id }
      end
    end

    def self.mentioned_historic?(issue, user, visit)
      issue.journals.visible(user).any? do |j|
        notes = j.notes.to_s
        notes.include?("@#{user.login}") || notes.include?(user.mail)
      end
    end

    def self.cf_match?(issue, user, visit)
      !!BfReadup::CustomFieldMatcher.match_key(issue, user)
    end

    def self.commented_historic?(issue, user, visit)
      issue.journals.visible(user).where(user_id: user.id).exists?
    end

		def self.read_with_new_changes?(issue, user, visit)
			return false unless visit
			pos = read_positions(visit)
			return false unless pos[:actual_at]

			last_activity =
				issue.journals.any? ? issue.journals.maximum(:created_on) : issue.updated_on

			last_activity > pos[:actual_at]
		end

		def self.new_issue_never_read?(issue, user, visit)
			return true unless visit
			pos = read_positions(visit)
			pos[:actual_at].nil? && pos[:marked_at].nil?
		end
	
		def self.marked_read_after_actual_read_with_new_changes?(issue, user, visit)
			return false unless visit
			pos = read_positions(visit)
			return false unless pos[:marked_at] && pos[:marked_journal_id]
			return false unless pos[:actual_at] # någon gång faktiskt läst
			return false unless pos[:marked_at] >= pos[:actual_at] # markeringen är efter faktisk läsning

			last_activity =
				issue.journals.any? ? issue.journals.maximum(:created_on) : issue.updated_on

			last_activity > pos[:marked_at]
		end

		def self.marked_read_but_never_read_with_new_changes?(issue, user, visit)
			return false unless visit
			pos = read_positions(visit)
			return false unless pos[:marked_at] && pos[:marked_journal_id]
			return false unless pos[:actual_at].nil? # aldrig faktiskt läst

			last_activity =
				issue.journals.any? ? issue.journals.maximum(:created_on) : issue.updated_on

			last_activity > pos[:marked_at]
		end

		def self.marked_read_after_actual_read?(issue, user, visit)
			return false unless visit
			pos = read_positions(visit)
			return false unless pos[:marked_at] && pos[:marked_journal_id]
			return false unless pos[:actual_at]
			pos[:marked_at] >= pos[:actual_at]
		end

		def self.marked_read_but_never_read?(issue, user, visit)
			return false unless visit
			pos = read_positions(visit)
			return false unless pos[:marked_at] && pos[:marked_journal_id]
			pos[:actual_at].nil?
		end

		###########################################################################
		# MOST READ AND RECENTLY READ JOURNALS
		###########################################################################

		def self.recently_read(user)
			lookback_days = Setting.plugin_bf_readup["lookback_days"].to_i
			since = lookback_days.days.ago

			visits =
				BfReadupVisit
					.where(user_id: user.id)
					.includes(:issue)

			rows = visits.map do |visit|
				next unless visit.last_viewed_at
				next if visit.last_viewed_at < since

				issue = visit.issue
				next unless issue
				next unless issue.project&.status == 1

				{
					issue: issue,
					read_at: visit.last_viewed_at
				}
			end.compact

			rows
				.sort_by { |r| r[:read_at] }
				.reverse
				.first(MAX_RESULTS)
		end

		def self.most_read(user)
			lookback_days = Setting.plugin_bf_readup["lookback_days"].to_i
			since = lookback_days.days.ago

			visits =
				BfReadupVisit
					.where(user_id: user.id)
					.where("total_seconds > 0")
					.includes(:issue)

			rows = visits.map do |visit|
				next unless visit.last_viewed_at
				next if visit.last_viewed_at < since

				issue = visit.issue
				next unless issue
				next unless issue.project&.status == 1

				{
					issue: issue,
					total_seconds: visit.total_seconds,
					last_viewed_at: visit.last_viewed_at
				}
			end.compact

			rows
				.sort_by { |r| -r[:total_seconds] }
				.first(MAX_RESULTS)
		end
		
		def self.most_read_global(current_user)
			lookback_days = Setting.plugin_bf_readup["lookback_days"].to_i
			since = lookback_days.days.ago

			project_ids = current_user.projects.where(status: 1).pluck(:id)
			return [] if project_ids.empty?

			# ------------------------------------------------------------
			# 1) Aggregat per issue (utan includes, annars får vi GROUP BY-strul)
			# ------------------------------------------------------------
			agg_rows =
				BfReadupVisit
					.joins(issue: :project)
					.where(projects: { status: 1 })
					.where("bf_readup_visits.total_seconds > 0")
					.where("bf_readup_visits.last_viewed_at >= ?", since)
					.where(issues: { project_id: project_ids })
					.group("bf_readup_visits.issue_id")
					.pluck(
						Arel.sql("bf_readup_visits.issue_id"),
						Arel.sql("SUM(bf_readup_visits.total_seconds)"),
						Arel.sql("MAX(bf_readup_visits.last_viewed_at)"),
						Arel.sql("COUNT(DISTINCT bf_readup_visits.user_id)")
					)

			issue_ids = agg_rows.map { |r| r[0] }.compact.uniq
			return [] if issue_ids.empty?

			issues_by_id =
				Issue
					.includes(:project)
					.where(id: issue_ids)
					.index_by(&:id)

			# ------------------------------------------------------------
			# 2) Per issue + per user (för tooltip-data)
			# ------------------------------------------------------------
			reader_rows =
				BfReadupVisit
					.where(issue_id: issue_ids)
					.where("bf_readup_visits.total_seconds > 0")
					.where("bf_readup_visits.last_viewed_at >= ?", since)
					.group(:issue_id, :user_id)
					.pluck(
						:issue_id,
						:user_id,
						Arel.sql("SUM(bf_readup_visits.total_seconds)"),
						Arel.sql("MAX(bf_readup_visits.last_viewed_at)")
					)

			user_ids = reader_rows.map { |r| r[1] }.compact.uniq
			users_by_id = User.where(id: user_ids).index_by(&:id)

			readers_by_issue = Hash.new { |h, k| h[k] = [] }

			reader_rows.each do |issue_id, user_id, total_sum, last_viewed_at|
				u = users_by_id[user_id]
				next unless u

				readers_by_issue[issue_id] << {
					user_id: u.id,
					user_name: u.name.to_s,
					total_seconds: total_sum.to_i,
					last_viewed_at: last_viewed_at&.utc&.iso8601
				}
			end

			# Sortera läsare på tid (störst först), och stabilt på namn vid lika
			readers_by_issue.each_value do |arr|
				arr.sort_by! { |x| [-x[:total_seconds].to_i, x[:user_name].downcase] }
			end

			# ------------------------------------------------------------
			# 3) Bygg rows till frontend
			# ------------------------------------------------------------
			rows =
				agg_rows.map do |issue_id, total_sum, last_viewed_at, readers_count|
					issue = issues_by_id[issue_id]
					next unless issue
					next unless issue.project&.status == 1

					{
						issue: issue,
						total_seconds: total_sum.to_i,
						last_viewed_at: last_viewed_at,
						readers_count: readers_count.to_i,
						readers: readers_by_issue[issue_id] || []
					}
				end.compact

			rows
				.sort_by { |r| -r[:total_seconds] }
				.first(MAX_RESULTS)
		end

  end
end
