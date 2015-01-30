function GET(url, responseType, callback, error) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4) {
			if(req.status === 200) {
				callback(req.response);
			} else if(error) {
				error({status: req.status, statusText: req.statusText});
			}
		}
	};
	req.open('GET', url);
	req.responseType = responseType;
	req.send(null);
}

var lang = {};
GET('lang.json', 'text', function(response) {
	lang = JSON.parse(response);
});

(function() {
	try {
		var password = sjcl.codec.hex.fromBits(sjcl.random.randomWords(8));
		var salt = sjcl.random.randomWords(2);
		var files_key = window.files_key = sjcl.random.randomWords(8);
		var hmac_bits = sjcl.random.randomWords(4);
	} catch(e) {
		alert(lang.error);
		throw e;
	}
	var key = sjcl.misc.pbkdf2(password, salt, 1000);
	var private_key = window.private_key = key.slice(128/32); // Second half
	var shared_key = key.slice(0, 128/32); // First half
	var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
	var files_hmac = window.files_hmac = new sjcl.misc.hmac(hmac_bits);
	var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
	var account_info = window.account_info = {tier: 1};

	var XMLHttpRequest_open = window.XMLHttpRequest.prototype.open;
	window.XMLHttpRequest.prototype.open = function(method, url) {
		if(url.substr(0, 8) === '/object/' || url.substr(0, 7) === 'object/' || url.substr(0, 13) === '/transaction/') {
			Object.defineProperty(this, 'setRequestHeader', {value: function() {}});
			Object.defineProperty(this, 'send', {value: function() {
				Object.defineProperty(this, 'readyState', {get: function() { return 4; }});
				Object.defineProperty(this, 'status', {get: function() {
					if(method === 'PUT') {
						return 200;
					}
					return 404;
				}});
				this.dispatchEvent(new Event('readystatechange'));
				this.dispatchEvent(new Event('load'));
			}});
			return;
		}
		XMLHttpRequest_open.apply(this, arguments);
	};
	var getFile = function(file, options, callback) {
		if(!window.getFileCache || !window.getFileCache[file]) {
			if(typeof options === 'function' || options === undefined) {
				callback = options;
				options = {};
			}
			if(options.codec) {
				GET('/v2/live' + file, 'arraybuffer', function(contents) {
					if(callback) callback(sjcl.codec[options.codec].fromBits(sjcl.codec.arrayBuffer.toBits(contents)));
				}, function(err) {
					if(callback) callback(null, err)
				});
			} else {
				GET('/v2/live' + file, 'text', function(contents) {
					if(callback) callback(contents);
				}, function(err) {
					if(callback) callback(null, err)
				});
			}
			return;
		}
		return _getFile(file, options, callback);
	};
	var _getFile;
	getFile('/Core/core.js', function(contents) {
		eval(contents);
		getFile('/Core/startup.js', function(contents) {
			document.getElementById('loading').style.display = 'none';
			eval(contents);
		});
		_getFile = window.getFile;
		window.getFile = getFile;
		window.logout = function() {
			window.location = '/';
		};
	});
})();