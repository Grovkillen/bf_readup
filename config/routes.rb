Rails.application.routes.draw do
  post 'bf_readup/enter',   					to: 'bf_readup#enter'
  post 'bf_readup/ping',    					to: 'bf_readup#ping'
  post 'bf_readup/exit',   						to: 'bf_readup#exit'
  post 'bf_readup/updates', 					to: 'bf_readup#updates'
	post "bf_readup/mark_as_read",  		to: "bf_readup#mark_as_read"
	post "bf_readup/mark_all_as_read",  to: "bf_readup#mark_all_as_read"
	
  post 'bf_readup/preferences',       to: 'bf_readup#preferences'
  get  'bf_readup/preferences',       to: 'bf_readup#preferences'

	get  'bf_readup/recently_read',     to: 'bf_readup#recently_read'
  get  'bf_readup/most_read',         to: 'bf_readup#most_read'
	get 'bf_readup/most_read_global',		to: 'bf_readup#most_read_global'
end
