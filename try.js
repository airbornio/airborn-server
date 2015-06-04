(function() {
	function randomWords(n) {
		return Array.apply(null, new Array(n)).map(function() { return Math.floor(Math.random() * 0xFFFFFFFF); });
	}
	
	var password = sjcl.codec.hex.fromBits(randomWords(8));
	var salt = randomWords(2);
	var files_key = window.files_key = randomWords(8);
	var hmac_bits = randomWords(4);
	var key = sjcl.misc.pbkdf2(password, salt, 10);
	var private_key = window.private_key = key.slice(128/32); // Second half
	var shared_key = key.slice(0, 128/32); // First half
	var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
	var files_hmac = window.files_hmac = new sjcl.misc.hmac(hmac_bits);
	var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
	var account_info = window.account_info = {tier: 1};

	var XMLHttpRequest_open = window.XMLHttpRequest.prototype.open;
	window.XMLHttpRequest.prototype.open = function(method, url) {
		if(url.substr(0, 8) === '/object/' && method === 'GET') {
			var hash = url.split('#')[1]
			var codec = hash.substr(0, hash.indexOf('.'));
			url = '/v2/live' + hash.substr(hash.indexOf('.') + 1);
			if(codec) {
				Object.defineProperty(this, 'responseText', {get: function() {
					return sjcl.codec.utf8String.fromBits(sjcl.codec.arrayBuffer.toBits(this.response));
				}});
				this.responseType = 'arraybuffer';
			}
		} else if(url.substr(0, 8) === '/object/' || url.substr(0, 13) === '/transaction/') {
			Object.defineProperty(this, 'setRequestHeader', {value: function() {}});
			Object.defineProperty(this, 'send', {value: function() {
				Object.defineProperty(this, 'readyState', {get: function() { return 4; }});
				Object.defineProperty(this, 'status', {get: function() {
					return 200;
				}});
				this.dispatchEvent(new Event('readystatechange'));
				this.dispatchEvent(new Event('load'));
			}});
			return;
		}
		XMLHttpRequest_open.apply(this, arguments);
	};
	sjcl.encrypt = sjcl.decrypt = function(key, content) {
		return content;
	};
	var req = new XMLHttpRequest();
	req.open('GET', '/v2/live/Core/core.js');
	req.addEventListener('readystatechange', function() {
		if(this.readyState === 4 && this.status === 200) {
			eval(this.responseText);
			getFile('/Core/startup.js', function(contents) {
				document.getElementById('loading').style.display = 'none';
				eval(contents);
			});
			window.logout = function() {
				window.location = '/';
			};
		}
	});
	req.send(null);
})();