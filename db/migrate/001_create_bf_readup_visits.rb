class CreateBfReadupVisits < ActiveRecord::Migration[6.1]
  def change
    create_table :bf_readup_visits do |t|
      t.integer  :user_id,        null: false
      t.integer  :issue_id,       null: false
      t.datetime :last_viewed_at
      t.integer  :last_journal_id
      t.datetime :first_entered_at
      t.datetime :last_ping_at
      t.integer  :total_seconds,  default: 0

      t.timestamps
    end

    add_index :bf_readup_visits, [:user_id, :issue_id], unique: true
    add_index :bf_readup_visits, :issue_id
  end
end
