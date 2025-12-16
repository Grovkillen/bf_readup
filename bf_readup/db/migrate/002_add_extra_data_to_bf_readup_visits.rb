class AddExtraDataToBfReadupVisits < ActiveRecord::Migration[6.1]
  def change
    add_column :bf_readup_visits, :extra_data, :jsonb
    add_index  :bf_readup_visits, :extra_data, using: :gin
  end
end
