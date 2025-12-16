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

				read_state = effective_read_state(visit)
				break_journal_id       = read_state[:journal_id]
				effective_last_read_at = read_state[:read_at]

				new_journals =
					all_journals.where("journals.id > ?", break_journal_id)
					
        filtered_journals =
          new_journals.reject { |j| j.user_id == user.id }

				last_activity_at =
					if all_journals.any?
						all_journals.last.created_on
					else
						issue.updated_on
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
        never_read          = effective_last_read_at.nil?
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

						effective_read_state: read_state,
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
					 (last_viewed_at.nil? || marked_at > last_viewed_at)
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
			state = effective_read_state(visit)
			last_id = state[:journal_id]

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

			state = effective_read_state(visit)
			last_read_at = state[:read_at]

			return false unless last_read_at

			last_activity =
				issue.journals.any? ?
					issue.journals.maximum(:created_on) :
					issue.updated_on

			last_activity > last_read_at
		end

		def self.new_issue_never_read?(issue, user, visit)
			return true unless visit

			state = effective_read_state(visit)
			state[:read_at].nil?
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

  end
end
