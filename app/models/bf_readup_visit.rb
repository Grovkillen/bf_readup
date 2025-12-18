# app/models/bf_readup_visit.rb

class BfReadupVisit < ActiveRecord::Base
  belongs_to :user
  belongs_to :issue

  validates :user_id, :issue_id, presence: true
	
	def mark_as_read!(type: "manual")
		data = (extra_data || {}).dup
		data["marked_as_read_at"]   = Time.current
		data["marked_as_read_type"] = type
		self.extra_data = data
		save!
	end

end
