if ( typeof wp === 'undefined' )
	var wp = {};

(function( exports, $ ){
	var api, extend, ctor, inherits,
		slice = Array.prototype.slice;

	/* =====================================================================
	 * Micro-inheritance - thank you, backbone.js.
	 * ===================================================================== */

	extend = function( protoProps, classProps ) {
		var child = inherits( this, protoProps, classProps );
		child.extend = this.extend;
		return child;
	};

	// Shared empty constructor function to aid in prototype-chain creation.
	ctor = function() {};

	// Helper function to correctly set up the prototype chain, for subclasses.
	// Similar to `goog.inherits`, but uses a hash of prototype properties and
	// class properties to be extended.
	inherits = function( parent, protoProps, staticProps ) {
		var child;

		// The constructor function for the new subclass is either defined by you
		// (the "constructor" property in your `extend` definition), or defaulted
		// by us to simply call `super()`.
		if ( protoProps && protoProps.hasOwnProperty( 'constructor' ) ) {
			child = protoProps.constructor;
		} else {
			child = function() {
				// Storing the result `super()` before returning the value
				// prevents a bug in Opera where, if the constructor returns
				// a function, Opera will reject the return value in favor of
				// the original object. This causes all sorts of trouble.
				var result = parent.apply( this, arguments );
				return result;
			};
		}

		// Inherit class (static) properties from parent.
		$.extend( child, parent );

		// Set the prototype chain to inherit from `parent`, without calling
		// `parent`'s constructor function.
		ctor.prototype  = parent.prototype;
		child.prototype = new ctor();

		// Add prototype properties (instance properties) to the subclass,
		// if supplied.
		if ( protoProps )
			$.extend( child.prototype, protoProps );

		// Add static properties to the constructor function, if supplied.
		if ( staticProps )
			$.extend( child, staticProps );

		// Correctly set child's `prototype.constructor`.
		child.prototype.constructor = child;

		// Set a convenience property in case the parent's prototype is needed later.
		child.__super__ = parent.prototype;

		return child;
	};

	api = {};

	/* =====================================================================
	 * Base class.
	 * ===================================================================== */

	api.Class = function( applicator, argsArray, options ) {
		var magic, args = arguments;

		if ( applicator && argsArray && api.Class.applicator === applicator ) {
			args = argsArray;
			$.extend( this, options || {} );
		}

		magic = this;
		if ( this.instance ) {
			magic = function() {
				return magic.instance.apply( magic, arguments );
			};

			$.extend( magic, this );
		}

		magic.initialize.apply( magic, args );
		return magic;
	};

	api.Class.applicator = {};

	api.Class.prototype.initialize = function() {};

	/*
	 * Checks whether a given instance extended a constructor.
	 *
	 * The magic surrounding the instance parameter causes the instanceof
	 * keyword to return inaccurate results; it defaults to the function's
	 * prototype instead of the constructor chain. Hence this function.
	 */
	api.Class.prototype.extended = function( constructor ) {
		var proto = this;

		while ( typeof proto.constructor !== 'undefined' ) {
			if ( proto.constructor === constructor )
				return true;
			if ( typeof proto.constructor.__super__ === 'undefined' )
				return false;
			proto = proto.constructor.__super__;
		}
		return false;
	};

	api.Class.extend = extend;

	/* =====================================================================
	 * Light two-way binding.
	 * ===================================================================== */

	api.Value = api.Class.extend({
		initialize: function( initial, options ) {
			this._value = initial; // @todo: potentially change this to a this.set() call.
			this.callbacks = $.Callbacks();

			$.extend( this, options || {} );

			this.set = $.proxy( this.set, this );
		},

		/*
		 * Magic. Returns a function that will become the instance.
		 * Set to null to prevent the instance from extending a function.
		 */
		instance: function() {
			return arguments.length ? this.set.apply( this, arguments ) : this.get();
		},

		get: function() {
			return this._value;
		},

		set: function( to ) {
			var from = this._value;

			to = this._setter.apply( this, arguments );
			to = this.validate( to );

			// Bail if the sanitized value is null or unchanged.
			if ( null === to || this._value === to )
				return this;

			this._value = to;

			this.callbacks.fireWith( this, [ to, from ] );

			return this;
		},

		_setter: function( to ) {
			return to;
		},

		setter: function( callback ) {
			this._setter = callback;
			this.set( this.get() );
			return this;
		},

		resetSetter: function() {
			this._setter = this.constructor.prototype._setter;
			this.set( this.get() );
			return this;
		},

		validate: function( value ) {
			return value;
		},

		bind: function( callback ) {
			this.callbacks.add.apply( this.callbacks, arguments );
			return this;
		},

		unbind: function( callback ) {
			this.callbacks.remove.apply( this.callbacks, arguments );
			return this;
		},

		link: function() { // values*
			var set = this.set;
			$.each( arguments, function() {
				this.bind( set );
			});
			return this;
		},

		unlink: function() { // values*
			var set = this.set;
			$.each( arguments, function() {
				this.unbind( set );
			});
			return this;
		},

		sync: function() { // values*
			var that = this;
			$.each( arguments, function() {
				that.link( this );
				this.link( that );
			});
			return this;
		},

		unsync: function() { // values*
			var that = this;
			$.each( arguments, function() {
				that.unlink( this );
				this.unlink( that );
			});
			return this;
		}
	});

	api.Values = api.Class.extend({
		defaultConstructor: api.Value,

		initialize: function( options ) {
			$.extend( this, options || {} );

			this._value = {};
			this._deferreds = {};
		},

		instance: function( id ) {
			if ( arguments.length === 1 )
				return this.value( id );

			return this.when.apply( this, arguments );
		},

		value: function( id ) {
			return this._value[ id ];
		},

		has: function( id ) {
			return typeof this._value[ id ] !== 'undefined';
		},

		add: function( id, value ) {
			if ( this.has( id ) )
				return this.value( id );

			this._value[ id ] = value;
			this._value[ id ].parent = this;

			if ( this._deferreds[ id ] )
				this._deferreds[ id ].resolve();

			return this._value[ id ];
		},

		set: function( id ) {
			if ( this.has( id ) )
				return this.pass( 'set', arguments );

			return this.add( id, new this.defaultConstructor( api.Class.applicator, slice.call( arguments, 1 ) ) );
		},

		remove: function( id ) {
			delete this._value[ id ];
			delete this._deferreds[ id ];
		},

		pass: function( fn, args ) {
			var id, value;

			args = slice.call( args );
			id   = args.shift();

			if ( ! this.has( id ) )
				return;

			value = this.value( id );
			return value[ fn ].apply( value, args );
		},

		/**
		 * Runs a callback once all requested values exist.
		 *
		 * when( ids*, callback );
		 *
		 * For example:
		 *     when( id1, id2, id3, function( value1, value2, value3 ) {} );
		 */
		when: function() {
			var self = this,
				ids = slice.call( arguments ),
				callback = ids.pop();

			$.when.apply( $, $.map( ids, function( id ) {
				if ( self.has( id ) )
					return;

				return self._deferreds[ id ] || ( self._deferreds[ id ] = $.Deferred() );
			})).done( function() {
				var values = $.map( ids, function( id ) {
						return self( id );
					});

				// If a value is missing, we've used at least one expired deferred.
				// Call Values.when again to update our master deferred.
				if ( values.length !== ids.length ) {
					ids.push( callback );
					self.when.apply( self, ids );
					return;
				}

				callback.apply( self, values );
			});
		}
	});

	$.each( [ 'get', 'bind', 'unbind', 'link', 'unlink', 'sync', 'unsync', 'setter', 'resetSetter' ], function( i, method ) {
		api.Values.prototype[ method ] = function() {
			return this.pass( method, arguments );
		};
	});

	api.ensure = function( element ) {
		return typeof element == 'string' ? $( element ) : element;
	};

	api.Element = api.Value.extend({
		initialize: function( element, options ) {
			var self = this,
				synchronizer = api.Element.synchronizer.html,
				type, update, refresh;

			this.element = api.ensure( element );
			this.events = '';

			if ( this.element.is('input, select, textarea') ) {
				this.events += 'change';
				synchronizer = api.Element.synchronizer.val;

				if ( this.element.is('input') ) {
					type = this.element.prop('type');
					if ( api.Element.synchronizer[ type ] )
						synchronizer = api.Element.synchronizer[ type ];
					if ( 'text' === type || 'password' === type )
						this.events += ' keyup';
				}
			}

			api.Value.prototype.initialize.call( this, null, $.extend( options || {}, synchronizer ) );
			this._value = this.get();

			update  = this.update;
			refresh = this.refresh;

			this.update = function( to ) {
				if ( to !== refresh.call( self ) )
					update.apply( this, arguments );
			};
			this.refresh = function() {
				self.set( refresh.call( self ) );
			};

			this.bind( this.update );
			this.element.bind( this.events, this.refresh );
		},

		find: function( selector ) {
			return $( selector, this.element );
		},

		refresh: function() {},

		update: function() {}
	});

	api.Element.synchronizer = {};

	$.each( [ 'html', 'val' ], function( i, method ) {
		api.Element.synchronizer[ method ] = {
			update: function( to ) {
				this.element[ method ]( to );
			},
			refresh: function() {
				return this.element[ method ]();
			}
		};
	});

	api.Element.synchronizer.checkbox = {
		update: function( to ) {
			this.element.prop( 'checked', to );
		},
		refresh: function() {
			return this.element.prop( 'checked' );
		}
	};

	api.Element.synchronizer.radio = {
		update: function( to ) {
			this.element.filter( function() {
				return this.value === to;
			}).prop( 'checked', true );
		},
		refresh: function() {
			return this.element.filter( ':checked' ).val();
		}
	};

	/* =====================================================================
	 * Messenger for postMessage.
	 * ===================================================================== */

	api.Messenger = api.Class.extend({
		add: function( key, initial, options ) {
			return this[ key ] = new api.Value( initial, options );
		},

		initialize: function( url, targetWindow, options ) {
			$.extend( this, options || {} );

			url = this.add( 'url', url );
			this.add( 'targetWindow', targetWindow || window.parent );
			this.add( 'origin', url() ).link( url ).setter( function( to ) {
				return to.replace( /([^:]+:\/\/[^\/]+).*/, '$1' );
			});

			this.topics = {};

			this.receive = $.proxy( this.receive, this );
			$( window ).on( 'message', this.receive );
		},

		destroy: function() {
			$( window ).off( 'message', this.receive );
		},

		receive: function( event ) {
			var message;

			event = event.originalEvent;

			// Check to make sure the origin is valid.
			if ( this.origin() && event.origin !== this.origin() )
				return;

			message = JSON.parse( event.data );

			if ( message && message.id && message.data && this.topics[ message.id ] )
				this.topics[ message.id ].fireWith( this, [ message.data ]);
		},

		send: function( id, data ) {
			var message;

			data = data || {};

			if ( ! this.url() )
				return;

			message = JSON.stringify({ id: id, data: data });
			this.targetWindow().postMessage( message, this.origin() );
		},

		bind: function( id, callback ) {
			var topic = this.topics[ id ] || ( this.topics[ id ] = $.Callbacks() );
			topic.add( callback );
		},

		unbind: function( id, callback ) {
			if ( this.topics[ id ] )
				this.topics[ id ].remove( callback );
		}
	});

	/* =====================================================================
	 * Core customize object.
	 * ===================================================================== */

	api = $.extend( new api.Values(), api );

	// Expose the API to the world.
	exports.customize = api;
})( wp, jQuery );
