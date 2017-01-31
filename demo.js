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
	var account_info = window.account_info = {tier: 10, S3Prefix: sjcl.codec.hex.fromBits(sjcl.random.randomWords(2,0)).toUpperCase()};
	var S3Prefix = window.S3Prefix = account_info.S3Prefix;

	var XMLHttpRequest_open = window.XMLHttpRequest.prototype.open;
	window.XMLHttpRequest.prototype.open = function(method, url) {
		var hash = url.substr(url.indexOf('#') + 1);
		if(hash.substr(0, hash.indexOf('.')) !== '1') { // Not a request to a real shared document
			if(url.substr(0, 8) === '/object/' && method === 'GET') {
				url = '/v2/live' + hash.substr(hash.indexOf('.') + 1);
				this.responseType = 'arraybuffer';
			} else if(url.substr(0, 8) === '/object/' || url.substr(0, 13) === '/transaction/') {
				Object.defineProperty(this, 'setRequestHeader', {value: function() {}});
				Object.defineProperty(this, 'send', {value: function() {
					Object.defineProperty(this, 'airborn_readyState', {get: function() { return 4; }});
					Object.defineProperty(this, 'airborn_status', {get: function() { return 200; }});
					this.dispatchEvent(new Event('readystatechange'));
					this.dispatchEvent(new Event('load'));
				}});
				return;
			}
		}
		Object.defineProperty(this, 'airborn_readyState', {get: function() { return this.readyState; }});
		Object.defineProperty(this, 'airborn_status', {get: function() { return this.status; }});
		Object.defineProperty(this, 'airborn_statusText', {get: function() { return this.statusText; }});
		Object.defineProperty(this, 'airborn_response', {get: function() { return this.response; }});
		Object.defineProperty(this, 'airborn_responseText', {get: function() { return this.response; }}); // Not responseText
		XMLHttpRequest_open.apply(this, arguments);
	};
	
	var req = new XMLHttpRequest();
	req.open('GET', '/v2/live/Core/core.js');
	req.addEventListener('readystatechange', function() {
		if(this.readyState === 4 && this.status === 200) {
			eval(this.responseText.replace(/\b((?:this|req)\.)((?:readyState|status|response)(?:Text)?)\b/g, '$1airborn_$2')); // renameGlobalVariables light
			var _decrypt = decrypt;
			decrypt = function(key, contents, outparams, callback) {
				_decrypt(key, contents, outparams, function(decrypted, err) {
					if(err) {
						callback(contents);
					} else {
						callback(decrypted);
					}
				});
			};
			getFile('/Core/startup.js', function(contents) {
				eval(contents);
			});
			window.logout = function() {
				window.location = '/';
			};
		}
	});
	req.send(null);
	[
		'/Apps/firetext/index.html',
		'/Apps/firetext/styles.css',
	].forEach(function(url) {
		var link = document.createElement('link');
		link.rel = 'prefetch';
		link.href= '/v2/live' + url;
		document.body.appendChild(link);
	});
})();